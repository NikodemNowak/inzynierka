import { AppState } from 'react-native'
import { nativeProcessing } from './nativeProcessing'
import {
  runImportProcessing,
  pauseImportProcessing,
  isImportContinuationActive,
  registerImportProcessing,
  reportImportAiProgress,
} from './importProcessing'

const mockEvents: Record<string, (value?: string) => void> = {}
let mockExpiration:
  | ((event: { attemptId: string; reason: string }) => void)
  | undefined
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (values: Record<string, unknown>) =>
      values.ios ?? values.native ?? values.default,
  },
  TurboModuleRegistry: { get: () => null, getEnforcing: () => null },
  AppState: {
    currentState: 'active',
    addEventListener: (name: string, listener: (value?: string) => void) => {
      mockEvents[name] = listener
      return { remove: jest.fn() }
    },
  },
}))
jest.mock('../i18n/translate', () => ({
  translate: (_pl: string, en: string) => en,
}))
jest.mock('./nativeProcessing', () => ({
  supportsBackgroundProcessing: () => true,
  nativeProcessing: {
    begin: jest.fn(async () => true),
    prepareProtectedFiles: jest.fn(async () => undefined),
    finish: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    addListener: (_name: string, callback: typeof mockExpiration) => {
      mockExpiration = callback
      return { remove: jest.fn() }
    },
  },
}))
const native = jest.mocked(nativeProcessing!)
beforeEach(() => {
  jest.clearAllMocks()
  AppState.currentState = 'active'
  native.begin.mockResolvedValue(true)
})

it('uses a truthful generic AI label after model readiness without adding estimated work', async () => {
  await runImportProcessing(new AbortController(), true, async (_progress, continuation) => {
    reportImportAiProgress(continuation, 'processing')
    expect(native.update).toHaveBeenLastCalledWith(
      continuation.leaseAttemptId, 4000, 'Importing recording', 'Processing text',
    )
  })
})

it('keeps granted import running in background and reports completed windows', async () => {
  const controller = new AbortController()
  await runImportProcessing(controller, true, async (progress) => {
    mockEvents.change('background')
    expect(controller.signal.aborted).toBe(false)
    progress(3, 10)
    return 'saved'
  })
  expect(native.update).toHaveBeenCalledWith(
    expect.any(String),
    1200,
    expect.any(String),
    '3/10',
  )
  expect(native.finish).toHaveBeenCalledWith(expect.any(String), true)
})

it('does not transcribe after a denied background grant', async () => {
  native.begin.mockResolvedValueOnce(false)
  const work = jest.fn()
  await expect(
    runImportProcessing(new AbortController(), true, work),
  ).rejects.toThrow('did not grant')
  expect(work).not.toHaveBeenCalled()
})

it('aborts foreground imports when hidden and preserves their checkpoints', async () => {
  const controller = new AbortController()
  await expect(
    runImportProcessing(controller, false, async () => {
      mockEvents.change('background')
      expect(controller.signal.aborted).toBe(true)
      return 'late'
    }),
  ).rejects.toThrow('paused')
  expect(native.begin).not.toHaveBeenCalled()
})

it('does not release a granted lease until expired work has settled', async () => {
  const controller = new AbortController()
  await expect(
    runImportProcessing(controller, true, async () => {
      const attemptId = native.begin.mock.calls[0][0]
      mockExpiration?.({ attemptId, reason: 'system' })
      expect(controller.signal.aborted).toBe(true)
      expect(native.finish).not.toHaveBeenCalled()
      await Promise.resolve()
      return 'late'
    }),
  ).rejects.toThrow('paused')
  expect(native.finish).toHaveBeenCalledWith(expect.any(String), false)
})

it('lets a new microphone request cancel an import before joining the shared queue', async () => {
  await expect(
    runImportProcessing(new AbortController(), false, async () => {
      pauseImportProcessing()
      return 'late'
    }),
  ).rejects.toThrow('paused')
})

it('issues a continuation only while its parent import is alive', async () => {
  let saved: Parameters<typeof isImportContinuationActive>[0]
  await runImportProcessing(
    new AbortController(),
    true,
    async (_progress, continuation) => {
      saved = continuation
      expect(isImportContinuationActive(continuation)).toBe(true)
      expect(isImportContinuationActive({ ...continuation })).toBe(false)
      expect(continuation.background).toBe(true)
      expect(continuation.leaseAttemptId).toBe(native.begin.mock.calls[0][0])
    },
  )
  expect(isImportContinuationActive(saved!)).toBe(false)
})

it('cancels imports already waiting in the heavy-work queue', () => {
  const controller = new AbortController()
  const unregister = registerImportProcessing(controller)
  pauseImportProcessing()
  expect(controller.signal.aborted).toBe(true)
  unregister()
})
