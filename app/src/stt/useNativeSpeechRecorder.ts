import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { nativeCapture, type CaptureSnapshot } from './nativeCapture'
import type {
  RecordingResult,
  RecorderStatus,
  SpeechRecorder,
} from './useSpeechRecorder'
import type { Language } from '../i18n/language'
import { translate } from '../i18n/translate'
import { finalizeCapture } from '../audio/captureRecovery'
import { pauseAllProcessing } from '../processing/jobRunner'
import { pauseImportProcessing } from '../processing/importProcessing'
import { enqueueLlm } from '../ai/llmQueue'
import { unloadModel } from '../ai/llm'
import { normalizeCaptureVolume } from './microphoneMeter'

export const useNativeSpeechRecorder = (
  onComplete: (result: RecordingResult) => void,
  language: Language = 'pl',
): SpeechRecorder => {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [durationMs, setDurationMs] = useState(0)
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [recordingLanguage, setRecordingLanguage] = useState<Language>(language)
  const session = useRef<string | null>(null)
  const statusRef = useRef<RecorderStatus>('idle')
  const mounted = useRef(true)
  const generation = useRef(0)
  const finalizing = useRef(false)
  const completed = useRef<string | null>(null)
  const lastCursor = useRef(-1)
  const finalText = useRef('')
  const interim = useRef('')
  const livePreview = useRef<string | null>(null)
  const meterExpiry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callback = useRef(onComplete)
  callback.current = onComplete
  const setBoth = (next: RecorderStatus) => {
    statusRef.current = next
    if (mounted.current) setStatus(next)
  }

  const complete = async (snapshot: CaptureSnapshot): Promise<void> => {
    const id = snapshot.manifest.sessionId
    if (
      finalizing.current ||
      completed.current === id ||
      snapshot.manifest.materializedNoteId
    )
      return
    finalizing.current = true
    setBoth('stopping')
    try {
      // Audio is already closed. Wait only for the bounded native Speech final
      // flush; its timeout/persistence still run when JavaScript is suspended.
      while (snapshot.speechFinalizing && mounted.current) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
        const current = await nativeCapture!.getSnapshot()
        if (!current || current.manifest.sessionId !== id)
          throw new Error('Capture session changed')
        snapshot = current
      }
      if (!mounted.current) return
      const result = await finalizeCapture(snapshot)
      if (!mounted.current) return
      completed.current = id
      setBoth('idle')
      callback.current(result)
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
      setInfo(
        translate(
          'Audio źródłowe jest zachowane. Ponów przygotowanie nagrania.',
          'Source audio is kept. Retry preparing the recording.',
        ),
      )
      setBoth('interrupted')
    } finally {
      finalizing.current = false
    }
  }
  const apply = (snapshot: CaptureSnapshot | null) => {
    if (!snapshot || !mounted.current) return
    if (snapshot.manifest.materializedNoteId) return
    if (
      session.current === snapshot.manifest.sessionId &&
      snapshot.cursor < lastCursor.current
    )
      return
    if (
      session.current &&
      session.current !== snapshot.manifest.sessionId &&
      statusRef.current !== 'idle'
    )
      return
    lastCursor.current = snapshot.cursor
    session.current = snapshot.manifest.sessionId
    setRecordingLanguage(snapshot.manifest.language)
    if (snapshot.finalTranscript !== undefined)
      finalText.current = snapshot.finalTranscript
    if (snapshot.interimTranscript !== undefined)
      interim.current = snapshot.interimTranscript
    if (snapshot.livePreviewTranscript !== undefined)
      livePreview.current = snapshot.livePreviewTranscript
    else if (snapshot.finalTranscript !== undefined || snapshot.interimTranscript !== undefined)
      livePreview.current = null
    setFinalTranscript(finalText.current)
    setTranscript(
      livePreview.current ??
        [finalText.current, interim.current].filter(Boolean).join(' '),
    )
    setDurationMs(Math.round((snapshot.manifest.frames * 1000) / 16000))
    const state = snapshot.manifest.state
    if (meterExpiry.current) clearTimeout(meterExpiry.current)
    setVolumeLevel(state === 'recording' ? normalizeCaptureVolume(snapshot.volumeLevel) : 0)
    meterExpiry.current = state === 'recording' ? setTimeout(() => {
      meterExpiry.current = null
      if (mounted.current) setVolumeLevel(0)
    }, 500) : null
    if (state === 'recording') setBoth('recording')
    else if (state === 'interrupted' || state === 'error') {
      setBoth('interrupted')
      setInfo(
        translate(
          'Mikrofon zatrzymany. Wznów ręcznie lub zakończ i zapisz dotychczasowe audio.',
          'Microphone stopped. Resume manually or stop and save the recorded audio.',
        ),
      )
      if (snapshot.manifest.error) setError(snapshot.manifest.error)
    } else if (state === 'stopped' || state === 'recovered')
      void complete(snapshot)
    if (state === 'recording' && snapshot.manifest.needsTranscription)
      setInfo(
        translate(
          'Nagrywam audio. Transkrypcja może wymagać uzupełnienia po zakończeniu.',
          'Recording audio. The transcript may need completion after recording.',
        ),
      )
  }
  const applyRef = useRef(apply)
  applyRef.current = apply
  useEffect(() => {
    mounted.current = true
    const state = nativeCapture!.addListener('captureState', (value) =>
      applyRef.current(value),
    )
    const text = nativeCapture!.addListener('captureTranscript', (value) => {
      if (value.sessionId !== session.current || !mounted.current) return
      if (value.cursor !== undefined) {
        if (value.cursor < lastCursor.current) return
        lastCursor.current = value.cursor
      }
      finalText.current = value.finalTranscript
      interim.current = value.interimTranscript
      livePreview.current = value.livePreviewTranscript ?? null
      setFinalTranscript(value.finalTranscript)
      setTranscript(
        value.livePreviewTranscript ??
          [value.finalTranscript, value.interimTranscript]
            .filter(Boolean)
            .join(' '),
      )
    })
    void nativeCapture!
      .getSnapshot()
      .then((value) => applyRef.current(value))
      .catch((failure: unknown) => {
        if (mounted.current)
          setError(failure instanceof Error ? failure.message : String(failure))
      })
    const app = AppState.addEventListener('change', (value) => {
      if (value === 'active')
        void nativeCapture!
          .getSnapshot()
          .then((value) => applyRef.current(value))
    })
    return () => {
      mounted.current = false
      generation.current += 1
      if (meterExpiry.current) clearTimeout(meterExpiry.current)
      state.remove()
      text.remove()
      app.remove()
    }
  }, [])

  const start = async (
    _source?: { uri: string },
    sessionLanguage: Language = language,
  ) => {
    if (statusRef.current !== 'idle') return
    const epoch = ++generation.current
    const cancelled = () => !mounted.current || epoch !== generation.current
    setBoth('starting')
    setError(null)
    setPermissionDenied(false)
    setInfo(null)
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync()
      if (cancelled()) return
      if (!permission.granted) {
        setPermissionDenied(true)
        throw new Error(
          translate(
            'Brak zgody na mikrofon.',
            'Microphone permission is missing.',
          ),
        )
      }
      // Speech permission/model availability never decide whether audio is kept.
      await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync()
      if (cancelled()) return
      pauseImportProcessing()
      await pauseAllProcessing('recording')
      if (cancelled()) return
      await enqueueLlm(unloadModel)
      if (cancelled()) return
      if (AppState.currentState !== 'active')
        throw new Error(
          translate(
            'Wróć do aplikacji, aby rozpocząć nagrywanie.',
            'Return to the app to start recording.',
          ),
        )
      const id = `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      session.current = id
      completed.current = null
      finalText.current = ''
      interim.current = ''
      livePreview.current = null
      apply(await nativeCapture!.start(id, sessionLanguage))
    } catch (failure) {
      if (!cancelled()) {
        setError(failure instanceof Error ? failure.message : String(failure))
        setBoth('idle')
      }
    }
  }
  const resume = async () => {
    if (!session.current || statusRef.current !== 'interrupted') return
    setBoth('starting')
    setError(null)
    try {
      pauseImportProcessing()
      await pauseAllProcessing('recording')
      await enqueueLlm(unloadModel)
      apply(await nativeCapture!.resume(session.current))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBoth('interrupted')
    }
  }
  const stop = () => {
    if (statusRef.current === 'starting' && !session.current) {
      generation.current += 1
      setBoth('idle')
      return
    }
    if (!session.current || finalizing.current) return
    setBoth('stopping')
    void nativeCapture!
      .stop(session.current)
      .then((snapshot) => complete(snapshot))
      .catch((failure: unknown) => {
        if (mounted.current) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setBoth('interrupted')
        }
      })
  }
  return {
    status,
    transcript,
    finalTranscript,
    durationMs,
    volumeLevel,
    error,
    permissionDenied,
    info,
    start,
    stop,
    resume,
    backgroundRecording: true,
    recordingLanguage,
  }
}
