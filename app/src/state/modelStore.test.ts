import { useModelStore } from './modelStore'
import {
  downloadModel,
  ModelDownloadCancelledError,
  getNativeDownloadState,
  cancelNativeDownload,
} from '../ai/modelDownload'

jest.mock('../ai/modelDownload', () => ({
  ModelDownloadCancelledError: class ModelDownloadCancelledError extends Error {},
  deleteModel: jest.fn(),
  downloadModel: jest.fn(),
  getModelSizeBytes: jest.fn(),
  isModelDownloaded: jest.fn(),
  getNativeDownloadState: jest.fn(async () => null),
  observeNativeDownload: jest.fn(),
  cancelNativeDownload: jest.fn(),
}))

jest.mock('../ai/llm', () => ({ unloadModel: jest.fn() }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: jest.fn() }))

const mockDownloadModel = jest.mocked(downloadModel)

beforeEach(() => {
  jest.clearAllMocks()
  useModelStore.setState(useModelStore.getInitialState(), true)
  jest.mocked(getNativeDownloadState).mockResolvedValue(null)
})

test('refresh reattaches a previously authorized native download without starting another request', async () => {
  jest.mocked(getNativeDownloadState).mockResolvedValue({
    version: 1,
    id: 'download-restored',
    url: 'https://example.test/model',
    filename: 'model.gguf',
    expectedBytes: 1000,
    state: 'running',
    writtenBytes: 450,
    language: 'en',
  })
  await useModelStore.getState().refresh()
  expect(useModelStore.getState()).toMatchObject({
    status: 'downloading',
    progress: 45,
  })
  expect(mockDownloadModel).not.toHaveBeenCalled()
})
test('a reattached transfer can be deliberately cancelled after JavaScript relaunch', async () => {
  jest.mocked(getNativeDownloadState).mockResolvedValue({
    version: 1,
    id: 'download-restored',
    url: 'https://example.test/model',
    filename: 'model.gguf',
    expectedBytes: 1000,
    state: 'running',
    writtenBytes: 450,
    language: 'en',
  })
  await useModelStore.getState().refresh()
  jest.mocked(cancelNativeDownload).mockImplementationOnce(async () => {
    jest.mocked(getNativeDownloadState).mockResolvedValue(null)
  })
  await useModelStore.getState().cancelDownload()
  expect(cancelNativeDownload).toHaveBeenCalledTimes(1)
  expect(useModelStore.getState().status).toBe('absent')
})

test('cancelling a model download aborts it and returns to the absent state', async () => {
  let reportProgress: ((progress: number) => void) | undefined

  mockDownloadModel.mockImplementation((onProgress, signal) => {
    reportProgress = onProgress
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(new ModelDownloadCancelledError()),
        { once: true },
      )
    })
  })

  const download = useModelStore.getState().download()
  expect(useModelStore.getState().status).toBe('downloading')
  expect(mockDownloadModel).toHaveBeenCalledTimes(1)

  await useModelStore.getState().cancelDownload()
  await download

  expect(mockDownloadModel.mock.calls[0]?.[1]?.aborted).toBe(true)
  expect(useModelStore.getState()).toMatchObject({
    status: 'absent',
    progress: 0,
    error: null,
    isCancelling: false,
  })

  reportProgress?.(82)
  expect(useModelStore.getState().progress).toBe(0)
})

test('repeated download requests share one active transfer', async () => {
  let resolveDownload: ((path: string) => void) | undefined
  mockDownloadModel.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveDownload = resolve
      }),
  )

  const first = useModelStore.getState().download()
  const second = useModelStore.getState().download()
  expect(mockDownloadModel).toHaveBeenCalledTimes(1)

  resolveDownload?.('file:///model.gguf')
  await Promise.all([first, second])
  expect(useModelStore.getState().status).toBe('ready')
})

test('a native download failure is readable and allows a successful retry', async () => {
  mockDownloadModel.mockRejectedValueOnce(
    new Error(
      'Unable to resolve host "huggingface.co": No address associated with hostname',
    ),
  )
  await useModelStore.getState().download()
  expect(useModelStore.getState()).toMatchObject({
    status: 'absent',
    progress: 0,
    isCancelling: false,
    error:
      'Nie można połączyć się z serwerem modelu. Sprawdź połączenie z internetem i spróbuj ponownie.',
  })
  mockDownloadModel.mockResolvedValueOnce('file:///model.gguf')
  await useModelStore.getState().download()
  expect(useModelStore.getState()).toMatchObject({
    status: 'ready',
    error: null,
  })
})
