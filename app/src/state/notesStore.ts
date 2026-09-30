import { create } from 'zustand'
import { AppState } from 'react-native'
import { waitForForeground } from '../ai/foreground'
import type { Note, NoteInput } from '../domain/note'
import * as repository from '../data/notesRepository'
import {
  processNoteWithLlm,
  type ProcessingProgress,
} from '../ai/noteProcessing'
import { enqueueLlm } from '../ai/llmQueue'
import { recordOperationTiming } from '../ai/generationMetrics'
import { deleteRecordingFile } from '../audio/audioFiles'
import { useTasksStore } from './tasksStore'
import { useModelStore } from './modelStore'
import {
  applyNoteProposal,
  createNoteProposal,
  type NoteProposal,
  type NoteProposalSelection,
} from '../notes/noteProposals'

interface NotesState {
  notes: Note[]
  loaded: boolean
  processing: Record<string, ProcessingProgress>
  processingError: Record<string, string>
  proposals: Record<string, NoteProposal>
  load: () => Promise<void>
  add: (input: NoteInput) => Promise<Note>
  update: (id: string, input: NoteInput) => Promise<void>
  remove: (id: string) => Promise<void>
  processWithLlm: (id: string) => Promise<void>
  proposeWithLlm: (id: string) => Promise<boolean>
  applyProposal: (
    id: string,
    selection: NoteProposalSelection,
  ) => Promise<boolean>
  clearProposal: (id: string) => void
}

const byNewest = (a: Note, b: Note): number => b.updatedAt - a.updatedAt

const revisions = new Map<string, number>()
const noteQueues = new Map<string, Promise<void>>()
const activeRuns = new Map<string, number>()
let runSequence = 0

const revisionFor = (id: string): number => revisions.get(id) ?? 0

const invalidateNoteWork = (id: string): number => {
  const revision = revisionFor(id) + 1
  revisions.set(id, revision)
  return revision
}

const withNoteLock = async <T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = noteQueues.get(id) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => gate)
  noteQueues.set(id, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (noteQueues.get(id) === queued) noteQueues.delete(id)
  }
}

const sameInput = (left: Note, right: Note): boolean => {
  const a = toInput(left)
  const b = toInput(right)
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.summary === b.summary &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index]) &&
    a.audioUri === b.audioUri &&
    a.durationMs === b.durationMs
  )
}

