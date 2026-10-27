import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'
import { RECORDINGS_DIR, ensureRecordingsDir } from '../audio/audioFiles'
import { concatWavFiles } from '../audio/wavConcat'
import { normalizeRecognitionVolume } from './microphoneMeter'
import { localeForLanguage, type Language } from '../i18n/language'
import { translate } from '../i18n/translate'
import { nativeCapture } from './nativeCapture'
import { useNativeSpeechRecorder } from './useNativeSpeechRecorder'
import { useNativeImportRecorder } from './useNativeImportRecorder'
import { MAX_AUDIO_DURATION_MS } from '../audio/captureManifest'
import { useRecorderMeterStore, type RecorderMeter } from './recorderMeter'
import { readWavLevels, wavPartDurationMs } from '../audio/wavLevels'
import {
  buildAudioSpans,
  type AudioTimeline,
  type RecognizedUtterance,
} from '../domain/audioTimeline'

// On-device recognizer package that exposes installed offline language models.
const ANDROID_ONDEVICE_PACKAGE = 'com.google.android.as'

// The recognizer tears down its session on any error, including ones that mean
// nothing more than "you went quiet". Those are resumed rather than treated as
// the end of the recording; the rest genuinely cannot be recovered from.
const RECOVERABLE_ERRORS = new Set(['no-speech', 'speech-timeout'])

const recognitionErrorMessage = (
  code: string,
  importing: boolean,
  language: Language = 'pl',
): string => {
  switch (code) {
    case 'not-allowed':
      return translate(
        'Brak zgody na mikrofon lub rozpoznawanie mowy. Włącz dostęp w ustawieniach telefonu.',
        'Microphone or speech recognition permission is missing. Enable access in your phone settings.',
      )
    case 'interrupted':
      return translate(
        'Nagrywanie zostało przerwane przez system. Zachowano dotychczasowy materiał.',
        'Recording was interrupted by the system. Your recording so far has been kept.',
      )
    case 'language-not-supported':
      return language === 'pl'
        ? translate(
            'Polski model rozpoznawania mowy jest niedostępny. Sprawdź ustawienia języka i dyktowania w telefonie.',
            'The Polish speech model is unavailable. Check the language and dictation settings on your phone.',
          )
        : translate(
            'Angielski model rozpoznawania mowy jest niedostępny. Sprawdź ustawienia języka i dyktowania w telefonie.',
            'The English speech model is unavailable. Check the language and dictation settings on your phone.',
          )
    case 'service-not-allowed':
      return translate(
        'Rozpoznawanie mowy jest niedostępne. Sprawdź jego uprawnienia i ustawienia w telefonie.',
        'Speech recognition is unavailable. Check its permissions and your phone settings.',
      )
    case 'audio-capture':
      return importing
        ? translate(
            'Nie udało się odczytać nagrania. Sprawdź, czy plik audio jest poprawny i daje się odtworzyć.',
            'The recording could not be read. Check that the audio file is valid and plays correctly.',
          )
        : translate(
            'Utracono dostęp do mikrofonu. Zachowano dotychczasowy materiał.',
            'Microphone access was lost. Your recording so far has been kept.',
          )
    default:
      return translate(
        'Rozpoznawanie mowy zostało przerwane. Zachowano dotychczasowy materiał. Możesz spróbować ponownie.',
        'Speech recognition was interrupted. Your recording so far has been kept. You can try again.',
      )
  }
}

// A recognizer that fails instantly and repeatedly would otherwise be restarted
// forever. Consecutive failures without any speech in between are capped.
const MAX_CONSECUTIVE_RESTARTS = 5

export type RecorderStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'interrupted'

// When provided to start(), the recognizer transcribes this audio file instead
// of the microphone. The note then keeps this file as its audio.
export interface AudioFileSource {
  uri: string
  durationMs?: number
}

export interface RecordingResult {
  language: Language
  transcript: string
  audioUri: string | null
  durationMs: number
  notice?: string
  sessionId?: string
  needsTranscription?: boolean
  // Verify the saved audio before AI; never treat live partials as complete.
  autoTranscribeAudio?: boolean
  // Measured loudness and transcript timing of a microphone recording.
  timeline?: AudioTimeline
}

