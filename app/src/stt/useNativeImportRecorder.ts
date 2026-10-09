import { useEffect, useRef, useState } from 'react'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import type {
  RecordingResult,
  SpeechRecorder,
  RecorderStatus,
  AudioFileSource,
} from './useSpeechRecorder'
import type { Language } from '../i18n/language'
import { transcribeImportedAudio } from './importTranscription'
import { inspectImportAudio } from '../audio/importAudio'
import { validateImportDuration } from '../audio/captureManifest'
import { pauseAllProcessing } from '../processing/jobRunner'
import { enqueueLlm } from '../ai/llmQueue'
import { unloadModel } from '../ai/llm'
import { translate } from '../i18n/translate'
import {
  runImportProcessing,
  registerImportProcessing,
  isImportSourceCommitted,
  type ImportContinuation,
} from '../processing/importProcessing'
import { useSettingsStore } from '../state/settingsStore'

export const useNativeImportRecorder = (
  onComplete: (
    result: RecordingResult,
    continuation?: ImportContinuation,
  ) => void | Promise<void>,
  language: Language = 'pl',
): SpeechRecorder => {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const continuation = useRef<ImportContinuation | undefined>(undefined)
  const currentStatus = useRef<RecorderStatus>('idle')
  const callback = useRef(onComplete)
  callback.current = onComplete
  const current = useRef({ transcript: '', uri: '', durationMs: 0, language })
  const setBoth = (next: RecorderStatus) => {
    currentStatus.current = next
    if (mounted.current) setStatus(next)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (!isImportSourceCommitted(continuation.current))
        controller.current?.abort()
    }
  }, [])
  const start = async (
    source?: AudioFileSource,
    chosen: Language = language,
  ): Promise<void> => {
    if (!source || currentStatus.current !== 'idle') return
    const abort = new AbortController()
    controller.current = abort
    continuation.current = undefined
    const unregister = registerImportProcessing(abort)
    let queued = false
    let failureHandled = false
    setBoth('starting')
    setTranscript('')
    setInfo(null)
    setDurationMs(0)
    setError(null)
    setPermissionDenied(false)
    current.current = {
      transcript: '',
      uri: source.uri,
      durationMs: source.durationMs ?? 0,
      language: chosen,
    }
    const handleFailure = async (failure: unknown) => {
      if (failureHandled) return
      failureHandled = true
      if (!mounted.current || controller.current !== abort) return
      setBoth('idle')
      if (
        abort.signal.aborted &&
        !isImportSourceCommitted(continuation.current)
      ) {
        await callback.current({
          transcript: current.current.transcript,
          language: chosen,
          audioUri: source.uri,
          durationMs: current.current.durationMs,
          needsTranscription: true,
          notice: translate(
            'Transkrypcję zatrzymano. Zapisane części i audio pozostają dostępne do wznowienia.',
            'Transcription stopped. Saved parts and audio remain available to resume.',
          ),
        })
      } else
        setError(failure instanceof Error ? failure.message : String(failure))
    }
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync()
      if (abort.signal.aborted || !mounted.current) {
        if (mounted.current) setBoth('idle')
        return
      }
      if (!permission.granted) {
        setPermissionDenied(true)
        throw new Error(
          translate(
            'Brak zgody na rozpoznawanie mowy.',
            'Speech recognition permission is missing.',
          ),
        )
      }
      // Saved note metadata can describe only an older prefix. Inspect the
      // source before choosing windows or accepting a completed checkpoint.
      const duration = validateImportDuration(
        await inspectImportAudio(source.uri, abort.signal),
      )
      current.current.durationMs = duration
      setDurationMs(duration)
      await pauseAllProcessing('recording')
      if (abort.signal.aborted) {
        setBoth('idle')
        return
      }
      setBoth('recording')
      // Share the heavy-work queue: recording can abort this import before
      // waiting for it, and an LLM cannot compete with window transcription.
      const work = enqueueLlm(async () => {
        if (abort.signal.aborted)
          throw new Error(translate('Import wstrzymano.', 'Import paused.'))
        await unloadModel()
        return runImportProcessing(
          abort,
          useSettingsStore.getState().backgroundProcessing,
          async (report, token) => {
            continuation.current = token
            try {
              const text = await transcribeImportedAudio(
                source.uri,
                duration,
                chosen,
                {
                  signal: abort.signal,
                  onProgress: (text, completed, total) => {
                    report(completed, total)
                    current.current.transcript = text
                    if (mounted.current) {
                      setTranscript(text)
                      setInfo(
                        translate(
                          `Transkrypcja — ${completed} z ${total} części`,
                          `Transcription — ${completed} of ${total} parts`,
                        ),
                      )
                    }
                  },
                },
              )
              if (!mounted.current || abort.signal.aborted) return
              setBoth('idle')
              await callback.current(
                {
                  transcript: text,
                  language: chosen,
                  audioUri: source.uri,
                  durationMs: duration,
                  needsTranscription: false,
                },
                token,
              )
            } catch (failure) {
              // Persist partial text while the parent grant still belongs to us.
              await handleFailure(failure)
              throw failure
            }
          },
        )
      })
      queued = true
      void work.catch(handleFailure).finally(() => {
        unregister()
        if (mounted.current && controller.current === abort) setBoth('idle')
        if (controller.current === abort) controller.current = null
      })
    } catch (failure) {
      await handleFailure(failure)
    } finally {
      if (!queued) unregister()
    }
  }
  const stop = () => {
    if (controller.current) {
      setBoth('stopping')
      controller.current.abort()
    }
  }
  return {
    status,
    transcript,
    finalTranscript: transcript,
    durationMs,
    volumeLevel: 0,
    error,
    permissionDenied,
    info,
    start,
    stop,
  }
}
