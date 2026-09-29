import * as FileSystem from 'expo-file-system/legacy'
import { MODEL_CONFIG } from './modelConfig'

export class ModelDownloadCancelledError extends Error {
  constructor() {
    super('Pobieranie modelu anulowano')
    this.name = 'ModelDownloadCancelledError'
  }
}

export class ModelDownloadInProgressError extends Error {
  constructor() {
    super('Pobieranie modelu już trwa')
    this.name = 'ModelDownloadInProgressError'
  }
}

let activeDownload: Promise<string> | undefined

export const getModelPath = (): string =>
  `${FileSystem.documentDirectory}${MODEL_CONFIG.filename}`

export const isModelDownloaded = async (): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(getModelPath())
  return info.exists && info.size > 0
}

export const getModelSizeBytes = async (): Promise<number> => {
  const info = await FileSystem.getInfoAsync(getModelPath())
  return info.exists ? info.size : 0
}

// Reclaiming the storage is the user's counterpart to agreeing to the download:
// the model is the only thing this app ever fetched, so it must be removable.
export const deleteModel = async (): Promise<void> => {
  await FileSystem.deleteAsync(getModelPath(), { idempotent: true })
  await FileSystem.deleteAsync(`${getModelPath()}.part`, { idempotent: true })
}

export const downloadModel = (
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> => {
  if (activeDownload) return Promise.reject(new ModelDownloadInProgressError())

  const operation = performDownloadModel(onProgress, signal)
  activeDownload = operation
  void operation.then(
    () => {
      if (activeDownload === operation) activeDownload = undefined
    },
    () => {
      if (activeDownload === operation) activeDownload = undefined
    },
  )
  return operation
}

const performDownloadModel = async (
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const path = getModelPath()
  const tempPath = `${path}.part`
  let download:
    | ReturnType<typeof FileSystem.createDownloadResumable>
    | undefined
  let cancelPromise: Promise<void> | undefined
  let transferCompleted = false
  let promoted = false

  const cancelDownload = () => {
    if (download && !cancelPromise) {
      cancelPromise = download.cancelAsync()
      void cancelPromise.catch(() => undefined)
    }
  }
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new ModelDownloadCancelledError()
  }

  signal?.addEventListener('abort', cancelDownload, { once: true })

  try {
    throwIfCancelled()
    if (await isModelDownloaded()) return path

    // Download to a temporary file and only promote it after a completed
    // transfer, so a partial file is never mistaken for a usable model.
    throwIfCancelled()
    await FileSystem.deleteAsync(tempPath, { idempotent: true })
    throwIfCancelled()

    download = FileSystem.createDownloadResumable(
      MODEL_CONFIG.url,
      tempPath,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (signal?.aborted) return
        const percent =
          totalBytesExpectedToWrite > 0
            ? (totalBytesWritten / totalBytesExpectedToWrite) * 100
            : 0
        onProgress(percent)
      },
    )

    const result = await download.downloadAsync()
    signal?.removeEventListener('abort', cancelDownload)
    if (!result) {
      if (signal?.aborted) throw new ModelDownloadCancelledError()
      throw new Error('Pobieranie modelu nie powiodło się')
    }
    transferCompleted = true
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `Pobieranie modelu nie powiodło się (HTTP ${result.status})`,
      )
    }

    const temporaryInfo = await FileSystem.getInfoAsync(tempPath)
    if (
      !temporaryInfo.exists ||
      !temporaryInfo.size ||
      temporaryInfo.size <= 0
    ) {
      throw new Error('Pobrany model jest pusty')
    }

    // A complete HTTP response with a non-empty temporary file can be promoted
    // even if cancellation is requested during this final filesystem step.
    await FileSystem.deleteAsync(path, { idempotent: true })
    await FileSystem.moveAsync({ from: tempPath, to: path })
    promoted = true
    return path
  } catch (error) {
    const cancelled = signal?.aborted && !transferCompleted
    if (cancelPromise) await Promise.allSettled([cancelPromise])

    let cleanupError: unknown
    if (!promoted) {
      try {
        await FileSystem.deleteAsync(tempPath, { idempotent: true })
      } catch (cleanupFailure) {
        cleanupError = cleanupFailure
      }
    }
    if (cleanupError) {
      const originalMessage =
        error instanceof Error ? error.message : String(error)
      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError)
      throw new Error(
        `${originalMessage}. Nie udało się usunąć pliku tymczasowego: ${cleanupMessage}`,
      )
    }
    if (cancelled) throw new ModelDownloadCancelledError()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelDownload)
  }
}
