import { Platform } from 'react-native'
import { verifyFileNatively } from './nativeFileVerification'

interface ProgressEvent { id: string; bytes: number; totalBytes: number }
let mockListeners: ((event: ProgressEvent) => void)[] = []
let mockRemove: jest.Mock
let mockNative: {
  verifyFile?: jest.Mock
  cancelVerification?: jest.Mock
  addListener: jest.Mock
} | null
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => mockNative,
}))
jest.mock('./llm', () => ({
  GenerationCancelledError: class extends Error {
    constructor() { super('Cancelled'); this.name = 'GenerationCancelledError' }
  },
}))
const sha256 = 'a'.repeat(64)
const result = { sha256, sizeBytes: 100, durationMs: 12 }

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  mockListeners = []
  mockRemove = jest.fn()
  mockNative = {
    verifyFile: jest.fn(async () => result),
    cancelVerification: jest.fn(async () => undefined),
    addListener: jest.fn((_name: string, listener: (event: ProgressEvent) => void) => {
      mockListeners.push(listener)
      return { remove: mockRemove }
    }),
  }
})

test('routes only matching native progress and removes the listener after completion', async () => {
  const progress = jest.fn()
  mockNative!.verifyFile!.mockImplementation(async (id: string) => {
    const listener = mockListeners[0]
    listener({ id: 'other-request', bytes: 90, totalBytes: 100 })
    listener({ id, bytes: 50, totalBytes: 100 })
    return result
  })
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256, undefined, progress)).resolves.toEqual(result)
  expect(mockNative!.verifyFile).toHaveBeenCalledWith(
    expect.stringMatching(/^verification-[A-Za-z0-9-]+$/),
    'file:///docs/model.gguf', 100, sha256,
  )
  expect(mockNative!.addListener).toHaveBeenCalledWith('verificationProgress', expect.any(Function))
  expect(progress.mock.calls.map(([value]) => value)).toEqual([50, 100])
  expect(mockRemove).toHaveBeenCalledTimes(1)
  mockListeners[0]({ id: mockNative!.verifyFile!.mock.calls[0][0] as string, bytes: 100, totalBytes: 100 })
  expect(progress).toHaveBeenCalledTimes(2)
})

test('returns unavailable on Android or an older module instead of starting native work', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256)).resolves.toBeNull()
  expect(mockNative!.verifyFile).not.toHaveBeenCalled()
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  delete mockNative!.verifyFile
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256)).resolves.toBeNull()
  expect(mockNative!.addListener).not.toHaveBeenCalled()
})

test.each([
  { ...result, sha256: 'b'.repeat(64) },
  { ...result, sizeBytes: 99 },
])('rejects a wrong native hash or size: %p', async (invalid) => {
  mockNative!.verifyFile!.mockResolvedValue(invalid)
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256)).rejects.toThrow()
  expect(mockRemove).toHaveBeenCalledTimes(1)
})

test('propagates a native integrity error and removes the listener', async () => {
  mockNative!.verifyFile!.mockRejectedValue(new Error('Native checksum mismatch'))
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256)).rejects.toThrow('Native checksum mismatch')
  expect(mockRemove).toHaveBeenCalledTimes(1)
})

test('normalizes owner-destruction cancellation without requiring an aborted JS signal', async () => {
  mockNative!.verifyFile!.mockRejectedValue(
    Object.assign(new Error('native cancelled'), { code: 'verification-cancelled' }),
  )
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256)).rejects.toThrow(/Cancel/)
  expect(mockRemove).toHaveBeenCalledTimes(1)
})

test('pre-aborted verification has no native work or listeners', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(verifyFileNatively('file:///docs/model.gguf', 100, sha256, controller.signal)).rejects.toThrow(/Cancel/)
  expect(mockNative!.verifyFile).not.toHaveBeenCalled()
  expect(mockNative!.addListener).not.toHaveBeenCalled()
})

test('abort cancels the matching request, drains its promise and ignores late progress', async () => {
  const controller = new AbortController()
  const progress = jest.fn()
  let rejectVerification: (error: Error) => void = () => undefined
  mockNative!.verifyFile!.mockImplementation(() => new Promise((_resolve, reject) => {
    rejectVerification = reject
  }))
  mockNative!.cancelVerification!.mockImplementation(async () => {
    rejectVerification(Object.assign(new Error('native cancelled'), { code: 'verification-cancelled' }))
  })
  const operation = verifyFileNatively('file:///docs/model.gguf', 100, sha256, controller.signal, progress)
  const rejection = expect(operation).rejects.toThrow(/Cancel/)
  await Promise.resolve()
  const id = mockNative!.verifyFile!.mock.calls[0][0] as string
  controller.abort()
  mockListeners[0]({ id, bytes: 50, totalBytes: 100 })
  await rejection
  expect(mockNative!.cancelVerification).toHaveBeenCalledTimes(1)
  expect(mockNative!.cancelVerification).toHaveBeenCalledWith(id)
  expect(mockRemove).toHaveBeenCalledTimes(1)
  expect(progress).not.toHaveBeenCalled()
})

test('assigns unique IDs to simultaneous requests and keeps their progress isolated', async () => {
  const progressA = jest.fn(), progressB = jest.fn()
  const pending: (() => void)[] = []
  mockNative!.verifyFile!.mockImplementation(() => new Promise((resolve) => {
    pending.push(() => resolve(result))
  }))
  const first = verifyFileNatively('file:///docs/first.gguf', 100, sha256, undefined, progressA)
  const second = verifyFileNatively('file:///docs/second.gguf', 100, sha256, undefined, progressB)
  const [idA, idB] = mockNative!.verifyFile!.mock.calls.map(([id]) => id as string)
  expect(idA).not.toBe(idB)
  for (const listener of mockListeners) listener({ id: idA, bytes: 25, totalBytes: 100 })
  expect(progressA).toHaveBeenCalledWith(25)
  expect(progressB).not.toHaveBeenCalled()
  pending.forEach((complete) => complete())
  await Promise.all([first, second])
})
