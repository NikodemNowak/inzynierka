import * as FileSystem from 'expo-file-system/legacy'
import { nativeCapture } from '../stt/nativeCapture'

export const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`

export const ensureRecordingsDir = async (): Promise<string> => {
  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true })
  return RECORDINGS_DIR
}

const extensionFromUri = (uri: string): string => {
  const match = uri.match(/\.[a-z0-9]+(?:\?|$)/i)
  return match ? match[0].replace('?', '') : '.m4a'
}

export const saveRecordingFile = async (
  temporaryUri: string,
): Promise<string> => {
  await ensureRecordingsDir()
  const destination = `${RECORDINGS_DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${extensionFromUri(temporaryUri)}`
  try {
    await FileSystem.copyAsync({ from: temporaryUri, to: destination })
  } catch (failure) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(
      () => undefined,
    )
    throw failure
  }
  return destination
}

// The native recorder and the document picker report paths with an inconsistent
// file:// prefix, so compare the plain filesystem paths.
const plainPath = (uri: string): string => uri.replace(/^file:\/\//, '')

export const deletePickerCacheFile = async (
  uri: string | null,
): Promise<void> => {
  if (!uri || !FileSystem.cacheDirectory) return
  if (
    !plainPath(uri).startsWith(plainPath(FileSystem.cacheDirectory)) ||
    plainPath(uri).includes('/../')
  )
    return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
}

// Deleting a note has to take its recording with it, otherwise the audio stays
// on disk forever. Only files inside our own recordings directory are ours to
// remove — anything else is a path the user owns.
export const deleteRecordingFile = async (
  uri: string | null,
): Promise<void> => {
  if (!uri) return
  if (!plainPath(uri).startsWith(plainPath(RECORDINGS_DIR))) return
  if (plainPath(uri).includes('/../')) return
  const relative = plainPath(uri).slice(plainPath(RECORDINGS_DIR).length)
  const capture = relative.match(
    /^captures\/(capture-[A-Za-z0-9-]+)\/(?:full|[0-9]{6})\.wav$/,
  )
  if (capture && nativeCapture) {
    await nativeCapture.deleteCaptureAudio(capture[1]!)
    return
  }
  await FileSystem.deleteAsync(uri, { idempotent: true })
}
