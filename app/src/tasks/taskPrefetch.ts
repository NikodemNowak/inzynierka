import { create } from 'zustand'
import { enqueueLlm } from '../ai/llmQueue'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { ensureModelReady } from '../ai/noteProcessing'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { createTaskProposal, type TaskProposal } from '../ai/taskProposal'
import { findPendingProcessingResult } from '../data/processingJobsRepository'
import { taskSourceIdentity } from '../processing/jobIdentity'
import { runDurableProcessing } from '../processing/jobRunner'
import { isTaskProposalResult, parseSavedProcessingResult } from '../processing/savedResults'
import { useNotesStore } from '../state/notesStore'
import { useSettingsStore } from '../state/settingsStore'

// Task suggestions computed right after a note finishes processing, so they are
// ready when the note is opened. The result is the same durable 'tasks' job the
// "Suggest tasks" button runs; the note screen reads it from storage.
interface TaskPrefetchState {
  running: Record<string, true>
  // Bumped when a prefetch for the note settles, so an open screen re-reads storage.
  settled: Record<string, number>
}

export const useTaskPrefetchStore = create<TaskPrefetchState>(() => ({ running: {}, settled: {} }))

const setRunning = (noteId: string, running: boolean): void =>
  useTaskPrefetchStore.setState((state) => {
    const next = { ...state.running }
    if (running) next[noteId] = true
    else delete next[noteId]
    return running ? { running: next } : { running: next, settled: { ...state.settled, [noteId]: (state.settled[noteId] ?? 0) + 1 } }
  })

const currentNote = (noteId: string) => useNotesStore.getState().notes.find((note) => note.id === noteId)

export const prefetchTaskProposal = async (noteId: string): Promise<TaskProposal | null> => {
  const note = currentNote(noteId)
  if (!note || note.transcriptionIncomplete || !note.content.trim()) return null
  if (useTaskPrefetchStore.getState().running[noteId] || useNotesStore.getState().processing[noteId]) return null
  const identity = taskSourceIdentity(note)
  const request = { noteId, kind: 'tasks' as const, source: identity, model: MODEL_CONFIG.url, pipeline: PIPELINE_VERSION }
  const content = note.content
  const saved = parseSavedProcessingResult(await findPendingProcessingResult(request), (value): value is TaskProposal =>
    isTaskProposalResult(value, content))
  if (saved) return saved
  const sourceIsCurrent = (): boolean => {
    const current = currentNote(noteId)
    return Boolean(current && !current.transcriptionIncomplete && taskSourceIdentity(current) === identity)
  }
  setRunning(noteId, true)
  try {
    return await enqueueLlm(async () => {
      if (!sourceIsCurrent() || useNotesStore.getState().processing[noteId]) return null
      return runDurableProcessing(
        request,
        async (execution) => {
          await ensureModelReady(() => undefined, () => undefined, execution)
          return createTaskProposal(content.trim(), () => undefined, note.language ?? 'pl', execution, true)
        },
        async () => sourceIsCurrent(),
        { background: useSettingsStore.getState().backgroundProcessing },
        undefined,
        (value): value is TaskProposal => isTaskProposalResult(value, content),
      )
    })
  } catch {
    // A failed prefetch leaves the button: the user can still ask for suggestions.
    return null
  } finally {
    setRunning(noteId, false)
  }
}

// Start a prefetch when a note's processing ends without an error.
export const startTaskPrefetch = (): (() => void) =>
  useNotesStore.subscribe((state, previous) => {
    if (!useSettingsStore.getState().autoTaskSuggestions) return
    for (const id of Object.keys(previous.processing)) {
      if (state.processing[id] || state.processingError[id]) continue
      void prefetchTaskProposal(id)
    }
  })
