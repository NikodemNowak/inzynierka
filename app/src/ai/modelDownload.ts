import { translate, getAppLanguage } from '../i18n/translate'
import * as FileSystem from 'expo-file-system/legacy'
import { MODEL_CONFIG, PREVIOUS_MODEL_FILENAMES } from './modelConfig'
import {
  nativeModelDownload,
  downloadStateMatches,
  downloadStateProgress,
  type NativeDownloadState,
} from './nativeModelDownload'
import { Sha256 } from './sha256'
import { File, FileMode } from 'expo-file-system'

export class ModelDownloadCancelledError extends Error {
  constructor() {
    super(translate('Pobieranie modelu anulowano', 'Model download cancelled'))
    this.name = 'ModelDownloadCancelledError'
  }
}

export class ModelDownloadInProgressError extends Error {
  constructor() {
    super(
      translate(
        'Pobieranie modelu już trwa',
        'A model download is already in progress',
      ),
    )
    this.name = 'ModelDownloadInProgressError'
  }
}

let activeDownload: Promise<string> | undefined

export const getModelPath = (): string =>
  `${FileSystem.documentDirectory}${MODEL_CONFIG.filename}`

export const isModelDownloaded = async (): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(getModelPath())
  return (
    info.exists &&
    info.size > 0 &&
    (!MODEL_CONFIG.sizeBytes || info.size === MODEL_CONFIG.sizeBytes)
  )
}

export const hasPreviousModel = async (): Promise<boolean> => {
  for (const filename of PREVIOUS_MODEL_FILENAMES) {
    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${filename}`)
    if (info.exists) return true
  }
  return false
}

export const getModelSizeBytes = async (): Promise<number> => {
  const info = await FileSystem.getInfoAsync(getModelPath())
  return info.exists ? info.size : 0
}

// Reclaiming the storage is the user's counterpart to agreeing to the download:
// the model is the only thing this app ever fetched, so it must be removable.
export const deleteModel = async (): Promise<void> => {
  if (nativeModelDownload) {
    await nativeModelDownload.remove(MODEL_CONFIG.filename)
    return
  }
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
  if (nativeModelDownload) return performNativeDownload(onProgress, signal)
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
      throw new Error(
        translate(
          'Pobieranie modelu nie powiodło się',
          'Model download failed',
        ),
      )
    }
    transferCompleted = true
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        translate(
          `Pobieranie modelu nie powiodło się (HTTP ${result.status})`,
          `Model download failed (HTTP ${result.status})`,
        ),
      )
    }

    const temporaryInfo = await FileSystem.getInfoAsync(tempPath)
    if (
      !temporaryInfo.exists ||
      !temporaryInfo.size ||
      temporaryInfo.size <= 0
    ) {
      throw new Error(
        translate('Pobrany model jest pusty', 'The downloaded model is empty'),
      )
    }
    if (MODEL_CONFIG.sizeBytes && temporaryInfo.size !== MODEL_CONFIG.sizeBytes)
      throw new Error(
        translate(
          'Rozmiar pobranego modelu nie odpowiada plikowi źródłowemu.',
          'The downloaded model size does not match the source file.',
        ),
      )
    if (MODEL_CONFIG.sha256) {
      const file = new File(tempPath)
      const handle = file.open(FileMode.ReadOnly)
      const hash = new Sha256()
      try {
        let remaining = temporaryInfo.size
        while (remaining > 0) {
          throwIfCancelled()
          const block = handle.readBytes(Math.min(1024 * 1024, remaining))
          if (block.length === 0)
            throw new Error('Downloaded model ended during verification')
          hash.update(block)
          remaining -= block.length
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      } finally {
        handle.close()
      }
      if (hash.digestHex() !== MODEL_CONFIG.sha256)
        throw new Error(
          'Downloaded model SHA256 does not match the pinned file',
        )
      throwIfCancelled()
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
        translate(
          `${originalMessage}. Nie udało się usunąć pliku tymczasowego: ${cleanupMessage}`,
          `${originalMessage}. Unable to remove the temporary file: ${cleanupMessage}`,
        ),
      )
    }
    if (cancelled) throw new ModelDownloadCancelledError()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelDownload)
  }
}

export const getNativeDownloadState =
  async (): Promise<NativeDownloadState | null> => {
    if (!nativeModelDownload) return null
    const state = await nativeModelDownload.getState()
    if (state && !downloadStateMatches(state, MODEL_CONFIG))
      throw new Error(
        'Download source metadata changed; cancel the previous transfer before starting a new one',
      )
    return state
  }
export const observeNativeDownload = (
  listener: (state: NativeDownloadState) => void,
): (() => void) => {
  if (!nativeModelDownload) return () => undefined
  const subscription = nativeModelDownload.addListener(
    'downloadState',
    (state) => {
      if (downloadStateMatches(state, MODEL_CONFIG)) listener(state)
    },
  )
  return () => subscription.remove()
}
export const cancelNativeDownload = async (): Promise<void> => {
  if (!nativeModelDownload) return
  const state = await nativeModelDownload.getState()
  if (
    state &&
    ['running', 'verifying', 'paused', 'failed'].includes(state.state)
  )
    await nativeModelDownload.cancel(state.id)
}

const performNativeDownload = async (
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<string> => {
  if (signal?.aborted) throw new ModelDownloadCancelledError()
  if (await isModelDownloaded()) return getModelPath()
  if (!MODEL_CONFIG.sizeBytes || !MODEL_CONFIG.sha256)
    throw new Error('Pinned model integrity metadata is missing')
  const id = `download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const native = nativeModelDownload!
  return new Promise<string>((resolve, reject) => {
    let finished = false
    const cleanup = () => {
      subscription.remove()
      signal?.removeEventListener('abort', cancel)
    }
    const fail = (error: unknown) => {
      if (!finished) {
        finished = true
        cleanup()
        reject(error)
      }
    }
    const update = (state: NativeDownloadState) => {
      if (state.id !== id || finished) return
      if (!downloadStateMatches(state, MODEL_CONFIG)) {
        fail(new Error('Download source changed'))
        return
      }
      onProgress(downloadStateProgress(state))
      if (state.state === 'complete') {
        finished = true
        cleanup()
        resolve(state.path ?? getModelPath())
      } else if (state.state === 'cancelled')
        fail(new ModelDownloadCancelledError())
      else if (state.state === 'failed' || state.state === 'paused')
        fail(new Error(state.error ?? 'Model download interrupted'))
    }
    const subscription = native.addListener('downloadState', update)
    const cancel = () => {
      void native.cancel(id).catch(fail)
    }
    signal?.addEventListener('abort', cancel, { once: true })
    // Handle abort between the caller's initial check and native authorization.
    if (signal?.aborted) {
      fail(new ModelDownloadCancelledError())
      return
    }
    void native
      .start(
        id,
        MODEL_CONFIG.url,
        MODEL_CONFIG.filename,
        MODEL_CONFIG.sizeBytes!,
        MODEL_CONFIG.sha256!,
        getAppLanguage(),
      )
      .then((state) => {
        if (signal?.aborted && state.state !== 'complete') cancel()
        update(state)
      })
      .catch(fail)
  })
}
