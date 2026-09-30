import { createElement } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { useSpeechRecorder, type SpeechRecorder } from './useSpeechRecorder'
import { concatWavFiles } from '../audio/wavConcat'

type SpeechEvent = {
  results?: { transcript: string }[]
  isFinal?: boolean
  uri?: string
  error?: string
  message?: string
}
const mockEvents = new Map<string, (event: SpeechEvent) => void>()
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    supportsOnDeviceRecognition: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: (
    name: string,
    callback: (event: SpeechEvent) => void,
  ) => {
    mockEvents.set(name, callback)
  },
}))
jest.mock('../audio/audioFiles', () => ({
  RECORDINGS_DIR: 'file:///recordings/',
  ensureRecordingsDir: jest.fn(),
}))
jest.mock('../audio/wavConcat', () => ({
  concatWavFiles: jest.fn(async () => ({
    uri: 'file:///joined.wav',
    durationMs: 1700,
  })),
}))

const native = jest.mocked(ExpoSpeechRecognitionModule)
let recorder: SpeechRecorder
let tree: ReactTestRenderer
let changeAppState: (state: AppStateStatus) => void
const complete = jest.fn()
function Harness() {
  recorder = useSpeechRecorder(complete)
  return null
}
const emit = async (name: string, value: SpeechEvent = {}) => {
  await act(async () => {
    mockEvents.get(name)?.(value)
  })
}
const startRecording = async () => {
  await act(async () => {
    await recorder.start()
  })
  await emit('start')
}

beforeEach(async () => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  mockEvents.clear()
  AppState.currentState = 'active'
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, listener) => {
      if (event === 'change')
        changeAppState = listener as (state: AppStateStatus) => void
      return { remove: jest.fn() }
    })
  native.requestPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    expires: 'never',
    status: 'granted',
  } as Awaited<ReturnType<typeof native.requestPermissionsAsync>>)
  await act(async () => {
    tree = create(createElement(Harness))
  })
})
afterEach(async () => {
  await act(async () => tree.unmount())
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('an iOS audio interruption saves captured speech and audio without restarting', async () => {
  await startRecording()
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Zachowaj ten tekst.' }],
  })
  await emit('error', {
    error: 'interrupted',
    message: 'Audio session was interrupted',
  })
  await emit('audioend', { uri: 'file:///part.wav' })
  await emit('end')
  expect(native.start).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      transcript: 'Zachowaj ten tekst.',
      audioUri: 'file:///joined.wav',
      durationMs: 1700,
      notice: expect.stringContaining('przerwane'),
    }),
  )
  expect(recorder.status).toBe('idle')
})

test('idle hooks ignore native events from another screen', async () => {
  await emit('start')
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Other screen' }],
  })
  await emit('end')
  expect(recorder.status).toBe('idle')
  expect(recorder.transcript).toBe('')
  expect(native.start).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
})

test('silence can restart recognition without losing earlier speech', async () => {
  await startRecording()
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Pierwsze zdanie.' }],
  })
  await emit('error', { error: 'no-speech' })
  await emit('audioend', { uri: 'file:///one.wav' })
  await emit('end')
  expect(native.start).toHaveBeenCalledTimes(2)
  await emit('start')
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Drugie zdanie.' }],
  })
  await act(async () => recorder.stop())
  await emit('audioend', { uri: 'file:///two.wav' })
  await emit('end')
  expect(complete).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ transcript: 'Pierwsze zdanie. Drugie zdanie.' }),
  )
})

test('permission denial exposes settings recovery and retry clears it', async () => {
  native.requestPermissionsAsync.mockResolvedValueOnce({
    granted: false,
    canAskAgain: false,
    expires: 'never',
    status: 'denied',
  } as Awaited<ReturnType<typeof native.requestPermissionsAsync>>)
  await act(async () => {
    await recorder.start()
  })
  expect(recorder.permissionDenied).toBe(true)
  expect(native.start).not.toHaveBeenCalled()
  await startRecording()
  expect(recorder.permissionDenied).toBe(false)
  expect(recorder.status).toBe('recording')
})

test('stop during permission request prevents a late microphone start', async () => {
  let grant:
    | ((
        value: Awaited<ReturnType<typeof native.requestPermissionsAsync>>,
      ) => void)
    | undefined
  native.requestPermissionsAsync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve
      }),
  )
  let starting: Promise<void> | undefined
  await act(async () => {
    starting = recorder.start()
  })
  await act(async () => recorder.stop())
  await act(async () => {
    grant?.({ granted: true } as Awaited<
      ReturnType<typeof native.requestPermissionsAsync>
    >)
    await starting
  })
  expect(native.start).not.toHaveBeenCalled()
  expect(recorder.status).toBe('idle')
})

test('a system permission dialog may temporarily background the app before capture starts', async () => {
  let grant:
    | ((
        value: Awaited<ReturnType<typeof native.requestPermissionsAsync>>,
      ) => void)
    | undefined
  native.requestPermissionsAsync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve
      }),
  )
  let starting: Promise<void> | undefined
  await act(async () => {
    starting = recorder.start()
  })
  await act(async () => {
    AppState.currentState = 'background'
    changeAppState('background')
  })
  expect(complete).not.toHaveBeenCalled()
  await act(async () => {
    AppState.currentState = 'active'
    changeAppState('active')
    grant?.({ granted: true } as Awaited<
      ReturnType<typeof native.requestPermissionsAsync>
    >)
    await starting
  })
  expect(native.start).toHaveBeenCalledTimes(1)
})

test('backgrounding stops the microphone, freezes time and saves the final tail once', async () => {
  await startRecording()
  await act(async () => {
    jest.advanceTimersByTime(2000)
  })
  await act(async () => changeAppState('inactive'))
  expect(native.stop).not.toHaveBeenCalled()
  await act(async () => {
    AppState.currentState = 'background'
    changeAppState('background')
  })
  expect(native.stop).toHaveBeenCalledTimes(1)
  expect(recorder.status).toBe('stopping')
  await act(async () => {
    jest.advanceTimersByTime(20000)
  })
  expect(recorder.durationMs).toBe(2000)
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Ostatnie zdanie.' }],
  })
  await emit('audioend', { uri: 'file:///part.wav' })
  await emit('end')
  await emit('end')
  await act(async () => {
    AppState.currentState = 'active'
    changeAppState('active')
  })
  expect(native.start).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      transcript: 'Ostatnie zdanie.',
      notice: expect.stringContaining('schowaniu aplikacji'),
    }),
  )
})

test('background policy does not interrupt file transcription as if it were a live microphone', async () => {
  await act(async () => {
    await recorder.start({ uri: 'file:///import.wav' })
  })
  await emit('start')
  await act(async () => {
    AppState.currentState = 'background'
    changeAppState('background')
  })
  expect(native.stop).not.toHaveBeenCalled()
  await emit('result', { isFinal: true, results: [{ transcript: 'Z pliku.' }] })
  await emit('end')
  expect(native.start).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      transcript: 'Z pliku.',
      audioUri: 'file:///import.wav',
    }),
  )
})

test('failed audio assembly preserves text and explicitly reports missing audio', async () => {
  jest.mocked(concatWavFiles).mockRejectedValueOnce(new Error('Invalid WAV'))
  await startRecording()
  await emit('result', {
    isFinal: true,
    results: [{ transcript: 'Ważny tekst.' }],
  })
  await act(async () => recorder.stop())
  await emit('audioend', { uri: 'file:///part.wav' })
  await emit('end')
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      transcript: 'Ważny tekst.',
      audioUri: null,
      notice: expect.stringContaining('pliku nagrania'),
    }),
  )
})
