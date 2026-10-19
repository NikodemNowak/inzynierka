import { create } from 'zustand'
import { AppState } from 'react-native'
import { waitForForeground } from '../ai/foreground'
import type { Note, NoteInput } from '../domain/note'
import { parseSummaryDocument, sameSummaryDocument } from '../domain/summary'
import * as repository from '../data/notesRepository'
import {
  processNoteWithLlm,
  type NoteProcessingResult,
  type ProcessingProgress,
} from '../ai/noteProcessing'
import { enqueueLlm } from '../ai/llmQueue'
import { recordOperationTiming } from '../ai/generationMetrics'
import { deleteRecordingFile } from '../audio/audioFiles'
import { useTasksStore } from './tasksStore'
import { useModelStore } from './modelStore'
import { useSettingsStore } from './settingsStore'
import { noteLanguageOrDefault } from '../i18n/language'
import { translate } from '../i18n/translate'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { jobSourceIdentity } from '../processing/jobIdentity'
import {
  runDurableProcessing,
  pauseNoteProcessing,
  type ProcessingRunOptions,
} from '../processing/jobRunner'
import {
  isImportContinuationActive,
  reportImportAiProgress,
} from '../processing/importProcessing'
import {
  recoverProcessingJobs,
  invalidateProcessingJobs,
  discardPendingProcessingResult,
} from '../data/processingJobsRepository'
import {
  isNoteProcessingResult,
  parseSavedProcessingResult,
} from '../processing/savedResults'
import {
  applyNoteProposal,
  createNoteProposal,
  isNoteProposalCurrent,
  type NoteProposal,
  type NoteProposalSelection,
} from '../notes/noteProposals'

interface NotesState {
  notes: Note[]
  loaded: boolean
  processing: Record<string, ProcessingProgress>
  processingError: Record<string, string>
  resumableProcessing: Record<string, 'note' | 'proposal'>
  proposals: Record<string, NoteProposal>
  load: () => Promise<void>
  add: (input: NoteInput) => Promise<Note>
  addRecovered: (input: NoteInput, sessionId: string) => Promise<Note>
  applyTranscript: (
    id: string,
    expected: { updatedAt: number; content: string; audioUri: string | null },
    transcript: string,
    durationMs: number,
    incomplete?: boolean,
  ) => Promise<boolean>
  update: (id: string, input: NoteInput) => Promise<void>
  remove: (id: string) => Promise<void>
  processWithLlm: (id: string, options?: ProcessingRunOptions) => Promise<void>
  proposeWithLlm: (
    id: string,
    options?: ProcessingRunOptions,
  ) => Promise<boolean>
  pauseProcessing: (id: string) => Promise<void>
  resumeProcessing: (
    id: string,
    options?: ProcessingRunOptions,
  ) => Promise<void>
  applyProposal: (
    id: string,
    selection: NoteProposalSelection,
  ) => Promise<boolean>
  clearProposal: (id: string, expected?: NoteProposal) => Promise<boolean>
}

const byNewest = (a: Note, b: Note): number => b.updatedAt - a.updatedAt

const revisions = new Map<string, number>()
const noteQueues = new Map<string, Promise<void>>()
const activeRuns = new Map<string, number>()
const pendingProposalDiscards = new Set<string>()
const runKinds = new Map<number, 'note' | 'proposal'>()
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
    a.language === b.language &&
    Boolean(a.transcriptionIncomplete) === Boolean(b.transcriptionIncomplete) &&
    a.summary === b.summary &&
    sameSummaryDocument(a.summaryDocument, b.summaryDocument) &&
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
  summaryDocument: note.summaryDocument ?? null,
  tags: note.tags,
  audioUri: note.audioUri,
  durationMs: note.durationMs,
  language: noteLanguageOrDefault(note.language),
  transcriptionIncomplete: note.transcriptionIncomplete,
})

const hasCurrentSummaryDocument = (result: NoteProcessingResult, content: string): boolean =>
  result.failedFields?.includes('summary') === true ||
  result.summaryDocument == null ||
  parseSummaryDocument(result.summaryDocument, content, result.summary) !== null

