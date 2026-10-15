import { AppState } from 'react-native'
import {
  runImportProcessing,
  type ImportContinuation,
} from './importProcessing'
import {
  runDurableProcessing,
  hasBackgroundProcessingLease,
  ProcessingPausedError,
} from './jobRunner'
import { nativeProcessing } from './nativeProcessing'
import * as repository from '../data/processingJobsRepository'
import { cancelGeneration } from '../ai/llm'

let mockExpiry:
  | ((event: { attemptId: string; reason: string }) => void)
  | undefined
jest.mock('./nativeProcessing', () => ({
  supportsBackgroundProcessing: () => true,
  nativeProcessing: {
    begin: jest.fn(async () => true),
    prepareProtectedFiles: jest.fn(async () => undefined),
    finish: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    notifyCompleted: jest.fn(async () => undefined),
    addListener: (_name: string, callback: typeof mockExpiry) => {
      mockExpiry = callback
      return { remove: jest.fn() }
    },
  },
}))
jest.mock('../data/processingJobsRepository', () => ({
  acquireProcessingJob: jest.fn(),
  readProcessingCheckpoint: jest.fn(),
  writeProcessingCheckpoint: jest.fn(),
  stageProcessingResult: jest.fn(async () => true),
  finishProcessingJob: jest.fn(async () => undefined),
}))
jest.mock('../ai/llm', () => ({
  cancelGeneration: jest.fn(async () => undefined),
}))
jest.mock('../stt/nativeCapture', () => ({
  nativeCapture: { getSnapshot: jest.fn(async () => null) },
}))
const native = jest.mocked(nativeProcessing!)
const db = jest.mocked(repository)
const request = {
  noteId: 'import-note',
  kind: 'note' as const,
  source: 'transcript-source',
  model: 'qwen',
  pipeline: 'v1',
}
beforeEach(() => {
  jest.clearAllMocks()
  AppState.currentState = 'active'
  native.begin.mockResolvedValue(true)
  db.acquireProcessingJob.mockResolvedValue({
    ...request,
    id: 'job',
    status: 'running',
    attemptId: 'child',
    checkpoints: '{}',
    result: null,
    reason: null,
    updatedAt: 1,
  })
})
afterEach(() => {
  AppState.currentState = 'active'
})

it('continues durable AI in background on the single parent lease until database commit', async () => {
  await runImportProcessing(
    new AbortController(),
    true,
    async (_report, continuation) => {
      AppState.currentState = 'background'
      await runDurableProcessing(
        request,
        async (context) => {
          expect(context.runtimeOptions?.execution).toBe('background-cpu')
          expect(hasBackgroundProcessingLease()).toBe(true)
          context.onProgress?.({ phase: 'fragment', completed: 2, total: 4 })
          return 'AI result'
        },
        async () => {
          expect(native.finish).not.toHaveBeenCalled()
          return true
        },
        { background: true, importContinuation: continuation },
      )
      expect(native.finish).not.toHaveBeenCalled()
    },
  )
  expect(native.begin).toHaveBeenCalledTimes(1)
  expect(native.finish).toHaveBeenCalledTimes(1)
  expect(native.finish).toHaveBeenCalledWith(
    native.begin.mock.calls[0][0],
    true,
  )
  expect(native.update).toHaveBeenCalledWith(
    native.begin.mock.calls[0][0],
    5800,
    expect.any(String),
    expect.any(String),
  )
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'completed',
    null,
  )
})

it('rejects a retired continuation before acquiring or running a child job', async () => {
  let retired: ImportContinuation | undefined
  await runImportProcessing(
    new AbortController(),
    true,
    async (_report, continuation) => {
      retired = continuation
    },
  )
  const run = jest.fn(async () => 'late')
  await expect(
    runDurableProcessing(request, run, async () => true, {
      importContinuation: retired,
    }),
  ).rejects.toBeInstanceOf(ProcessingPausedError)
  expect(run).not.toHaveBeenCalled()
  expect(db.acquireProcessingJob).not.toHaveBeenCalled()
})

it('rejects a forged token instead of granting permission to bypass the queue', async () => {
  await runImportProcessing(
    new AbortController(),
    true,
    async (_report, continuation) => {
      await expect(
        runDurableProcessing(
          request,
          async () => 'late',
          async () => true,
          { importContinuation: { ...continuation } },
        ),
      ).rejects.toBeInstanceOf(ProcessingPausedError)
    },
  )
  expect(db.acquireProcessingJob).not.toHaveBeenCalled()
})

it('drains an expired child before pausing it and releasing the parent lease', async () => {
  const controller = new AbortController()
  await expect(
    runImportProcessing(controller, true, async (_report, continuation) => {
      await runDurableProcessing(
        request,
        async (context) => {
          mockExpiry?.({
            attemptId: continuation.leaseAttemptId,
            reason: 'system',
          })
          expect(context.signal?.aborted).toBe(true)
          expect(native.finish).not.toHaveBeenCalled()
          await Promise.resolve()
          return 'late result'
        },
        async () => {
          throw new Error('late commit')
        },
        { importContinuation: continuation },
      )
    }),
  ).rejects.toBeInstanceOf(ProcessingPausedError)
  expect(cancelGeneration).toHaveBeenCalled()
  expect(db.stageProcessingResult).not.toHaveBeenCalled()
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'paused',
    expect.any(String),
  )
  expect(native.finish).toHaveBeenCalledWith(expect.any(String), false)
})
