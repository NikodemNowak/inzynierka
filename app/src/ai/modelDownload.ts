import * as FileSystem from 'expo-file-system/legacy'

const MODEL_URL =
  'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf'
const MODEL_FILENAME = 'Qwen3-1.7B-Q4_K_M.gguf'

export const getModelPath = (): string =>
  `${FileSystem.documentDirectory}${MODEL_FILENAME}`

export const isModelDownloaded = async (): Promise<boolean> => {
  const info = await FileSystem.getInfoAsync(getModelPath())
  return info.exists && info.size > 0
}

export const downloadModel = async (
  onProgress: (percent: number) => void,
): Promise<string> => {
  const path = getModelPath()
  if (await isModelDownloaded()) return path

  // Download to a temporary file and only promote it to the final path once the
  // download fully completes. This prevents a partial/interrupted download from
  // being mistaken for a complete model (which then fails to load).
  const tempPath = `${path}.part`
  await FileSystem.deleteAsync(tempPath, { idempotent: true })

  const download = FileSystem.createDownloadResumable(
    MODEL_URL,
    tempPath,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const percent =
        totalBytesExpectedToWrite > 0
          ? (totalBytesWritten / totalBytesExpectedToWrite) * 100
          : 0
      onProgress(percent)
    },
  )
  const result = await download.downloadAsync()
  if (!result) throw new Error('Pobieranie modelu nie powiodło się')

  await FileSystem.deleteAsync(path, { idempotent: true })
  await FileSystem.moveAsync({ from: tempPath, to: path })
  return path
}
