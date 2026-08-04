import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'
import { RECORDINGS_DIR, ensureRecordingsDir } from '../audio/audioFiles'
import { concatWavFiles } from '../audio/wavConcat'

const LOCALE = 'pl-PL'
// On-device recognizer package that exposes installed offline language models.
const ANDROID_ONDEVICE_PACKAGE = 'com.google.android.as'

// The recognizer tears down its session on any error, including ones that mean
// nothing more than "you went quiet". Those are resumed rather than treated as
// the end of the recording; the rest genuinely cannot be recovered from.
const PERMANENT_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'language-not-supported',
  'audio-capture',
  'aborted',
])

// A recognizer that fails instantly and repeatedly would otherwise be restarted
// forever. Consecutive failures without any speech in between are capped.
const MAX_CONSECUTIVE_RESTARTS = 5

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping'

// When provided to start(), the recognizer transcribes this audio file instead
// of the microphone. The note then keeps this file as its audio.
export interface AudioFileSource {
  uri: string
}

export interface RecordingResult {
  transcript: string
  audioUri: string | null
  durationMs: number
}

export interface SpeechRecorder {
  status: RecorderStatus
  transcript: string
  // Only the finalized part, which changes once per recognized utterance rather
  // than on every interim update — the right cadence for saving a draft.
  finalTranscript: string
  durationMs: number
  error: string | null
  info: string | null
  start: (source?: AudioFileSource) => Promise<void>
  stop: () => void
}

export const useSpeechRecorder = (
  onComplete: (result: RecordingResult) => void,
): SpeechRecorder => {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const statusRef = useRef<RecorderStatus>('idle')
  const segmentsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const audioPartsRef = useRef<string[]>([])
  const startTimeRef = useRef(0)
  const finalizedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)

  // Set when the user asks to stop; only then may the recording end on its own.
  const stopRequestedRef = useRef(false)
  const restartsRef = useRef(0)
  const sourceRef = useRef<AudioFileSource | undefined>(undefined)

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

  useEffect(() => stopTimer, [])

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
    setBoth('recording')
    if (startTimeRef.current === 0) startTimeRef.current = Date.now()
    stopTimer()
    timerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startTimeRef.current)
    }, 250)
  })

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? ''
    if (event.isFinal) {
      if (text.trim().length > 0) segmentsRef.current.push(text)
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
    // Transcribing a file: its audio is already the note's, nothing is recorded.
    if (sourceRef.current !== undefined) return
    // Each session writes its own file; a resumed recording therefore produces
    // several parts, joined into one on completion.
    if (event.uri) audioPartsRef.current.push(event.uri)
  })

  const startSession = (source?: AudioFileSource): void => {
    ExpoSpeechRecognitionModule.start({
      lang: LOCALE,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      ...(source
        ? { audioSource: { uri: source.uri } }
        : {
            recordingOptions: {
              persist: true,
              outputDirectory: RECORDINGS_DIR,
              outputSampleRate: 16000,
              outputEncoding: 'pcmFormatInt16',
            },
          }),
    })
  }

  // Joins the recorded parts into the single file the note refers to. A failure
  // here must not cost the recording, so the first part is kept as a fallback.
  const resolveAudio = async (): Promise<string | null> => {
    const parts = audioPartsRef.current
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0] ?? null
    try {
      const target = `${RECORDINGS_DIR}${Date.now().toString(36)}-full.wav`
      const { uri } = await concatWavFiles(parts, target)
      return uri
    } catch {
      return parts[0] ?? null
    }
  }

  const finalize = (): void => {
    if (finalizedRef.current) return
    finalizedRef.current = true
    stopTimer()
    setBoth('idle')
    const elapsed = startTimeRef.current > 0 ? Date.now() - startTimeRef.current : 0
    void resolveAudio().then((audioUri) => {
      onCompleteRef.current({ transcript: composeTranscript(), audioUri, durationMs: elapsed })
    })
  }

  useSpeechRecognitionEvent('error', (event) => {
    // Teardown after the user asked to stop reports an error that means nothing.
    if (statusRef.current === 'stopping' || statusRef.current === 'idle') return
    if (!PERMANENT_ERRORS.has(event.error)) {
      // Transient: the session ends, and the 'end' handler resumes it.
      return
    }
    // Permanent failures end the recording — but never discard what was said.
    stopRequestedRef.current = true
    setError(event.message || event.error)
  })

  useSpeechRecognitionEvent('end', () => {
    if (finalizedRef.current) return

    const shouldResume =
      !stopRequestedRef.current &&
      sourceRef.current === undefined &&
      restartsRef.current < MAX_CONSECUTIVE_RESTARTS

    if (shouldResume) {
      // The recognizer closed the session on its own (a pause in speech, a final
      // result). The user did not ask to stop, so recording continues and the
      // transcript keeps growing across sessions.
      restartsRef.current += 1
      try {
        startSession(undefined)
        return
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    if (!stopRequestedRef.current && restartsRef.current >= MAX_CONSECUTIVE_RESTARTS) {
      setError('Rozpoznawanie mowy przerwane. Zapisano to, co udało się rozpoznać.')
    }
    finalize()
  })

  // The on-device locale model is a separate ~40 MB download managed by the OS.
  // Ensure it is installed before starting, otherwise start() emits
  // "language supported, but not yet downloaded". iOS (SFSpeechRecognizer)
  // provisions its model itself, so this only applies to Android.
  const ensureOfflineModel = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true

    let installed: string[] = []
    try {
      const locales = await ExpoSpeechRecognitionModule.getSupportedLocales({
        androidRecognitionServicePackage: ANDROID_ONDEVICE_PACKAGE,
      })
      installed = locales.installedLocales
    } catch {
      // Service package not queryable on this device — fall through and try to download.
    }
    if (installed.includes(LOCALE)) return true

    setInfo('Pobieranie modelu języka offline (≈40 MB)…')
    try {
      const result = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
        locale: LOCALE,
      })
      if (result.status === 'download_canceled') {
        setError('Pobieranie modelu języka zostało anulowane')
        return false
      }
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setInfo(null)
    }
  }

  const start = async (source?: AudioFileSource): Promise<void> => {
    setError(null)
    finalizedRef.current = false
    stopRequestedRef.current = false
    restartsRef.current = 0
    sourceRef.current = source

    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      setError('Rozpoznawanie on-device jest niedostępne na tym urządzeniu')
      return
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!permission.granted) {
      setError('Brak zgody na mikrofon lub rozpoznawanie mowy')
      return
    }

    setBoth('starting')
    if (!(await ensureOfflineModel())) {
      setBoth('idle')
      return
    }

    segmentsRef.current = []
    interimRef.current = ''
    // An imported file is the note's audio from the start; a live recording
    // collects the parts its sessions produce.
    audioPartsRef.current = source ? [source.uri] : []
    startTimeRef.current = 0
    setTranscript('')
    setFinalTranscript('')
    setDurationMs(0)

    try {
      await ensureRecordingsDir()
      startSession(source)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBoth('idle')
    }
  }

  const stop = (): void => {
    if (statusRef.current !== 'recording' && statusRef.current !== 'starting') return
    stopRequestedRef.current = true
    setBoth('stopping')
    ExpoSpeechRecognitionModule.stop()
  }

  return { status, transcript, finalTranscript, durationMs, error, info, start, stop }
}