export interface SpeechRecorder {
  status: RecorderStatus
  transcript: string
  // Only the finalized part, which changes once per recognized utterance rather
  // than on every interim update — the right cadence for saving a draft.
  finalTranscript: string
  // Snapshots of the live readings; they are not reactive. Components that draw
  // them subscribe through `meter` instead of re-rendering the whole screen.
  durationMs: number
  volumeLevel: number
  meter?: RecorderMeter
  error: string | null
  permissionDenied: boolean
  info: string | null
  start: (source?: AudioFileSource, language?: Language) => Promise<void>
  stop: () => void
  resume?: () => Promise<void>
  backgroundRecording?: boolean
  recordingLanguage?: Language
}

const useLegacySpeechRecorder = (
  onComplete: (result: RecordingResult) => void,
  language: Language = 'pl',
): SpeechRecorder => {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const meter = useRecorderMeterStore()
  const { setDuration: setDurationMs, setVolume: setVolumeLevel } = meter
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  const statusRef = useRef<RecorderStatus>('idle')
  const segmentsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const audioPartsRef = useRef<string[]>([])
  // Recognizer session that wrote each part, and the final results per session.
  const partSessionsRef = useRef<number[]>([])
  const utterancesRef = useRef<RecognizedUtterance[]>([])
  const sessionRef = useRef(0)
  const sessionStartedAtRef = useRef(0)
  const startTimeRef = useRef(0)
  const finalizedRef = useRef(true)
  const nativeActiveRef = useRef(false)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const noticeRef = useRef<string | undefined>(undefined)
  const elapsedRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)

  // Set when the user asks to stop; only then may the recording end on its own.
  const stopRequestedRef = useRef(false)
  const restartsRef = useRef(0)
  const sourceRef = useRef<AudioFileSource | undefined>(undefined)
  const languageRef = useRef<Language>(language)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const setBoth = (next: RecorderStatus) => {
    statusRef.current = next
    setStatus(next)
  }

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      finalizedRef.current = true
      stopTimer()
      if (nativeActiveRef.current) ExpoSpeechRecognitionModule.abort()
      nativeActiveRef.current = false
    }
  }, [])

  const freezeClock = () => {
    if (startTimeRef.current > 0) {
      elapsedRef.current += Date.now() - startTimeRef.current
      startTimeRef.current = 0
    }
    stopTimer()
    setDurationMs(elapsedRef.current)
  }

  const composeTranscript = (): string =>
    [...segmentsRef.current, interimRef.current]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ')

  const composeFinal = (): string =>
    segmentsRef.current
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ')

  useSpeechRecognitionEvent('start', () => {
    if (!nativeActiveRef.current || finalizedRef.current) return
    if (stopRequestedRef.current) {
      ExpoSpeechRecognitionModule.stop()
      return
    }
    setBoth('recording')
    sessionStartedAtRef.current = Date.now()
    if (startTimeRef.current === 0) startTimeRef.current = Date.now()
    stopTimer()
    timerRef.current = setInterval(() => {
      const elapsed = elapsedRef.current + Date.now() - startTimeRef.current
      setDurationMs(Math.min(MAX_AUDIO_DURATION_MS, elapsed))
      if (!sourceRef.current && elapsed >= MAX_AUDIO_DURATION_MS) {
        noticeRef.current = translate(
          'Osiągnięto limit 30 minut. Nagranie zatrzymano i zachowano.',
          'The 30 minute limit was reached. Recording has stopped and been kept.',
        )
        stopRef.current()
      }
    }, 250)
  })

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (
      sourceRef.current !== undefined ||
      statusRef.current !== 'recording' ||
      stopRequestedRef.current
    )
      return
    setVolumeLevel(normalizeRecognitionVolume(event.value))
  })

  useSpeechRecognitionEvent('result', (event) => {
    if (!nativeActiveRef.current || finalizedRef.current) return
    const text = event.results[0]?.transcript ?? ''
    if (event.isFinal) {
      if (text.trim().length > 0) {
        segmentsRef.current.push(text)
        utterancesRef.current.push({
          session: sessionRef.current,
          text,
          arrivedMs:
            sessionStartedAtRef.current > 0
              ? Date.now() - sessionStartedAtRef.current
              : null,
          words: (event.results[0]?.segments ?? []).map((segment) => ({
            text: segment.segment,
            startMs: segment.startTimeMillis,
          })),
        })
      }
      interimRef.current = ''
      // Speech came through, so any earlier failures were not a broken recognizer.
      restartsRef.current = 0
      setFinalTranscript(composeFinal())
    } else {
      interimRef.current = text
    }
    setTranscript(composeTranscript())
  })

  useSpeechRecognitionEvent('audioend', (event) => {
    if (!nativeActiveRef.current || finalizedRef.current) return
    freezeClock()
    // Transcribing a file: its audio is already the note's, nothing is recorded.
    if (sourceRef.current !== undefined) return
    // Each session writes its own file; a resumed recording therefore produces
    // several parts, joined into one on completion.
    if (event.uri) {
      audioPartsRef.current.push(event.uri)
      partSessionsRef.current.push(sessionRef.current)
    }
  })

  const startSession = (source?: AudioFileSource): void => {
    nativeActiveRef.current = true
    sessionRef.current += 1
    sessionStartedAtRef.current = 0
    ExpoSpeechRecognitionModule.start({
      lang: localeForLanguage(languageRef.current),
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      ...(Platform.OS === 'ios'
        ? {
            // Avoid the persistent playback attenuation reported with the
            // recognizer's default "measurement" mode on iOS.
            iosCategory: {
              category: 'playAndRecord' as const,
              categoryOptions: [
                'defaultToSpeaker' as const,
                'allowBluetooth' as const,
              ],
              mode: 'default' as const,
            },
          }
        : {}),
      ...(source
        ? { audioSource: { uri: source.uri } }
        : {
            recordingOptions: {
              persist: true,
              outputDirectory: RECORDINGS_DIR,
              outputSampleRate: 16000,
              outputEncoding: 'pcmFormatInt16',
            },
            volumeChangeEventOptions: {
              enabled: true,
              intervalMillis: 100,
            },
          }),
    })
  }

  // Waveform and timing are extras: a failure here never costs the recording.
  const measureTimeline = async (
    uri: string,
  ): Promise<AudioTimeline | undefined> => {
    try {
      const { levelMs, levels } = await readWavLevels(uri)
      if (levels.length === 0) return undefined
      const parts = audioPartsRef.current.map((part, index) => ({
        session: partSessionsRef.current[index] ?? -1,
        durationMs: wavPartDurationMs(part),
      }))
      const tail = interimRef.current.trim()
      const utterances = tail
        ? [
            ...utterancesRef.current,
            { session: sessionRef.current, text: tail, arrivedMs: null, words: [] },
          ]
        : utterancesRef.current
      const built = buildAudioSpans(utterances, parts)
      const source = composeTranscript()
      const spans = built.transcript === source ? built.spans : []
      return { version: 1, levelMs, levels, source, timing: built.timing, spans }
    } catch {
      return undefined
    }
  }

  // Ignore zero-frame sessions and join the parts that actually contain audio.
  // A missing or invalid recording must not be attached to an otherwise valid note.
  const resolveAudio = async (): Promise<{
    audioUri: string | null
    durationMs: number
    timeline?: AudioTimeline
  }> => {
    if (sourceRef.current)
      return {
        audioUri: sourceRef.current.uri,
        durationMs: sourceRef.current.durationMs ?? elapsedRef.current,
      }
    const parts = audioPartsRef.current
    if (parts.length === 0)
      return { audioUri: null, durationMs: elapsedRef.current }
    try {
      const target = `${RECORDINGS_DIR}${Date.now().toString(36)}-full.wav`
      const { uri, durationMs: recordedDuration } = await concatWavFiles(
        parts,
        target,
      )
      return {
        audioUri: uri,
        durationMs: recordedDuration,
        timeline: await measureTimeline(uri),
      }
    } catch {
      noticeRef.current = translate(
        'Zachowano tekst, ale nie udało się przygotować pliku nagrania.',
        'Your text has been kept, but the audio file could not be prepared.',
      )
      return { audioUri: null, durationMs: elapsedRef.current }
    }
  }

  const finalize = (): void => {
    if (finalizedRef.current) return
    finalizedRef.current = true
    nativeActiveRef.current = false
    freezeClock()
    setVolumeLevel(0)
    setBoth('stopping')
    const text = composeTranscript()
    void resolveAudio().then((audio) => {
      if (!mountedRef.current) return
      setBoth('idle')
      onCompleteRef.current({
        transcript: text,
        language: languageRef.current,
        ...audio,
        ...(noticeRef.current ? { notice: noticeRef.current } : {}),
      })
    })
  }

  useSpeechRecognitionEvent('error', (event) => {
    if (!nativeActiveRef.current || finalizedRef.current) return
    // Teardown after the user asked to stop reports an error that means nothing.
    if (statusRef.current === 'stopping' || statusRef.current === 'idle') return
    if (RECOVERABLE_ERRORS.has(event.error)) {
      // Transient: the session ends, and the 'end' handler resumes it.
      return
    }
    // Permanent failures end the recording — but never discard what was said.
    stopRequestedRef.current = true
    freezeClock()
    setVolumeLevel(0)
    const message = recognitionErrorMessage(
      event.error,
      sourceRef.current !== undefined,
      languageRef.current,
    )
    noticeRef.current = message
    setPermissionDenied(event.error === 'not-allowed')
    setError(message)
    setBoth('stopping')
  })

  useSpeechRecognitionEvent('end', () => {
    if (!nativeActiveRef.current || finalizedRef.current) return
    freezeClock()
    nativeActiveRef.current = false

    const shouldResume =
      !stopRequestedRef.current &&
      AppState.currentState !== 'background' &&
      sourceRef.current === undefined &&
      restartsRef.current < MAX_CONSECUTIVE_RESTARTS

    if (shouldResume) {
      // The recognizer closed the session on its own (a pause in speech, a final
      // result). The user did not ask to stop, so recording continues and the
      // transcript keeps growing across sessions.
      restartsRef.current += 1
      try {
        setBoth('starting')
        startSession(undefined)
        return
      } catch {
        noticeRef.current = recognitionErrorMessage(
          'audio-capture',
          false,
          languageRef.current,
        )
        setError(noticeRef.current)
      }
    }

    if (
      !stopRequestedRef.current &&
      restartsRef.current >= MAX_CONSECUTIVE_RESTARTS
    ) {
      noticeRef.current = translate(
        'Rozpoznawanie mowy przerwane. Zapisano to, co udało się rozpoznać.',
        'Speech recognition stopped. The recognized text has been saved.',
      )
      setError(noticeRef.current)
    }
    finalize()
  })

  // The on-device locale model is a separate ~40 MB download managed by the OS.
  // Ensure it is installed before starting, otherwise start() emits
  // "language supported, but not yet downloaded". iOS (SFSpeechRecognizer)
  // provisions its model itself, so this only applies to Android.
  const ensureOfflineModel = async (
    sessionLanguage: Language,
  ): Promise<boolean> => {
    if (Platform.OS !== 'android') return true
    const locale = localeForLanguage(sessionLanguage)

    let installed: string[] = []
    try {
      const locales = await ExpoSpeechRecognitionModule.getSupportedLocales({
        androidRecognitionServicePackage: ANDROID_ONDEVICE_PACKAGE,
      })
      installed = locales.installedLocales
    } catch {
      // Service package not queryable on this device — fall through and try to download.
    }
    if (installed.includes(locale)) return true

    setInfo(
      translate(
        'Pobieranie modelu języka offline (≈40 MB)…',
        'Downloading the offline speech model (≈40 MB)…',
      ),
    )
    try {
      await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
        locale,
      })
      return true
    } catch {
      setError(
        sessionLanguage === 'pl'
          ? translate(
              'Nie udało się przygotować polskiego modelu mowy. Sprawdź połączenie z internetem i spróbuj ponownie.',
              'The Polish speech model could not be prepared. Check your internet connection and try again.',
            )
          : translate(
              'Nie udało się przygotować angielskiego modelu mowy. Sprawdź połączenie z internetem i spróbuj ponownie.',
              'The English speech model could not be prepared. Check your internet connection and try again.',
            ),
      )
      return false
    } finally {
      setInfo(null)
    }
  }

  const start = async (
    source?: AudioFileSource,
    sessionLanguage: Language = language,
  ): Promise<void> => {
    if (statusRef.current !== 'idle') return
    languageRef.current = sessionLanguage
    const generation = ++generationRef.current
    const cancelled = () =>
      !mountedRef.current ||
      generation !== generationRef.current ||
      stopRequestedRef.current
    setError(null)
    setInfo(null)
    setPermissionDenied(false)
    setVolumeLevel(0)
    finalizedRef.current = false
    stopRequestedRef.current = false
    restartsRef.current = 0
    sourceRef.current = source
    noticeRef.current = undefined
    segmentsRef.current = []
    interimRef.current = ''
    audioPartsRef.current = []
    partSessionsRef.current = []
    utterancesRef.current = []
    sessionRef.current = 0
    sessionStartedAtRef.current = 0
    startTimeRef.current = 0
    elapsedRef.current = 0
    setTranscript('')
    setFinalTranscript('')
    setDurationMs(0)
    setBoth('starting')

    try {
      const supportsOffline =
        Platform.OS === 'ios'
          ? ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(
              localeForLanguage(sessionLanguage),
            )
          : ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
      if (!supportsOffline) {
        setError(
          recognitionErrorMessage(
            'language-not-supported',
            Boolean(source),
            sessionLanguage,
          ),
        )
        finalizedRef.current = true
        setBoth('idle')
        return
      }

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (cancelled()) return
      if (!permission.granted) {
        setPermissionDenied(true)
        setError(
          recognitionErrorMessage(
            'not-allowed',
            Boolean(source),
            sessionLanguage,
          ),
        )
        finalizedRef.current = true
        setBoth('idle')
        return
      }

      if (!(await ensureOfflineModel(sessionLanguage))) {
        if (cancelled()) return
        finalizedRef.current = true
        setBoth('idle')
        return
      }

      if (cancelled()) return
      await ensureRecordingsDir()
      if (cancelled()) return
      if (AppState.currentState === 'background') {
        stopRequestedRef.current = true
        finalizedRef.current = true
        setBoth('idle')
        setInfo(
          translate(
            'Wróć do aplikacji, aby rozpocząć nagrywanie.',
            'Return to the app to start recording.',
          ),
        )
        return
      }
      startSession(source)
    } catch {
      if (cancelled()) return
      nativeActiveRef.current = false
      finalizedRef.current = true
      setError(
        translate(
          'Nie udało się rozpocząć rozpoznawania mowy. Sprawdź uprawnienia i spróbuj ponownie.',
          'Speech recognition could not start. Check your permissions and try again.',
        ),
      )
      setBoth('idle')
    }
  }

  const stop = (): void => {
    if (statusRef.current !== 'recording' && statusRef.current !== 'starting')
      return
    stopRequestedRef.current = true
    freezeClock()
    setVolumeLevel(0)
    setBoth('stopping')
    if (nativeActiveRef.current) ExpoSpeechRecognitionModule.stop()
    else finalize()
  }

  // This release records in the foreground. Do not leave a running timer over
  // a system-muted microphone, or blindly restart an interrupted iOS session.
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'background' || sourceRef.current !== undefined) return
      // A permission/model-download dialog can temporarily cover the app.
      // There is nothing to save before capture; start() checks app state again
      // after those asynchronous steps, before opening the microphone.
      if (!nativeActiveRef.current) return
      if (statusRef.current !== 'recording' && statusRef.current !== 'starting')
        return
      noticeRef.current = translate(
        'Nagrywanie zakończono po schowaniu aplikacji lub zablokowaniu telefonu. Zachowano dotychczasowy materiał.',
        'Recording ended when the app was hidden or the phone was locked. Your recording so far has been kept.',
      )
      setInfo(noticeRef.current)
      stopRef.current()
    })
    return () => subscription.remove()
  }, [])

  return {
    status,
    transcript,
    finalTranscript,
    get durationMs() {
      return meter.durationMs
    },
    get volumeLevel() {
      return meter.volume
    },
    meter,
    error,
    permissionDenied,
    info,
    start,
    stop,
  }
}

export const useSpeechRecorder = (
  onComplete: (result: RecordingResult) => void,
  language: Language = 'pl',
  mode: 'record' | 'import' = 'record',
): SpeechRecorder => {
  // Native availability and the screen's mode are stable for a mounted hook.
  const useRecorder =
    Platform.OS === 'ios' && nativeCapture
      ? mode === 'record'
        ? useNativeSpeechRecorder
        : useNativeImportRecorder
      : useLegacySpeechRecorder
  return useRecorder(onComplete, language)
}
