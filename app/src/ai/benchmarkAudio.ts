import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { AppState } from 'react-native'
import {
  nativeCapture,
  NativeSpeechWindowError,
  type NativeSpeechWindowResult,
  type SpeechBackend,
} from '../stt/nativeCapture'
import { validateImportDuration } from '../audio/captureManifest'
import { translate } from '../i18n/translate'
import { GenerationCancelledError } from './llm'
import type { BenchmarkAudioRun, BenchmarkAudioWindow } from './benchmarkTypes'

let requestSequence = 0
const ensureActive = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new GenerationCancelledError()
}

const waitForPermissionForeground = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (failure?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      subscription?.remove()
      signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolve()
    }
    const abort = (): void => finish(new GenerationCancelledError())
    timer = setTimeout(
      () =>
        finish(
          new Error(
            'Speech permission dialog did not return to the foreground',
          ),
        ),
      5000,
    )
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish()
      else if (state === 'background') abort()
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted || AppState.currentState === 'background') abort()
    else if (AppState.currentState === 'active') finish()
  })

// Permission dialogs can make iOS inactive. Run this before installing the
// benchmark's foreground-only lifecycle listeners and starting its timers.
export const prepareBenchmarkAudio = async (
  locale: 'en-US',
  signal?: AbortSignal,
  speechBackend: SpeechBackend = 'recognizer',
): Promise<void> => {
  ensureActive(signal)
  const beganActive = AppState.currentState === 'active'
  if (!nativeCapture)
    throw new Error(
      translate(
        'Natywna transkrypcja pliku audio jest niedostępna.',
        'Native audio file transcription is unavailable.',
      ),
    )
  if (
    speechBackend === 'analyzer-if-installed' &&
    nativeCapture.transcribeWindowWithBackend &&
    nativeCapture.getSpeechCapabilities
  ) {
    const capabilities = await nativeCapture.getSpeechCapabilities().catch(() => null)
    ensureActive(signal)
    const availability = capabilities?.locales[locale]
    // Only a ready local Analyzer can bypass SFSpeechRecognizer permission.
    // Every unsupported/uninstalled/query-failure fallback keeps legacy gates.
    if (capabilities?.analyzerAvailable && availability?.analyzerSupported && availability.analyzerInstalled)
      return
  }
  let permission =
    await ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync()
  ensureActive(signal)
  if (!permission.granted && permission.canAskAgain) {
    permission =
      await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync()
    ensureActive(signal)
    if (beganActive && AppState.currentState === 'inactive')
      await waitForPermissionForeground(signal)
  }
  ensureActive(signal)
  if (!permission.granted)
    throw new Error(
      translate(
        'Brak uprawnienia do rozpoznawania mowy. Włącz je w ustawieniach telefonu.',
        'Speech recognition permission is missing. Enable it in your phone settings.',
      ),
    )
  // isRecognitionAvailable() checks the system locale on iOS. The native
  // window recognizer checks availability for this exact requested locale.
  if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(locale))
    throw new Error(
      translate(
        'Lokalne rozpoznawanie mowy en-US jest niedostępne.',
        'On-device speech recognition for en-US is unavailable.',
      ),
    )
}

// Deliberately bypass note-import checkpoints. Every measured run decodes and
// recognizes the real fixture afresh, preserving partial STT evidence on error.
export const transcribeBenchmarkAudio = async (
  audio: BenchmarkAudioRun,
  signal: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<string> => {
  ensureActive(signal)
  if (!nativeCapture)
    throw new Error('Native audio file transcription is unavailable')
  if (audio.speechBackend === 'analyzer-if-installed' && !nativeCapture.transcribeWindowWithBackend)
    throw new Error('Experimental speech backend is unavailable in this native build')
  if (!audio.uri.startsWith('file://'))
    throw new Error('Only local benchmark audio is accepted')
  const inspection = await nativeCapture.inspectAudio(audio.uri)
  ensureActive(signal)
  const duration = validateImportDuration(inspection.durationMs)
  if (
    !Number.isFinite(inspection.sampleRate) ||
    inspection.sampleRate <= 0 ||
    !Number.isInteger(inspection.channels) ||
    inspection.channels < 1 ||
    inspection.channels > 8
  )
    throw new Error('Invalid benchmark audio format')
  audio.durationMs = duration
  audio.sampleRate = inspection.sampleRate
  audio.channels = inspection.channels
  if (audio.expectedDurationMs !== undefined) {
    const expected = audio.expectedDurationMs
    if (
      !Number.isFinite(expected) || expected <= 0 ||
      Math.abs(duration - expected) > Math.max(50, expected * 0.0001)
    ) throw new Error('Benchmark audio duration does not match the selected fixture')
  }
  const transcripts: string[] = []
  // Compare shorter requests against the saved 60-second physical baseline.
  // Only the bundled benchmark changes; ordinary imports and legacy audio keep
  // their existing plan. Actual saved windows expose this experimental setting.
  const windowDuration = audio.bundled ? 30000 : 60000
  for (let start = 0; start < duration; start += windowDuration) {
    ensureActive(signal)
    const requestId = `benchmark-speech-${Date.now().toString(36)}-${++requestSequence}`
    const cancel = (): void => {
      void nativeCapture!.cancelTranscription(requestId).catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      onProgress?.(
        `STT · en-US · ${Math.floor(start / windowDuration) + 1}/${Math.ceil(duration / windowDuration)}`,
      )
      ensureActive(signal)
      const window: BenchmarkAudioWindow = {
        requestId,
        startMs: start,
        durationMs: Math.min(windowDuration, duration - start),
      }
      audio.windows ??= []
      audio.windows.push(window)
      let result: NativeSpeechWindowResult
      try {
        result =
          audio.speechBackend === 'analyzer-if-installed'
            ? await nativeCapture.transcribeWindowWithBackend!(
                audio.uri, start, window.durationMs, audio.locale,
                requestId, audio.speechBackend,
              )
            : typeof nativeCapture.transcribeWindowWithDiagnostics === 'function'
            ? await nativeCapture.transcribeWindowWithDiagnostics(
                audio.uri,
                start,
                window.durationMs,
                audio.locale,
                requestId,
              )
            : {
                transcript: await nativeCapture.transcribeWindow(
                  audio.uri,
                  start,
                  window.durationMs,
                  audio.locale,
                  requestId,
                ),
              }
      } catch (failure) {
        if (failure instanceof NativeSpeechWindowError) {
          if (failure.diagnostics) window.diagnostics = failure.diagnostics
          transcripts.push(failure.transcript)
          audio.transcript = transcripts.join(' ')
        }
        throw failure
      }
      if (result.diagnostics) window.diagnostics = result.diagnostics
      const transcript = result.transcript
      transcripts.push(transcript)
      audio.transcript = transcripts.join(' ')
      ensureActive(signal)
      if (!transcript.trim())
        throw new Error(
          translate(
            'Rozpoznawanie mowy zwróciło pustą transkrypcję.',
            'Speech recognition returned an empty transcript.',
          ),
        )
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }
  audio.status = 'complete'
  return audio.transcript.trim()
}
