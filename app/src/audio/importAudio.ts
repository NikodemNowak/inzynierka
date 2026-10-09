import { nativeCapture } from '../stt/nativeCapture'
import { validateImportDuration } from './captureManifest'
import { translate } from '../i18n/translate'

export const inspectImportAudio = async (
  uri: string,
  signal?: AbortSignal,
): Promise<number> => {
  if (signal?.aborted) throw new Error('Import cancelled')
  try {
    if (nativeCapture) {
      const metadata = await nativeCapture.inspectAudio(uri)
      if (signal?.aborted) throw new Error('Import cancelled')
      return validateImportDuration(metadata.durationMs)
    }
    const { createAudioPlayer } = await import('expo-audio')
    if (signal?.aborted) throw new Error('Import cancelled')
    const player = createAudioPlayer({ uri }, { updateInterval: 100 })
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        let subscription: { remove: () => void } | undefined
        let timeout: ReturnType<typeof setTimeout> | undefined
        const done = (failure?: Error) => {
          subscription?.remove()
          if (timeout) clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          if (failure) reject(failure)
          else resolve(player.duration * 1000)
        }
        const abort = () => done(new Error('Import cancelled'))
        if (signal?.aborted) {
          done(new Error('Import cancelled'))
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
        if (player.isLoaded) {
          done()
          return
        }
        subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.isLoaded) done()
        })
        timeout = setTimeout(
          () => done(new Error('Cannot decode audio')),
          10000,
        )
      })
      return validateImportDuration(duration)
    } finally {
      player.remove()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('audio-duration-limit'))
      throw new Error(
        translate(
          'Plik przekracza limit 30 minut. Wybierz krótsze nagranie.',
          'The file exceeds the 30 minute limit. Choose a shorter recording.',
        ),
      )
    throw error
  }
}
