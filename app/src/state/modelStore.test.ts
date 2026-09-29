import { useModelStore } from './modelStore'
import { downloadModel, ModelDownloadCancelledError } from '../ai/modelDownload'

jest.mock('../ai/modelDownload', () => ({
  ModelDownloadCancelledError: class ModelDownloadCancelledError extends Error {},
  deleteModel: jest.fn(),
  downloadModel: jest.fn(),
  getModelSizeBytes: jest.fn(),
  isModelDownloaded: jest.fn(),
}))

jest.mock('../ai/llm', () => ({ unloadModel: jest.fn() }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: jest.fn() }))

const mockDownloadModel = jest.mocked(downloadModel)

beforeEach(() => {
  jest.clearAllMocks()
  useModelStore.setState(useModelStore.getInitialState(), true)
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
