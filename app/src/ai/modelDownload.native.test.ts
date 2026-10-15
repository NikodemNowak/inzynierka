import { downloadModel, ModelDownloadCancelledError } from './modelDownload'
import {
  nativeModelDownload,
  type NativeDownloadState,
} from './nativeModelDownload'

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  deleteAsync: jest.fn(),
}))
jest.mock('./modelConfig', () => ({
  MODEL_CONFIG: {
    url: 'https://example.test/model',
    filename: 'model.gguf',
    sizeBytes: 1000,
    sha256: 'a'.repeat(64),
  },
}))
jest.mock('./nativeModelDownload', () => ({
  ...jest.requireActual('./nativeModelDownload'),
  nativeModelDownload: {
    start: jest.fn(),
    addListener: jest.fn(),
    cancel: jest.fn(),
  },
}))
const native = jest.mocked(nativeModelDownload!)
let update: (state: NativeDownloadState) => void
let id: string
const state = (status: NativeDownloadState['state']): NativeDownloadState => ({
  version: 1,
  id,
  url: 'https://example.test/model',
  filename: 'model.gguf',
  expectedBytes: 1000,
  expectedSha256: 'a'.repeat(64),
  language: 'en',
  state: status,
  writtenBytes: 1000,
  path: 'file:///documents/model.gguf',
})
beforeEach(() => {
  jest.clearAllMocks()
  native.addListener.mockImplementation((_, listener) => {
    update = listener
    return { remove: jest.fn() }
  })
  native.start.mockImplementation(async (requested) => {
    id = requested
    return state('running')
  })
  native.cancel.mockImplementation(async () => update(state('cancelled')))
})
test('waits for native integrity verification and atomic publication before ready', async () => {
  let completed = false
  const progress = jest.fn()
  const operation = downloadModel(progress).then((path) => {
    completed = true
    return path
  })
  while (native.start.mock.calls.length === 0) await Promise.resolve()
  update(state('verifying'))
  await Promise.resolve()
  expect(completed).toBe(false)
  expect(progress).toHaveBeenLastCalledWith(99.9)
  update(state('complete'))
  await expect(operation).resolves.toBe('file:///documents/model.gguf')
})
test('explicit cancel discards the authorized native transfer and rejects its waiter', async () => {
  const controller = new AbortController()
  const operation = downloadModel(jest.fn(), controller.signal)
  while (native.start.mock.calls.length === 0) await Promise.resolve()
  controller.abort()
  await expect(operation).rejects.toBeInstanceOf(ModelDownloadCancelledError)
  expect(native.cancel).toHaveBeenCalledWith(id)
})
test('does not accept completion from a different pinned file revision', async () => {
  const operation = downloadModel(jest.fn())
  while (native.start.mock.calls.length === 0) await Promise.resolve()
  update({ ...state('complete'), expectedSha256: 'b'.repeat(64) })
  await expect(operation).rejects.toThrow('source changed')
})
