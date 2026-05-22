import * as FileSystem from 'expo-file-system/legacy'

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`

const extensionFromUri = (uri: string): string => {
  const match = uri.match(/\.[a-z0-9]+(?:\?|$)/i)
  return match ? match[0].replace('?', '') : '.m4a'
}

export const saveRecordingFile = async (temporaryUri: string): Promise<string> => {
  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true })
  const destination = `${RECORDINGS_DIR}${Date.now().toString(36)}${extensionFromUri(temporaryUri)}`
  await FileSystem.copyAsync({ from: temporaryUri, to: destination })
  return destination
}
