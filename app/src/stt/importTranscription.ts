import * as settings from '../data/settingsRepository'
import { localeForLanguage, type Language } from '../i18n/language'
import { nativeCapture } from './nativeCapture'
import { validateImportDuration } from '../audio/captureManifest'

export interface ImportCheckpoint {
  version: 1
  uri: string
  durationMs: number
  language: Language
  windows: { startMs: number; durationMs: number; transcript: string }[]
}
const keyFor = (uri: string, language: Language) =>
  `speech.import.${language}.${uri}`
export const readImportCheckpoint = async (
  uri: string,
  durationMs: number,
  language: Language,
): Promise<ImportCheckpoint> => {
  const empty: ImportCheckpoint = {
    version: 1,
    uri,
    durationMs,
    language,
    windows: [],
  }
  const raw = await settings.getSetting(keyFor(uri, language))
  if (!raw) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Malformed transcription checkpoint; audio has been kept')
  }
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('Malformed transcription checkpoint; audio has been kept')
  const checkpoint = parsed as Partial<ImportCheckpoint>
  if (
    checkpoint.version !== 1 ||
    checkpoint.uri !== uri ||
    checkpoint.durationMs !== durationMs ||
    checkpoint.language !== language ||
    !Array.isArray(checkpoint.windows)
  )
    throw new Error('Transcription source changed')
  let covered = 0
  for (const window of checkpoint.windows) {
    const expected = Math.min(60000, durationMs - covered)
    if (
      expected <= 0 ||
      !window ||
      window.startMs !== covered ||
      window.durationMs !== expected ||
      typeof window.transcript !== 'string'
    )
      throw new Error('Missing or malformed transcription window')
    covered += window.durationMs
  }
  if (covered > durationMs)
    throw new Error('Transcription checkpoint exceeds audio length')
  return checkpoint as ImportCheckpoint
}
export const clearImportCheckpoint = async (
  uri: string,
  language: Language,
): Promise<void> => {
  await settings.setSetting(keyFor(uri, language), '')
}

// iOS reports a window without speech as an error ("No speech detected").
export const isNoSpeechError = (error: unknown): boolean =>
  /no speech detected|nie wykryto mowy/iu.test(error instanceof Error ? error.message : String(error))

export const transcribeImportedAudio = async (
  uri: string,
  durationMs: number,
  language: Language,
  options: {
    signal: AbortSignal
    beforeWindow?: () => Promise<void>
    onProgress?: (text: string, completed: number, total: number) => void
    onRequest?: (id: string | null) => void
  },
): Promise<string> => {
  if (!nativeCapture)
    throw new Error('Native window transcription is unavailable')
  validateImportDuration(durationMs)
  const checkpoint = await readImportCheckpoint(uri, durationMs, language)
  let covered = checkpoint.windows.reduce(
    (sum, window) => sum + window.durationMs,
    0,
  )
  const text = () =>
    checkpoint.windows
      .map((window) => window.transcript.trim())
      .filter(Boolean)
      .join(' ')
  const total = Math.ceil(durationMs / 60000)
  options.onProgress?.(text(), checkpoint.windows.length, total)
  while (covered < durationMs) {
    if (options.signal.aborted) throw new Error('Transcription cancelled')
    await options.beforeWindow?.()
    if (options.signal.aborted) throw new Error('Transcription cancelled')
    const length = Math.min(60000, durationMs - covered)
    const requestId = `speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    options.onRequest?.(requestId)
    const cancel = () => {
      void nativeCapture!.cancelTranscription(requestId)
    }
    options.signal.addEventListener('abort', cancel, { once: true })
    let transcript: string
    try {
      transcript = await nativeCapture.transcribeWindow(
        uri,
        covered,
        length,
        localeForLanguage(language),
        requestId,
      )
    } catch (error) {
      // A silent window (often the tail of a file) is empty speech, not a failed import.
      if (!isNoSpeechError(error) || options.signal.aborted) throw error
      transcript = ''
    } finally {
      options.signal.removeEventListener('abort', cancel)
      options.onRequest?.(null)
    }
    if (options.signal.aborted) throw new Error('Transcription cancelled')
    checkpoint.windows.push({
      startMs: covered,
      durationMs: length,
      transcript,
    })
    await settings.setSetting(keyFor(uri, language), JSON.stringify(checkpoint))
    covered += length
    options.onProgress?.(text(), checkpoint.windows.length, total)
  }
  return text()
}