const toInput = (note: Note): NoteInput => ({
  title: note.title,
  content: note.content,
  summary: note.summary,
  tags: note.tags,
  audioUri: note.audioUri,
  durationMs: note.durationMs,
})

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  processing: {},
  processingError: {},
  proposals: {},
  load: async () => {
    const notes = await repository.listNotes()
    set({ notes, loaded: true })
  },
  add: async (input) => {
    const note = await repository.createNote(input)
    set({ notes: [note, ...get().notes] })
    return note
  },
  update: async (id, input) => {
    const revision = invalidateNoteWork(id)
    set((state) => {
      const { [id]: _proposal, ...proposals } = state.proposals
      const { [id]: _error, ...processingError } = state.processingError
      return { proposals, processingError }
    })
    await withNoteLock(id, async () => {
      const updated = await repository.updateNote(id, input)
      if (revision !== revisionFor(id)) return
      set((state) => ({
        notes: state.notes
          .map((note) => (note.id === id ? updated : note))
          .sort(byNewest),
      }))
    })
  },
  remove: async (id) => {
    invalidateNoteWork(id)
    const note = get().notes.find((n) => n.id === id)
    activeRuns.delete(id)
    set((state) => {
      const { [id]: _progress, ...processing } = state.processing
      const { [id]: _error, ...processingError } = state.processingError
      const { [id]: _proposal, ...proposals } = state.proposals
      return { processing, processingError, proposals }
    })
    await withNoteLock(id, async () => {
      await repository.deleteNote(id)
      await useTasksStore.getState().removeForNote(id)
      await deleteRecordingFile(note?.audioUri ?? null)
      set((state) => ({ notes: state.notes.filter((item) => item.id !== id) }))
    })
  },
  processWithLlm: async (id) => {
    if (
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive'
    ) {
      await waitForForeground()
      // Re-read the note/model after waiting: they may have changed or been removed.
      return get().processWithLlm(id)
    }
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    if (note.content.trim().length === 0) return
    if (activeRuns.has(id)) return
    // Without the model the note simply stays as recorded. Automatic processing
    // after a recording must not turn into a demand to download gigabytes.
    if (useModelStore.getState().status !== 'ready') return

    const revision = revisionFor(id)
    const runId = ++runSequence
    const requestedAt = Date.now()
    let queueMs = 0
    let modelLoadMs: number | null = null
    let succeeded = false
    activeRuns.set(id, runId)

    const setProgress = (progress: ProcessingProgress) => {
      if (activeRuns.get(id) !== runId || revision !== revisionFor(id)) return
      set((state) => ({ processing: { ...state.processing, [id]: progress } }))
    }
    const clear = () => {
      if (activeRuns.get(id) !== runId) return
      activeRuns.delete(id)
      set((state) => {
        const { [id]: _removed, ...processing } = state.processing
        return { processing }
      })
    }

    set((state) => {
      const { [id]: _removed, ...processingError } = state.processingError
      const { [id]: _proposal, ...proposals } = state.proposals
      return {
        processingError,
        proposals,
        processing: { ...state.processing, [id]: { phase: 'queued' } },
      }
    })

    const job = async () => {
      queueMs = Date.now() - requestedAt
      try {
        const result = await processNoteWithLlm(
          note.content.trim(),
          setProgress,
          (durationMs) => {
            modelLoadMs = durationMs
          },
        )
        succeeded = true
        await withNoteLock(id, async () => {
          const current = get().notes.find((item) => item.id === id)
          if (
            revision !== revisionFor(id) ||
            !current ||
            !sameInput(current, note)
          ) {
            if (current && activeRuns.get(id) === runId) {
              set((state) => ({
                processingError: {
                  ...state.processingError,
                  [id]: 'Notatka zmieniła się podczas opracowywania. Wynik nie został zapisany.',
                },
              }))
            }
            return
          }
          const updated = await repository.updateNote(id, {
            ...toInput(current),
            title: result.title,
            summary: result.summary.trim().length > 0 ? result.summary : null,
            tags: result.tags,
          })
          if (revision !== revisionFor(id)) return
          set((state) => ({
            notes: state.notes
              .map((item) => (item.id === id ? updated : item))
              .sort(byNewest),
          }))
        })
      } catch (e) {
        if (
          revision === revisionFor(id) &&
          get().notes.some((item) => item.id === id)
        ) {
          set((state) => ({
            processingError: {
              ...state.processingError,
              [id]: e instanceof Error ? e.message : String(e),
            },
          }))
        }
      } finally {
        recordOperationTiming({
          operation: 'note',
          inputChars: note.content.trim().length,
          queueMs,
          modelLoadMs,
          totalMs: Date.now() - requestedAt,
          succeeded,
        })
        clear()
      }
    }

    await enqueueLlm(job)
  },
  proposeWithLlm: async (id) => {
    const note = get().notes.find((item) => item.id === id)
    if (!note || note.content.trim().length === 0 || activeRuns.has(id))
      return false
    if (useModelStore.getState().status !== 'ready') return false

    const revision = revisionFor(id)
    const runId = ++runSequence
    const requestedAt = Date.now()
    let queueMs = 0
    let modelLoadMs: number | null = null
    let succeeded = false
    activeRuns.set(id, runId)
    const setProgress = (progress: ProcessingProgress) => {
      if (activeRuns.get(id) !== runId || revision !== revisionFor(id)) return
      set((state) => ({ processing: { ...state.processing, [id]: progress } }))
    }
    const clear = () => {
      if (activeRuns.get(id) !== runId) return
      activeRuns.delete(id)
      set((state) => {
        const { [id]: _removed, ...processing } = state.processing
        return { processing }
      })
    }

    set((state) => {
      const { [id]: _removed, ...processingError } = state.processingError
      const { [id]: _proposal, ...proposals } = state.proposals
      return {
        processingError,
        proposals,
        processing: { ...state.processing, [id]: { phase: 'queued' } },
      }
    })

    let proposed = false
    const job = async () => {
      queueMs = Date.now() - requestedAt
      try {
        const generated = await processNoteWithLlm(
          note.content.trim(),
          setProgress,
          (durationMs) => {
            modelLoadMs = durationMs
          },
        )
        succeeded = true
        await withNoteLock(id, async () => {
          const current = get().notes.find((item) => item.id === id)
          if (
            revision !== revisionFor(id) ||
            !current ||
            !sameInput(current, note)
          ) {
            if (current && activeRuns.get(id) === runId) {
              set((state) => ({
                processingError: {
                  ...state.processingError,
                  [id]: 'Notatka zmieniła się podczas analizy. Wygeneruj propozycję ponownie.',
                },
              }))
            }
            return
          }
          set((state) => ({
            proposals: {
              ...state.proposals,
              [id]: createNoteProposal(current, generated),
            },
          }))
          proposed = true
        })
      } catch (error) {
        if (
          revision === revisionFor(id) &&
          get().notes.some((item) => item.id === id)
        ) {
          set((state) => ({
            processingError: {
              ...state.processingError,
              [id]: error instanceof Error ? error.message : String(error),
            },
          }))
        }
      } finally {
        recordOperationTiming({
          operation: 'proposal',
          inputChars: note.content.trim().length,
          queueMs,
          modelLoadMs,
          totalMs: Date.now() - requestedAt,
          succeeded,
        })
        clear()
      }
    }

    await enqueueLlm(job)
    return proposed
  },
  applyProposal: async (id, selection) => {
    const note = get().notes.find((item) => item.id === id)
    const proposal = get().proposals[id]
    if (!note || !proposal) return false
    const input = applyNoteProposal(note, proposal, selection)
    if (!input) return false
    await get().update(id, input)
    return true
  },
  clearProposal: (id) =>
    set((state) => {
      const { [id]: _proposal, ...proposals } = state.proposals
      return { proposals }
    }),
}))
