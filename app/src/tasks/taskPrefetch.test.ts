import { prefetchTaskProposal, startTaskPrefetch, useTaskPrefetchStore } from './taskPrefetch'
import { useNotesStore } from '../state/notesStore'
import { useSettingsStore } from '../state/settingsStore'
import { runDurableProcessing } from '../processing/jobRunner'
import { findPendingProcessingResult } from '../data/processingJobsRepository'

jest.mock('../ai/llmQueue', () => ({ enqueueLlm: (run: () => Promise<unknown>) => run() }))
jest.mock('../ai/noteProcessing', () => ({ ensureModelReady: jest.fn(async () => undefined) }))
jest.mock('../ai/taskProposal', () => ({ createTaskProposal: jest.fn(async () => ({ tasks: ['Kupić mleko'], warnings: [] })) }))
jest.mock('../data/processingJobsRepository', () => ({ findPendingProcessingResult: jest.fn(async () => null) }))
jest.mock('../processing/jobRunner', () => ({ runDurableProcessing: jest.fn() }))
jest.mock('../processing/jobIdentity', () => ({ jobSourceIdentity: (note: { content: string }) => `id:${note.content}` }))
jest.mock('../processing/savedResults', () => ({
  parseSavedProcessingResult: (value: unknown) => value ?? null,
  isTaskProposalResult: () => true,
}))
jest.mock('../state/notesStore', () => {
  const { create } = jest.requireActual('zustand')
  return { useNotesStore: create(() => ({ notes: [], processing: {}, processingError: {} })) }
})
jest.mock('../state/settingsStore', () => {
  const { create } = jest.requireActual('zustand')
  return { useSettingsStore: create(() => ({ autoTaskSuggestions: true, backgroundProcessing: false })) }
})

import type { Note } from '../domain/note'

const note: Note = { id: 'n1', title: '', content: 'Muszę kupić mleko.', summary: null, tags: [], audioUri: null, durationMs: null, createdAt: 1, updatedAt: 1, language: 'pl', transcriptionIncomplete: false }
const run = jest.mocked(runDurableProcessing)

beforeEach(() => {
  run.mockReset().mockImplementation(async (_request, job) => job({} as never))
  jest.mocked(findPendingProcessingResult).mockResolvedValue(null)
  useTaskPrefetchStore.setState({ running: {}, settled: {} })
  useSettingsStore.setState({ autoTaskSuggestions: true })
  useNotesStore.setState({ notes: [note], processing: {}, processingError: {} })
})

test('computes suggestions once and marks the note settled', async () => {
  await expect(prefetchTaskProposal('n1')).resolves.toEqual({ tasks: ['Kupić mleko'], warnings: [] })
  expect(run).toHaveBeenCalledTimes(1)
  expect(useTaskPrefetchStore.getState().running).toEqual({})
  expect(useTaskPrefetchStore.getState().settled.n1).toBe(1)
})

test('reuses a saved result without running the model', async () => {
  jest.mocked(findPendingProcessingResult).mockResolvedValue({ tasks: ['Zapisane'], warnings: [] } as never)
  await expect(prefetchTaskProposal('n1')).resolves.toEqual({ tasks: ['Zapisane'], warnings: [] })
  expect(run).not.toHaveBeenCalled()
})

test('skips incomplete transcripts and empty notes', async () => {
  useNotesStore.setState({ notes: [{ ...note, transcriptionIncomplete: true }] })
  await expect(prefetchTaskProposal('n1')).resolves.toBeNull()
  useNotesStore.setState({ notes: [{ ...note, content: '  ' }] })
  await expect(prefetchTaskProposal('n1')).resolves.toBeNull()
  expect(run).not.toHaveBeenCalled()
})

test('starts after processing ends without an error, and only when enabled', async () => {
  const stop = startTaskPrefetch()
  useNotesStore.setState({ processing: { n1: { phase: 'summary' } } })
  useNotesStore.setState({ processing: {} })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(1)

  run.mockClear()
  useNotesStore.setState({ processing: { n1: { phase: 'summary' } } })
  useNotesStore.setState({ processing: {}, processingError: { n1: 'failed' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(run).not.toHaveBeenCalled()

  useSettingsStore.setState({ autoTaskSuggestions: false })
  useNotesStore.setState({ processing: { n1: { phase: 'summary' } }, processingError: {} })
  useNotesStore.setState({ processing: {} })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(run).not.toHaveBeenCalled()
  stop()
})

test('a failed prefetch leaves no running flag', async () => {
  run.mockRejectedValueOnce(new Error('busy'))
  await expect(prefetchTaskProposal('n1')).resolves.toBeNull()
  expect(useTaskPrefetchStore.getState().running).toEqual({})
})
