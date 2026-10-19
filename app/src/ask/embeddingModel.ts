import * as FileSystem from 'expo-file-system/legacy'
import { translate } from '../i18n/translate'

// Optional second model for "Zapytaj notatki": EmbeddingGemma-300M turns note
// sentences and questions into vectors, so a question finds a note that says
// the same thing in other words or in the other language. Downloaded only when
// the user asks for it; the notes never leave the phone.
export const EMBEDDING_MODEL = {
  url: 'https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/0f741b5a6585bd53aeb15cd1372c56f2a0f65e12/embeddinggemma-300M-Q8_0.gguf',
  filename: 'embeddinggemma-300M-Q8_0.gguf',
  displayName: 'EmbeddingGemma-300M (Q8_0)',
  sizeBytes: 333590944,
  approxSizeMb: 334,
  // Matryoshka training keeps the first 256 of 768 values meaningful on their own.
  dims: 256,
} as const

export const embeddingModelPath = (): string => `${FileSystem.documentDirectory}${EMBEDDING_MODEL.filename}`

export const isEmbeddingModelDownloaded = async (): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(embeddingModelPath())
  return info.exists && info.size === EMBEDDING_MODEL.sizeBytes
}

export const deleteEmbeddingModel = async (): Promise<void> => {
  await FileSystem.deleteAsync(embeddingModelPath(), { idempotent: true })
  await FileSystem.deleteAsync(`${embeddingModelPath()}.part`, { idempotent: true })
}

export const downloadEmbeddingModel = async (onProgress: (percent: number) => void, signal?: AbortSignal): Promise<void> => {
  if (await isEmbeddingModelDownloaded()) return
  const temp = `${embeddingModelPath()}.part`
  await FileSystem.deleteAsync(temp, { idempotent: true })
  const download = FileSystem.createDownloadResumable(EMBEDDING_MODEL.url, temp, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    if (totalBytesExpectedToWrite > 0) onProgress((totalBytesWritten / totalBytesExpectedToWrite) * 100)
  })
  const cancel = (): void => void download.cancelAsync().catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await download.downloadAsync()
    if (signal?.aborted) throw new Error(translate('Pobieranie anulowano', 'Download cancelled'))
    if (!result || result.status < 200 || result.status >= 300)
      throw new Error(translate('Pobieranie modelu wyszukiwania nie powiodło się', 'The search model download failed'))
    const info = await FileSystem.getInfoAsync(temp)
    // A partial file is never used: only a file of the exact size is promoted.
    if (!info.exists || info.size !== EMBEDDING_MODEL.sizeBytes)
      throw new Error(translate('Pobrany plik ma zły rozmiar', 'The downloaded file has the wrong size'))
    await FileSystem.moveAsync({ from: temp, to: embeddingModelPath() })
  } catch (error) {
    await FileSystem.deleteAsync(temp, { idempotent: true })
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
