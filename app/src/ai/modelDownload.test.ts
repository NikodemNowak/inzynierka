import * as FileSystem from 'expo-file-system/legacy'
import { downloadModel, isModelDownloaded } from './modelDownload'
import { MODEL_CONFIG } from './modelConfig'

jest.mock('expo-file-system/legacy', () => ({
  createDownloadResumable: jest.fn(),
  deleteAsync: jest.fn(),
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  moveAsync: jest.fn(),
}))

jest.mock('./modelConfig', () => ({
  MODEL_CONFIG: {
    filename: 'model.gguf',
    url: 'https://example.test/model.gguf',
  },
}))

const mockGetInfo = jest.mocked(FileSystem.getInfoAsync)
const mockDelete = jest.mocked(FileSystem.deleteAsync)
const mockCreateDownload = jest.mocked(FileSystem.createDownloadResumable)
const mockMove = jest.mocked(FileSystem.moveAsync)

beforeEach(() => {
  jest.clearAllMocks()
  delete MODEL_CONFIG.sizeBytes
  delete MODEL_CONFIG.sha256
  mockGetInfo.mockResolvedValue({
    exists: false,
    isDirectory: false,
    uri: 'file:///missing',
  })
  mockDelete.mockResolvedValue(undefined)
  mockMove.mockResolvedValue(undefined)
})

test('an existing truncated file is not treated as a downloaded production model', async () => {
  MODEL_CONFIG.sizeBytes = 1000
  mockGetInfo.mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: 999,
    modificationTime: 1,
    uri: 'file:///documents/model.gguf',
  })
  await expect(isModelDownloaded()).resolves.toBe(false)
})

test('a successful HTTP response with incorrect expected bytes is never promoted', async () => {
  MODEL_CONFIG.sizeBytes = 1000
  mockGetInfo
    .mockResolvedValueOnce({
      exists: false,
      isDirectory: false,
      uri: 'file:///missing',
    })
    .mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      size: 999,
      modificationTime: 1,
      uri: 'file:///documents/model.gguf.part',
    })
  mockCreateDownload.mockReturnValue({
    cancelAsync: jest.fn(),
    downloadAsync: jest.fn(async () => ({
      status: 200,
      uri: 'file:///documents/model.gguf.part',
    })),
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)
  await expect(downloadModel(jest.fn())).rejects.toThrow('Rozmiar')
  expect(mockMove).not.toHaveBeenCalled()
})

test('cancelling a transfer removes its temporary file and never promotes it', async () => {
  let resolveTransfer:
    | ((result: { uri: string } | undefined) => void)
    | undefined
  const cancelAsync = jest.fn(async () => resolveTransfer?.(undefined))
  const downloadAsync = jest.fn(
    () =>
      new Promise<{ uri: string } | undefined>((resolve) => {
        resolveTransfer = resolve
      }),
  )

  mockCreateDownload.mockReturnValue({
    cancelAsync,
    downloadAsync,
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)

  const controller = new AbortController()
  const download = downloadModel(jest.fn(), controller.signal)

  while (mockCreateDownload.mock.calls.length === 0) await Promise.resolve()
  controller.abort()

  const outcome = await Promise.race([
    download.then(
      () => undefined,
      (error: unknown) => error,
    ),
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), 25),
    ),
  ])
  expect(outcome).toBeInstanceOf(Error)
  expect(outcome).toHaveProperty('message', 'Pobieranie modelu anulowano')
  expect(cancelAsync).toHaveBeenCalledTimes(1)
  expect(mockDelete).toHaveBeenNthCalledWith(
    2,
    'file:///documents/model.gguf.part',
    { idempotent: true },
  )
  expect(mockMove).not.toHaveBeenCalled()
})

test('cancelling while preparing the temporary file never starts a native transfer', async () => {
  let finishTempCleanup: (() => void) | undefined
  mockDelete.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishTempCleanup = resolve
      }),
  )
  const controller = new AbortController()
  const download = downloadModel(jest.fn(), controller.signal)

  while (mockDelete.mock.calls.length === 0) await Promise.resolve()
  controller.abort()
  finishTempCleanup?.()

  await expect(download).rejects.toThrow('Pobieranie modelu anulowano')
  expect(mockCreateDownload).not.toHaveBeenCalled()
  expect(mockDelete).toHaveBeenNthCalledWith(
    2,
    'file:///documents/model.gguf.part',
    { idempotent: true },
  )
})