// Title and category calls follow the summary; its live drafts stay on screen until the result.
export const keepLiveDrafts = (
  previous: ProcessingProgress | undefined,
  next: ProcessingProgress,
): ProcessingProgress =>
  next.live || !previous?.live || (next.phase !== 'title' && next.phase !== 'tags')
    ? next
    : { ...next, live: previous.live }

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  processing: {},
  processingError: {},
  resumableProcessing: {},
  proposals: {},
  load: async () => {
    const notes = await repository.listNotes()
    const firstLoad = !get().loaded
    set({ notes, loaded: true })
    if (firstLoad && activeRuns.size === 0) {
      const paused = await recoverProcessingJobs()
      const restored: Record<string, NoteProposal> = {}
      for (const job of paused) {
        if (
          job.kind !== 'proposal' ||
          job.status !== 'pending' ||
          job.model !== MODEL_CONFIG.url ||
          job.pipeline !== PIPELINE_VERSION
        )
          continue
        const note = notes.find((item) => item.id === job.noteId)
        if (!note || job.source !== jobSourceIdentity(toInput(note))) continue
        const generated = parseSavedProcessingResult(
          job.result,
          isNoteProcessingResult,
        )
        if (generated && hasCurrentSummaryDocument(generated, note.content))
          restored[job.noteId] = createNoteProposal(note, generated)
      }
      set((state) => ({
        resumableProcessing: Object.fromEntries(
          paused
            .filter(
              (job) =>
                job.kind !== 'tasks' &&
                job.status !== 'pending' &&
                notes.some((note) => note.id === job.noteId),
            )
            .map((job) => [job.noteId, job.kind as 'note' | 'proposal']),
        ),
        processingError: {
          ...state.processingError,
          ...Object.fromEntries(
            paused
              .filter(
                (job) =>
                  job.status !== 'pending' &&
                  notes.some((note) => note.id === job.noteId),
              )
              .map((job) => [
                job.noteId,
                translate(
                  'Opracowanie zostało przerwane. Możesz je wznowić z zapisanym postępem.',
                  'Processing was interrupted. You can resume with saved progress.',
                ),
              ]),
          ),
        },
        proposals: { ...state.proposals, ...restored },
      }))
    }
  },
  add: async (input) => {
    const note = await repository.createNote(input)
    set({ notes: [note, ...get().notes] })
    return note
  },
  addRecovered: async (input, sessionId) => {
    const note = await repository.createNote(input, sessionId)
    set((state) => ({
      notes: [note, ...state.notes.filter((item) => item.id !== note.id)].sort(
        byNewest,
      ),
    }))
    return note
  },
  applyTranscript: async (
    id,
    expected,
    transcript,
    durationMs,
    incomplete = false,
  ) =>
    withNoteLock(id, async () => {
      const current = get().notes.find((item) => item.id === id)
      if (
        !current ||
        current.updatedAt !== expected.updatedAt ||
        current.content !== expected.content ||
        current.audioUri !== expected.audioUri
      )
        return false
      const revision = invalidateNoteWork(id)
      await pauseNoteProcessing(id, 'source-changed')
      const stored = await repository.getNote(id)
      if (
        !stored ||
        revision !== revisionFor(id) ||
        stored.updatedAt !== expected.updatedAt ||
        stored.content !== expected.content ||
        stored.audioUri !== expected.audioUri
      )
        return false
      const updated = await repository.updateNote(id, {
        ...toInput(current),
        content: transcript,
        summaryDocument: null,
        durationMs,
        transcriptionIncomplete: incomplete,
      })
      await invalidateProcessingJobs(id)
      if (revision !== revisionFor(id)) return false
      set((state) => {
        const { [id]: _error, ...processingError } = state.processingError
        const { [id]: _resume, ...resumableProcessing } =
          state.resumableProcessing
        const { [id]: _proposal, ...proposals } = state.proposals
        return {
          notes: state.notes
            .map((item) => (item.id === id ? updated : item))
            .sort(byNewest),
          processingError,
          resumableProcessing,
          proposals,
        }
      })
      return true
    }),
  pauseProcessing: async (id) => {
    const runId = activeRuns.get(id)
    if (runId !== undefined && get().processing[id]?.phase === 'queued') {
      const kind = runKinds.get(runId) ?? 'note'
      activeRuns.delete(id)
      set((state) => {
        const { [id]: _progress, ...processing } = state.processing
        return {
          processing,
          resumableProcessing: { ...state.resumableProcessing, [id]: kind },
        }
      })
    }
    await pauseNoteProcessing(id)
  },
  resumeProcessing: async (id, options) => {
    if (get().resumableProcessing[id] === 'proposal')
      await get().proposeWithLlm(id, options)
    else await get().processWithLlm(id, options)
  },
  update: async (id, input) => {
    const revision = invalidateNoteWork(id)
    await pauseNoteProcessing(id, 'source-changed')
    set((state) => {
      const { [id]: _proposal, ...proposals } = state.proposals
      const { [id]: _error, ...processingError } = state.processingError
      const { [id]: _resume, ...resumableProcessing } =
        state.resumableProcessing
      return { proposals, processingError, resumableProcessing }
    })
    await withNoteLock(id, async () => {
      const current = get().notes.find((note) => note.id === id)
      const updated = await repository.updateNote(id, current && current.content !== input.content
        ? { ...input, summaryDocument: null }
        : input)
      // The source/result is kept until the replacement note is durable. Abort
      // and revision fences already prevent the old attempt from committing.
      await invalidateProcessingJobs(id)
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
    await pauseNoteProcessing(id, 'deleted')
    await invalidateProcessingJobs(id)
    const note = get().notes.find((n) => n.id === id)
    activeRuns.delete(id)
    set((state) => {
      const { [id]: _progress, ...processing } = state.processing
      const { [id]: _error, ...processingError } = state.processingError
      const { [id]: _proposal, ...proposals } = state.proposals
      const { [id]: _resume, ...resumableProcessing } =
        state.resumableProcessing
      return { processing, processingError, proposals, resumableProcessing }
    })
    await withNoteLock(id, async () => {
      await repository.deleteNote(id)
      await useTasksStore.getState().removeForNote(id)
      await deleteRecordingFile(note?.audioUri ?? null)
      set((state) => ({ notes: state.notes.filter((item) => item.id !== id) }))
    })
  },
  processWithLlm: async (
    id,
    options = { background: useSettingsStore.getState().backgroundProcessing },
  ) => {
    const continuation = options.importContinuation
    if (continuation && !isImportContinuationActive(continuation))
      throw new Error(
        translate(
          'Import został wstrzymany. Wynik można wznowić z notatki.',
          'Import has paused. You can resume from the note.',
        ),
      )
    if (
      (AppState.currentState === 'background' ||
        AppState.currentState === 'inactive') &&
      !(continuation?.background && isImportContinuationActive(continuation))
    ) {
      await waitForForeground()
      // Re-read the note/model after waiting: they may have changed or been removed.
      return get().processWithLlm(id, options)
    }
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    if (note.transcriptionIncomplete) {
      set((state) => ({ processingError: { ...state.processingError, [id]: translate(
        'Najpierw uzupełnij transkrypcję z zachowanego audio. AI wymaga kompletnego tekstu.',
        'Complete the transcript from the saved audio first. AI needs the complete text.',
      ) } }))
      return
    }
    if (note.content.trim().length === 0) return
    if (activeRuns.has(id) || pendingProposalDiscards.has(id)) return
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
    runKinds.set(runId, 'note')

    const setProgress = (progress: ProcessingProgress) => {
      if (activeRuns.get(id) !== runId || revision !== revisionFor(id)) return
      set((state) => ({ processing: { ...state.processing, [id]: keepLiveDrafts(state.processing[id], progress) } }))
      if (progress.phase !== 'queued')
        reportImportAiProgress(
          continuation,
          progress.phase,
          progress.completed,
          progress.total,
        )
    }
    const clear = () => {
      runKinds.delete(runId)
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
      const { [id]: _resume, ...resumableProcessing } =
        state.resumableProcessing
      return {
        processingError,
        proposals,
        resumableProcessing,
        processing: { ...state.processing, [id]: { phase: 'queued' } },
      }
    })

    const job = async () => {
      queueMs = Date.now() - requestedAt
      try {
        const latest = get().notes.find((item) => item.id === id)
        if (
          activeRuns.get(id) !== runId ||
          revision !== revisionFor(id) ||
          !latest ||
          !sameInput(latest, note)
        )
          return
        await runDurableProcessing(
          {
            noteId: id,
            kind: 'note',
            source: jobSourceIdentity(toInput(note)),
            model: MODEL_CONFIG.url,
            pipeline: PIPELINE_VERSION,
          },
          (execution) =>
            processNoteWithLlm(
              note.content,
              setProgress,
              (durationMs) => {
                modelLoadMs = durationMs
              },
              noteLanguageOrDefault(note.language),
              execution,
              true,
            ),
          async (result) =>
            withNoteLock(id, async () => {
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
                      [id]: translate(
                        'Notatka zmieniła się podczas opracowywania. Wynik nie został zapisany.',
                        'The note changed during processing. The result was not saved.',
                      ),
                    },
                  }))
                }
                return false
              }
              if (!hasCurrentSummaryDocument(result, current.content)) {
                set((state) => ({ processingError: {
                  ...state.processingError,
                  [id]: translate('Źródła podsumowania nie pasują do notatki. Wynik nie został zapisany.',
                    'Summary sources do not match the note. The result was not saved.'),
                } }))
                return false
              }
              const updated = await repository.updateNote(id, {
                ...toInput(current),
                title: result.failedFields?.includes('title')
                  ? current.title
                  : result.title,
                summary: result.failedFields?.includes('summary')
                  ? current.summary
                  : result.summary.trim().length > 0
                    ? result.summary
                    : null,
                summaryDocument: result.failedFields?.includes('summary')
                  ? current.summaryDocument ?? null
                  : result.summaryDocument ?? null,
                tags: result.failedFields?.includes('tags')
                  ? current.tags
                  : result.tags,
              })
              if (revision !== revisionFor(id)) return false
              set((state) => ({
                notes: state.notes
                  .map((item) => (item.id === id ? updated : item))
                  .sort(byNewest),
                processingError: result.warnings?.length
                  ? {
                      ...state.processingError,
                      [id]: result.warnings.join('\n'),
                    }
                  : state.processingError,
              }))
              succeeded = !result.failedFields?.length
              return true
            }),
          options,
          (progress) =>
            setProgress({
              ...progress,
              phase: progress.phase === 'tasks' ? 'fragment' : progress.phase,
            }),
          isNoteProcessingResult,
        )
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
            resumableProcessing: { ...state.resumableProcessing, [id]: 'note' },
          }))
        }
        if (continuation) throw e
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

    // A verified import callback already holds this queue. Enqueueing its AI
    // continuation behind itself would prevent either stage from completing.
    if (isImportContinuationActive(continuation)) await job()
    else await enqueueLlm(job)
  },
  proposeWithLlm: async (
    id,
    options = { background: useSettingsStore.getState().backgroundProcessing },
  ) => {
    const note = get().notes.find((item) => item.id === id)
    if (note?.transcriptionIncomplete) {
      set((state) => ({ processingError: { ...state.processingError, [id]: translate(
        'Najpierw uzupełnij transkrypcję z zachowanego audio. AI wymaga kompletnego tekstu.',
        'Complete the transcript from the saved audio first. AI needs the complete text.',
      ) } }))
      return false
    }
    if (
      !note ||
      note.content.trim().length === 0 ||
      activeRuns.has(id) ||
      pendingProposalDiscards.has(id)
    )
      return false
    if (useModelStore.getState().status !== 'ready') return false

    const revision = revisionFor(id)
    const runId = ++runSequence
    const requestedAt = Date.now()
    let queueMs = 0
    let modelLoadMs: number | null = null
    let succeeded = false
    activeRuns.set(id, runId)
    runKinds.set(runId, 'proposal')
    const setProgress = (progress: ProcessingProgress) => {
      if (activeRuns.get(id) !== runId || revision !== revisionFor(id)) return
      set((state) => ({ processing: { ...state.processing, [id]: keepLiveDrafts(state.processing[id], progress) } }))
    }
    const clear = () => {
      runKinds.delete(runId)
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
      const { [id]: _resume, ...resumableProcessing } =
        state.resumableProcessing
      return {
        processingError,
        proposals,
        resumableProcessing,
        processing: { ...state.processing, [id]: { phase: 'queued' } },
      }
    })

    let proposed = false
    const job = async () => {
      queueMs = Date.now() - requestedAt
      try {
        const latest = get().notes.find((item) => item.id === id)
        if (
          activeRuns.get(id) !== runId ||
          revision !== revisionFor(id) ||
          !latest ||
          !sameInput(latest, note)
        )
          return
        await runDurableProcessing(
          {
            noteId: id,
            kind: 'proposal',
            source: jobSourceIdentity(toInput(note)),
            model: MODEL_CONFIG.url,
            pipeline: PIPELINE_VERSION,
          },
          (execution) =>
            processNoteWithLlm(
              note.content,
              setProgress,
              (durationMs) => {
                modelLoadMs = durationMs
              },
              noteLanguageOrDefault(note.language),
              execution,
              true,
            ),
          async (generated) =>
            withNoteLock(id, async () => {
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
                      [id]: translate(
                        'Notatka zmieniła się podczas analizy. Wygeneruj propozycję ponownie.',
                        'The note changed during analysis. Generate a new suggestion.',
                      ),
                    },
                  }))
                }
                return false
              }
              if (!hasCurrentSummaryDocument(generated, current.content)) return false
              set((state) => ({
                proposals: {
                  ...state.proposals,
                  [id]: createNoteProposal(current, generated),
                },
              }))
              proposed = true
              succeeded = !generated.failedFields?.length
              return true
            }),
          options,
          (progress) =>
            setProgress({
              ...progress,
              phase: progress.phase === 'tasks' ? 'fragment' : progress.phase,
            }),
          isNoteProcessingResult,
        )
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
            resumableProcessing: {
              ...state.resumableProcessing,
              [id]: 'proposal',
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
    if (!note || !proposal || pendingProposalDiscards.has(id)) return false
    const input = applyNoteProposal(note, proposal, selection)
    if (!input) return false
    await get().update(id, input)
    return true
  },
  clearProposal: async (id, expected) => {
    const note = get().notes.find((item) => item.id === id)
    const proposal = get().proposals[id]
    if (
      !note ||
      !proposal ||
      (expected !== undefined && proposal !== expected) ||
      !isNoteProposalCurrent(note, proposal) ||
      activeRuns.has(id) ||
      pendingProposalDiscards.has(id)
    )
      return false
    const revision = revisionFor(id)
    const isCurrent = (): boolean => {
      const current = get().notes.find((item) => item.id === id)
      return (
        revision === revisionFor(id) &&
        get().proposals[id] === proposal &&
        Boolean(current && sameInput(current, note)) &&
        !activeRuns.has(id)
      )
    }
    pendingProposalDiscards.add(id)
    try {
      return await withNoteLock(id, async () => {
        if (!isCurrent()) return false
        await discardPendingProcessingResult(
          id,
          'proposal',
          jobSourceIdentity(toInput(note)),
        )
        if (!isCurrent()) return false
        set((state) => {
          const { [id]: _proposal, ...proposals } = state.proposals
          const { [id]: _error, ...processingError } = state.processingError
          return { proposals, processingError }
        })
        return true
      })
    } catch (error) {
      if (isCurrent())
        set((state) => ({
          processingError: {
            ...state.processingError,
            [id]: error instanceof Error ? error.message : String(error),
          },
        }))
      return false
    } finally {
      pendingProposalDiscards.delete(id)
    }
  },
}))
