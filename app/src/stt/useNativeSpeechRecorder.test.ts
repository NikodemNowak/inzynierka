import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { AppState } from 'react-native'
import { nativeCapture, type CaptureSnapshot } from './nativeCapture'
import { useNativeSpeechRecorder } from './useNativeSpeechRecorder'
import type { SpeechRecorder } from './useSpeechRecorder'

jest.mock('./nativeCapture', () => ({
  nativeCapture: {
    start: jest.fn(),
    stop: jest.fn(),
    resume: jest.fn(),
    getSnapshot: jest.fn(),
    addListener: jest.fn(),
  },
}))
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    requestMicrophonePermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestSpeechRecognizerPermissionsAsync: jest.fn(async () => ({
      granted: true,
    })),
  },
}))
jest.mock('../audio/captureRecovery', () => ({
  finalizeCapture: jest.fn(async (snapshot) => ({
    sessionId: snapshot.manifest.sessionId,
    transcript: 'Saved',
    audioUri: 'file:///saved.wav',
    durationMs: 1200,
    language: 'pl',
    needsTranscription: true,
  })),
}))
jest.mock('../processing/jobRunner', () => ({
  pauseAllProcessing: jest.fn(async () => undefined),
}))
jest.mock('../ai/llmQueue', () => ({
  enqueueLlm: jest.fn(async (work) => work()),
}))
jest.mock('../ai/llm', () => ({ unloadModel: jest.fn(async () => undefined) }))

const native = jest.mocked(nativeCapture!)
let captureId = 'capture-test'
const snapshot = (state = 'recording'): CaptureSnapshot => ({
  manifest: {
    version: 1,
    sessionId: captureId,
    state: state as CaptureSnapshot['manifest']['state'],
    language: 'pl',
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
    frames: 19200,
    segments: [{ key: '000000.wav', frames: 19200 }],
    gaps: [],
    needsTranscription: true,
    startedAt: 123,
  },
  directory: 'file:///capture/',
  volumeLevel: 0.3,
  cursor: 1,
})
let events: Record<string, (event: never) => void>
let recorder: SpeechRecorder
let tree: ReactTestRenderer
const complete = jest.fn()
function Harness() {
  recorder = useNativeSpeechRecorder(complete, 'pl')
  return null
}
beforeEach(async () => {
  jest.clearAllMocks()
  events = {}
  AppState.currentState = 'active'
  native.getSnapshot.mockResolvedValue(null)
  captureId = 'capture-test'
  native.start.mockImplementation(async (id) => {
    captureId = id
    return snapshot()
  })
  native.addListener.mockImplementation((name, listener) => {
    events[name] = listener as (event: never) => void
    return { remove: jest.fn() }
  })
  await act(async () => {
    tree = create(createElement(Harness))
  })
})
afterEach(async () => {
  await act(async () => tree.unmount())
  jest.useRealTimers()
})
test('keeps native capture running after recording screen unmount', async () => {
  await act(async () => recorder.start())
  expect(recorder.status).toBe('recording')
  await act(async () => tree.unmount())
  expect(native.stop).not.toHaveBeenCalled()
})
test('reattaches using native sample duration and requires manual resume after interruption', async () => {
  await act(async () => recorder.start())
  await act(async () => events.captureState(snapshot('interrupted') as never))
  expect(recorder.status).toBe('interrupted')
  expect(recorder.durationMs).toBe(1200)
  expect(native.resume).not.toHaveBeenCalled()
  native.resume.mockResolvedValue(snapshot())
  await act(async () => recorder.resume?.())
  expect(native.resume).toHaveBeenCalledWith(captureId)
})
test('materializes a native completed session only once despite repeated events', async () => {
  await act(async () => recorder.start())
  native.getSnapshot.mockResolvedValue(snapshot('stopped'))
  await act(async () => {
    events.captureState(snapshot('stopped') as never)
    events.captureState(snapshot('stopped') as never)
  })
  expect(complete).toHaveBeenCalledTimes(1)
})

test('shows a provisional live hypothesis without turning it into finalized source', async () => {
  await act(async () => recorder.start())
  await act(async () => events.captureTranscript({
    sessionId: captureId,
    cursor: 2,
    finalTranscript: '',
    interimTranscript: '',
    livePreviewTranscript: 'Jutro sprawdzę nagranie',
  } as never))
  expect(recorder.transcript).toBe('Jutro sprawdzę nagranie')
  expect(recorder.finalTranscript).toBe('')
  expect(complete).not.toHaveBeenCalled()
  await act(async () => events.captureState({ ...snapshot(), cursor: 3 } as never))
  expect(recorder.transcript).toBe('Jutro sprawdzę nagranie')
})

test('restores a live preview from the native snapshot and keeps older native events compatible', async () => {
  await act(async () => recorder.start())
  await act(async () => events.captureState({ ...snapshot(), cursor: 2,
    finalTranscript: 'Zapisany początek.', interimTranscript: '',
    livePreviewTranscript: 'Zapisany początek. Nowa hipoteza',
  } as never))
  expect(recorder.transcript).toBe('Zapisany początek. Nowa hipoteza')
  expect(recorder.finalTranscript).toBe('Zapisany początek.')
  await act(async () => events.captureTranscript({ sessionId: captureId,
    finalTranscript: 'Zapisany początek.', interimTranscript: 'Starszy moduł działa.',
  } as never))
  expect(recorder.transcript).toBe('Zapisany początek. Starszy moduł działa.')
})

test('a delayed native snapshot cannot overwrite a newer live hypothesis', async () => {
  await act(async () => recorder.start())
  await act(async () => events.captureTranscript({ sessionId: captureId, cursor: 4,
    finalTranscript: '', interimTranscript: 'Aktualna wypowiedź.',
  } as never))
  await act(async () => events.captureState({ ...snapshot(), cursor: 3,
    finalTranscript: '', interimTranscript: 'Stara wypowiedź.',
  } as never))
  expect(recorder.transcript).toBe('Aktualna wypowiedź.')
})

test('makes measured speech visible while suppressing the captured microphone noise floor', async () => {
  await act(async () => recorder.start())
  await act(async () => events.captureState({ ...snapshot(), cursor: 2, volumeLevel: 0.230935 } as never))
  expect(recorder.volumeLevel).toBeGreaterThan(0.6)
  expect(recorder.volumeLevel).toBeLessThan(0.75)
  await act(async () => events.captureState({ ...snapshot(), cursor: 3, volumeLevel: 0.010875 } as never))
  expect(recorder.volumeLevel).toBe(0)
  await act(async () => events.captureState({ ...snapshot(), cursor: 4, volumeLevel: 0.4195 } as never))
  expect(recorder.volumeLevel).toBeGreaterThan(0.8)
  expect(recorder.volumeLevel).toBeLessThan(0.95)
})

test('lets stale microphone telemetry fall back to silence instead of showing a stuck signal', async () => {
  jest.useFakeTimers()
  await act(async () => recorder.start())
  expect(recorder.volumeLevel).toBeGreaterThan(0)
  await act(async () => { jest.advanceTimersByTime(250) })
  expect(recorder.volumeLevel).toBeGreaterThan(0)
  await act(async () => events.captureState({ ...snapshot(), cursor: 2, volumeLevel: 0.4 } as never))
  await act(async () => { jest.advanceTimersByTime(250) })
  expect(recorder.volumeLevel).toBeGreaterThan(0)
  await act(async () => { jest.advanceTimersByTime(350) })
  expect(recorder.volumeLevel).toBe(0)
  expect(recorder.status).toBe('recording')
})
