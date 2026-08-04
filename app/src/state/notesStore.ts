import { create } from 'zustand'
import type { Note, NoteInput } from '../domain/note'
import * as repository from '../data/notesRepository'
import { processNoteWithLlm, type ProcessingProgress } from '../ai/noteProcessing'
import { enqueueLlm } from '../ai/llmQueue'
import { deleteRecordingFile } from '../audio/audioFiles'
import { useTasksStore } from './tasksStore'
import { useModelStore } from './modelStore'

interface NotesState {
  notes: Note[]
  loaded: boolean
  processing: Record<string, ProcessingProgress>
  processingError: Record<string, string>
  load: () => Promise<void>
  add: (input: NoteInput) => Promise<Note>
  update: (id: string, input: NoteInput) => Promise<void>
  remove: (id: string) => Promise<void>
  processWithLlm: (id: string) => Promise<void>
}

const byNewest = (a: Note, b: Note): number => b.updatedAt - a.updatedAt

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
    const updated = await repository.updateNote(id, input)
    set({ notes: get().notes.map((n) => (n.id === id ? updated : n)).sort(byNewest) })
  },
  remove: async (id) => {
    const note = get().notes.find((n) => n.id === id)
    await repository.deleteNote(id)
    await useTasksStore.getState().removeForNote(id)
    await deleteRecordingFile(note?.audioUri ?? null)
    set((state) => {
      const { [id]: _p, ...processing } = state.processing
      const { [id]: _e, ...processingError } = state.processingError
      return { notes: state.notes.filter((n) => n.id !== id), processing, processingError }
    })
  },
  processWithLlm: async (id) => {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    if (note.content.trim().length === 0) return
    if (get().processing[id]) return
    // Without the model the note simply stays as recorded. Automatic processing
    // after a recording must not turn into a demand to download gigabytes.
    if (useModelStore.getState().status !== 'ready') return

    const setProgress = (progress: ProcessingProgress) =>
      set((state) => ({ processing: { ...state.processing, [id]: progress } }))
    const clear = () =>
      set((state) => {
        const { [id]: _removed, ...processing } = state.processing
        return { processing }
      })

    set((state) => {
      const { [id]: _removed, ...processingError } = state.processingError
      return { processingError, processing: { ...state.processing, [id]: { phase: 'loading' } } }
    })

    const job = async () => {
      try {
        const result = await processNoteWithLlm(note.content.trim(), setProgress)
        await get().update(id, {
          ...toInput(note),
          title: result.title,
          summary: result.summary,
          tags: result.tags,
        })
      } catch (e) {
        set((state) => ({
          processingError: {
            ...state.processingError,
            [id]: e instanceof Error ? e.message : String(e),
          },
        }))
      } finally {
        clear()
      }
    }

    await enqueueLlm(job)
  },
}))