test('cancellation API errors do not skip temporary file cleanup', async () => {
  let finishTransfer: ((result: undefined) => void) | undefined
  const cancelAsync = jest.fn(async () => {
    finishTransfer?.(undefined)
    throw new Error('Native cancel request failed')
  })
  mockCreateDownload.mockReturnValue({
    cancelAsync,
    downloadAsync: jest.fn(
      () =>
        new Promise<undefined>((resolve) => {
          finishTransfer = resolve
        }),
    ),
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)

  const controller = new AbortController()
  const download = downloadModel(jest.fn(), controller.signal)
  while (mockCreateDownload.mock.calls.length === 0) await Promise.resolve()
  controller.abort()

  await expect(download).rejects.toThrow('Pobieranie modelu anulowano')
  expect(cancelAsync).toHaveBeenCalledTimes(1)
  expect(mockDelete).toHaveBeenNthCalledWith(
    2,
    'file:///documents/model.gguf.part',
    { idempotent: true },
  )
})

test('a completed response finishes promotion if cancellation arrives during file commit', async () => {
  let finishExistingFileCleanup: (() => void) | undefined
  const cancelAsync = jest.fn(async () => undefined)
  mockGetInfo
    .mockResolvedValueOnce({
      exists: false,
      isDirectory: false,
      uri: 'file:///missing',
    })
    .mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: 1024,
      uri: 'file:///documents/model.gguf.part',
    })
  mockDelete.mockImplementation(async (uri) => {
    if (uri === 'file:///documents/model.gguf') {
      await new Promise<void>((resolve) => {
        finishExistingFileCleanup = resolve
      })
    }
  })
  mockCreateDownload.mockReturnValue({
    cancelAsync,
    downloadAsync: jest.fn(async () => ({
      headers: {},
      mimeType: 'application/octet-stream',
      status: 200,
      uri: 'file:///documents/model.gguf.part',
    })),
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)

  const controller = new AbortController()
  const download = downloadModel(jest.fn(), controller.signal)
  while (
    !mockDelete.mock.calls.some(
      ([uri]) => uri === 'file:///documents/model.gguf',
    )
  ) {
    await Promise.resolve()
  }
  controller.abort()
  finishExistingFileCleanup?.()

  await expect(download).resolves.toBe('file:///documents/model.gguf')
  expect(cancelAsync).not.toHaveBeenCalled()
  expect(mockMove).toHaveBeenCalledWith({
    from: 'file:///documents/model.gguf.part',
    to: 'file:///documents/model.gguf',
  })
})

test('a second caller is rejected while another model transfer owns the temporary file', async () => {
  let finishFirstTransfer: ((result: undefined) => void) | undefined
  let createCount = 0
  const cancelFirst = jest.fn(async () => finishFirstTransfer?.(undefined))
  mockCreateDownload.mockImplementation(() => {
    createCount += 1
    if (createCount === 1) {
      return {
        cancelAsync: cancelFirst,
        downloadAsync: jest.fn(
          () =>
            new Promise<undefined>((resolve) => {
              finishFirstTransfer = resolve
            }),
        ),
      } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>
    }
    return {
      cancelAsync: jest.fn(async () => undefined),
      downloadAsync: jest.fn(async () => ({
        headers: {},
        mimeType: 'application/octet-stream',
        status: 200,
        uri: 'file:///documents/model.gguf.part',
      })),
    } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>
  })

  const controller = new AbortController()
  const first = downloadModel(jest.fn(), controller.signal)
  while (mockCreateDownload.mock.calls.length === 0) await Promise.resolve()
  const secondOutcome = await downloadModel(jest.fn()).then(
    () => undefined,
    (error: unknown) => error,
  )

  controller.abort()
  await first.catch(() => undefined)

  expect(secondOutcome).toBeInstanceOf(Error)
  expect(secondOutcome).toHaveProperty('message', 'Pobieranie modelu już trwa')
  expect(mockCreateDownload).toHaveBeenCalledTimes(1)
  expect(cancelFirst).toHaveBeenCalledTimes(1)
})

test('an unsuccessful HTTP response is not promoted as a model', async () => {
  mockCreateDownload.mockReturnValue({
    cancelAsync: jest.fn(async () => undefined),
    downloadAsync: jest.fn(async () => ({
      headers: {},
      mimeType: 'application/octet-stream',
      status: 404,
      uri: 'file:///documents/model.gguf.part',
    })),
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)

  await expect(downloadModel(jest.fn())).rejects.toThrow(
    'Pobieranie modelu nie powiodło się',
  )
  expect(mockMove).not.toHaveBeenCalled()
  expect(mockDelete).toHaveBeenNthCalledWith(
    2,
    'file:///documents/model.gguf.part',
    { idempotent: true },
  )
})

test('an empty temporary file is not promoted as a model', async () => {
  mockGetInfo
    .mockResolvedValueOnce({
      exists: false,
      isDirectory: false,
      uri: 'file:///missing',
    })
    .mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      modificationTime: 1,
      size: 0,
      uri: 'file:///documents/model.gguf.part',
    })
  mockCreateDownload.mockReturnValue({
    cancelAsync: jest.fn(async () => undefined),
    downloadAsync: jest.fn(async () => ({
      headers: {},
      mimeType: 'application/octet-stream',
      status: 200,
      uri: 'file:///documents/model.gguf.part',
    })),
  } as unknown as ReturnType<typeof FileSystem.createDownloadResumable>)

  await expect(downloadModel(jest.fn())).rejects.toThrow(
    'Pobrany model jest pusty',
  )
  expect(mockMove).not.toHaveBeenCalled()
  expect(mockDelete).toHaveBeenNthCalledWith(
    2,
    'file:///documents/model.gguf.part',
    { idempotent: true },
  )
})
