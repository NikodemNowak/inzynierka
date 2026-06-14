import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'
import { ensureRecordingsDir } from '../audio/audioFiles'

const LOCALE = 'pl-PL'
// On-device recognizer package that exposes installed offline language models.
const ANDROID_ONDEVICE_PACKAGE = 'com.google.android.as'

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping'

export interface RecordingResult {
  transcript: string
  audioUri: string | null
  durationMs: number
}

export interface SpeechRecorder {
  status: RecorderStatus
  transcript: string
  durationMs: number
  error: string | null
  info: string | null
  start: () => Promise<void>
  stop: () => void
}

export const useSpeechRecorder = (
  onComplete: (result: RecordingResult) => void,
): SpeechRecorder => {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const statusRef = useRef<RecorderStatus>('idle')
  const segmentsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const audioUriRef = useRef<string | null>(null)
  const startTimeRef = useRef(0)
  const errorRef = useRef(false)
  const finalizedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)

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

  useSpeechRecognitionEvent('start', () => {
    setBoth('recording')
    startTimeRef.current = Date.now()
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
    } else {
      interimRef.current = text
    }
    setTranscript(composeTranscript())
  })

  useSpeechRecognitionEvent('audioend', (event) => {
    audioUriRef.current = event.uri ?? null
  })

  useSpeechRecognitionEvent('error', (event) => {
    // Errors raised while stopping/idle are the recognizer's normal teardown.
    if (statusRef.current === 'stopping' || statusRef.current === 'idle') return
    errorRef.current = true
    setError(event.message || event.error)
    stopTimer()
    setBoth('idle')
  })

  useSpeechRecognitionEvent('end', () => {
    stopTimer()
    setBoth('idle')
    if (finalizedRef.current || errorRef.current) return
    finalizedRef.current = true
    onCompleteRef.current({
      transcript: composeTranscript(),
      audioUri: audioUriRef.current,
      durationMs: startTimeRef.current > 0 ? Date.now() - startTimeRef.current : 0,
    })
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

  const start = async (): Promise<void> => {
    setError(null)
    errorRef.current = false
    finalizedRef.current = false

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
    audioUriRef.current = null
    setTranscript('')
    setDurationMs(0)

    try {
      const directory = await ensureRecordingsDir()
      ExpoSpeechRecognitionModule.start({
        lang: LOCALE,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        recordingOptions: {
          persist: true,
          outputDirectory: directory,
          outputSampleRate: 16000,
          outputEncoding: 'pcmFormatInt16',
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBoth('idle')
    }
  }

  const stop = (): void => {
    if (statusRef.current !== 'recording' && statusRef.current !== 'starting') return
    setBoth('stopping')
    ExpoSpeechRecognitionModule.stop()
  }

  return { status, transcript, durationMs, error, info, start, stop }
}
