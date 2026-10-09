import * as FileSystem from 'expo-file-system/legacy'
import { File, FileMode } from 'expo-file-system'
import { loadLlamaModelInfo } from 'llama.rn'
import type { ModelConfig } from './modelConfig'
import { GenerationCancelledError } from './llm'
import { validateBenchmarkMetadata } from './benchmarkProfiles'
import { Sha256 } from './sha256'
import { translate } from '../i18n/translate'
import { verifyFileNatively } from './nativeFileVerification'

export interface ModelVerification {
  sha256: string
  sizeBytes: number
  architecture: string
  nextnPredictLayers: number
  verifiedAt: number
  backend?: 'native' | 'javascript'
  // File integrity verification, excluding the subsequent GGUF metadata read.
  durationMs?: number
}
export const benchmarkModelPath = (model: ModelConfig): string =>
  `${FileSystem.documentDirectory}${model.filename}`
const cancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new GenerationCancelledError()
}

export const isBenchmarkModelPresent = async (
  model: ModelConfig,
): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(benchmarkModelPath(model))
  return info.exists && info.size === model.sizeBytes
}

export const verifyBenchmarkModel = async (
  model: ModelConfig,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
  path = benchmarkModelPath(model),
): Promise<ModelVerification> => {
  cancelled(signal)
  if (!model.sizeBytes || !model.sha256)
    throw new Error('Pinned model integrity metadata is missing.')
  const native = await verifyFileNatively(
    path, model.sizeBytes, model.sha256, signal, onProgress,
  )
  cancelled(signal)
  let digest: string
  let bytes: number
  let durationMs: number
  if (native !== null) {
    if (native.sizeBytes !== model.sizeBytes)
      throw new Error('Model size does not match the pinned file.')
    if (native.sha256 !== model.sha256)
      throw new Error('Model SHA-256 checksum is invalid.')
    digest = native.sha256
    bytes = native.sizeBytes
    durationMs = native.durationMs
  } else {
    const startedAt = Date.now()
    const file = new File(path)
    if (file.size !== model.sizeBytes)
      throw new Error(
        translate(
          'Rozmiar modelu nie zgadza się z przypiętym plikiem.',
          'Model size does not match the pinned file.',
        ),
      )
    const sha = new Sha256()
    const handle = file.open(FileMode.ReadOnly)
    bytes = 0
    let lastProgressAt = startedAt - 250
    try {
      while (bytes < model.sizeBytes) {
        cancelled(signal)
        const block = handle.readBytes(
          Math.min(1024 * 1024, model.sizeBytes - bytes),
        )
        if (!block.length) throw new Error('Unexpected end of model file')
        sha.update(block)
        bytes += block.length
        const now = Date.now()
        if (bytes === model.sizeBytes || now - lastProgressAt >= 250) {
          onProgress?.((bytes / model.sizeBytes) * 100)
          lastProgressAt = now
        }
        // Yield to rendering and cancellation between bounded read/hash blocks.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      handle.close()
    }
    cancelled(signal)
    digest = sha.digestHex()
    durationMs = Date.now() - startedAt
  }
  cancelled(signal)
  if (digest !== model.sha256)
    throw new Error(
      translate(
        'Suma SHA-256 modelu jest nieprawidłowa.',
        'Model SHA-256 checksum is invalid.',
      ),
    )
  const metadata = (await loadLlamaModelInfo(path)) as Record<string, unknown>
  cancelled(signal)
  validateBenchmarkMetadata(model, metadata)
  return {
    sha256: digest,
    sizeBytes: bytes,
    architecture: model.architecture ?? '',
    nextnPredictLayers: model.nextnPredictLayers ?? 0,
    verifiedAt: Date.now(),
    backend: native === null ? 'javascript' : 'native',
    durationMs,
  }
}

let downloading = false
// This function is invoked only by the explicit download button. Running the
// benchmark never initiates network access or replaces the application's model.
export const downloadBenchmarkModel = async (
  model: ModelConfig,
  onProgress: (stage: 'download' | 'verify', percent: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  if (downloading)
    throw new Error('A benchmark model download is already in progress')
  downloading = true
  const path = benchmarkModelPath(model),
    temporary = `${path}.part`
  let download:
    | ReturnType<typeof FileSystem.createDownloadResumable>
    | undefined
  let stop: Promise<void> | undefined
  const onAbort = (): void => {
    if (!download || stop) return
    stop = download.cancelAsync()
    void stop.catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    cancelled(signal)
    if (await isBenchmarkModelPresent(model)) {
      await verifyBenchmarkModel(model, signal, (percent) =>
        onProgress('verify', percent),
      )
      return
    }
    const current = await FileSystem.getInfoAsync(path)
    if (current.exists)
      throw new Error(
        'Existing benchmark model has a different size; remove it before downloading again',
      )
    await FileSystem.deleteAsync(temporary, { idempotent: true })
    cancelled(signal)
    download = FileSystem.createDownloadResumable(
      model.url,
      temporary,
      {},
      ({ totalBytesWritten }) => {
        onProgress(
          'download',
          (totalBytesWritten / (model.sizeBytes ?? 1)) * 100,
        )
      },
    )
    const result = await download.downloadAsync()
    cancelled(signal)
    if (!result || result.status < 200 || result.status >= 300)
      throw new Error('Benchmark model download failed')
    await verifyBenchmarkModel(
      model,
      signal,
      (percent) => onProgress('verify', percent),
      temporary,
    )
    cancelled(signal)
    await FileSystem.moveAsync({ from: temporary, to: path })
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (stop) await Promise.allSettled([stop])
    try {
      await FileSystem.deleteAsync(temporary, { idempotent: true })
    } finally {
      downloading = false
    }
  }
}
export const deleteBenchmarkModel = async (
  model: ModelConfig,
): Promise<void> => {
  if (downloading) throw new Error('A benchmark model download is in progress')
  await FileSystem.deleteAsync(benchmarkModelPath(model), { idempotent: true })
  await FileSystem.deleteAsync(`${benchmarkModelPath(model)}.part`, {
    idempotent: true,
  })
}
