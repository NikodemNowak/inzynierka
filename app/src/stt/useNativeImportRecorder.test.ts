import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { AppState, type AppStateStatus } from 'react-native'
import { useNativeImportRecorder } from './useNativeImportRecorder'
import { transcribeImportedAudio } from './importTranscription'
import type { SpeechRecorder } from './useSpeechRecorder'
import {
  markImportSourceCommitted,
  pauseImportProcessing,
} from '../processing/importProcessing'
import { enqueueLlm } from '../ai/llmQueue'
import { inspectImportAudio } from '../audio/importAudio'

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    requestSpeechRecognizerPermissionsAsync: jest.fn(async () => ({
      granted: true,
    })),
  },
}))
jest.mock('./importTranscription', () => ({
  transcribeImportedAudio: jest.fn(),
}))
jest.mock('../audio/importAudio', () => ({
  inspectImportAudio: jest.fn(async () => 120000),
}))
jest.mock('../processing/jobRunner', () => ({
  pauseAllProcessing: jest.fn(async () => undefined),
}))
jest.mock('../ai/llmQueue', () => ({
  enqueueLlm: jest.fn(async (work) => work()),
}))
jest.mock('../ai/llm', () => ({ unloadModel: jest.fn(async () => undefined) }))
let recorder: SpeechRecorder
let tree: ReactTestRenderer
let changeState: (state: AppStateStatus) => void
const complete = jest.fn()
function Harness() {
  recorder = useNativeImportRecorder(complete, 'pl')
  return null
}
beforeEach(async () => {
  jest.clearAllMocks()
  jest.mocked(inspectImportAudio).mockResolvedValue(120000)
  AppState.currentState = 'active'
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    changeState = listener
    return { remove: jest.fn() }
  })
  await act(async () => {
    tree = create(createElement(Harness))
  })
})
afterEach(async () => {
  await act(async () => tree.unmount())
  jest.restoreAllMocks()
})
test('returns from preparation while the native window continues, keeping Stop available', async () => {
  let resolve: ((text: string) => void) | undefined
  jest.mocked(transcribeImportedAudio).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  let returned = false
  await act(async () => {
    void recorder
      .start({ uri: 'file:///a.m4a', durationMs: 120000 })
      .then(() => {
        returned = true
      })
  })
  expect(returned).toBe(true)
  expect(recorder.status).toBe('recording')
  await act(async () => {
    resolve?.('Transcript')
  })
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ needsTranscription: false }),
    expect.objectContaining({ signal: expect.anything() }),
  )
})
test('backgrounding without a processing grant cancels active speech and keeps the source partial', async () => {
  jest.mocked(transcribeImportedAudio).mockImplementationOnce(
    (_, __, ___, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new Error('cancelled')),
        )
      }),
  )
  await act(async () => {
    void recorder.start({ uri: 'file:///a.m4a', durationMs: 120000 })
  })
  await act(async () => changeState('background'))
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      audioUri: 'file:///a.m4a',
      needsTranscription: true,
    }),
  )
})

test('keeps committed source processing alive when navigation unmounts its screen', async () => {
  let signal: AbortSignal | undefined
  let release: () => void = () => undefined
  const completion = new Promise<void>((resolve) => {
    release = resolve
  })
  jest
    .mocked(transcribeImportedAudio)
    .mockImplementationOnce(async (_, __, ___, options) => {
      signal = options.signal
      return 'Transcript'
    })
  complete.mockImplementationOnce(async (_result, continuation) => {
    markImportSourceCommitted(continuation)
    await completion
  })
  await act(async () => {
    await recorder.start({ uri: 'file:///committed.m4a', durationMs: 120000 })
  })
  await act(async () => {
    tree.unmount()
  })
  const wasAborted = signal?.aborted
  await act(async () => {
    release()
  })
  expect(wasAborted).toBe(false)
})

test('lets recording cancel a queued import before native transcription begins', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  jest.mocked(enqueueLlm).mockImplementationOnce(async (work) => {
    await gate
    return work()
  })
  await act(async () => {
    await recorder.start({ uri: 'file:///queued.m4a', durationMs: 120000 })
  })
  pauseImportProcessing()
  await act(async () => {
    release()
  })
  expect(transcribeImportedAudio).not.toHaveBeenCalled()
})

test('transcribes the inspected whole file when a saved note declares only its prefix', async () => {
  jest.mocked(transcribeImportedAudio).mockResolvedValueOnce('First part. Last part.')
  await act(async () => {
    await recorder.start({ uri: 'file:///stale.m4a', durationMs: 60000 })
  })
  expect(inspectImportAudio).toHaveBeenCalledWith('file:///stale.m4a', expect.anything())
  expect(transcribeImportedAudio).toHaveBeenCalledWith(
    'file:///stale.m4a', 120000, 'pl', expect.anything(),
  )
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      transcript: 'First part. Last part.', durationMs: 120000, needsTranscription: false,
    }),
    expect.anything(),
  )
  expect(recorder.durationMs).toBe(120000)
})

test('clears an earlier partial transcript and progress before retrying audio', async () => {
  jest.mocked(transcribeImportedAudio).mockImplementationOnce(async (_uri, _duration, _language, options) => {
    options.onProgress?.('An earlier partial transcript', 1, 2)
    throw new Error('Recognition failed')
  })
  await act(async () => { await recorder.start({ uri: 'file:///retry.wav', durationMs: 120000 }) })
  expect(recorder.transcript).toBe('An earlier partial transcript')
  expect(recorder.info).not.toBeNull()
  let release: (text: string) => void = () => undefined
  jest.mocked(transcribeImportedAudio).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  await act(async () => { await recorder.start({ uri: 'file:///retry.wav', durationMs: 120000 }) })
  try {
    expect(recorder.transcript).toBe('')
    expect(recorder.info).toBeNull()
    expect(recorder.error).toBeNull()
  } finally {
    await act(async () => { release('A verified new transcript') })
  }
})

test.each([1799000, 1800000])('accepts an inspected %i ms file despite stale metadata', async (actualDuration) => {
  jest.mocked(inspectImportAudio).mockResolvedValueOnce(actualDuration)
  jest.mocked(transcribeImportedAudio).mockResolvedValueOnce('Whole file.')
  await act(async () => {
    await recorder.start({ uri: 'file:///near-limit.m4a', durationMs: 60000 })
  })
  expect(transcribeImportedAudio).toHaveBeenCalledWith(
    'file:///near-limit.m4a', actualDuration, 'pl', expect.anything(),
  )
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ durationMs: actualDuration, needsTranscription: false }),
    expect.anything(),
  )
})

test('rejects an inspected file above 30 minutes despite shorter saved metadata', async () => {
  jest.mocked(inspectImportAudio).mockResolvedValueOnce(1800001)
  jest.mocked(transcribeImportedAudio).mockResolvedValueOnce('Only a prefix.')
  await act(async () => {
    await recorder.start({ uri: 'file:///over-limit.m4a', durationMs: 60000 })
  })
  expect(transcribeImportedAudio).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
  expect(recorder.status).toBe('idle')
  expect(recorder.error).toMatch(/audio-duration-limit|30/)
})

test('never certifies a cached prefix when actual file inspection fails', async () => {
  jest.mocked(inspectImportAudio).mockRejectedValueOnce(new Error('Cannot decode whole audio'))
  jest.mocked(transcribeImportedAudio).mockResolvedValueOnce('Cached prefix.')
  await act(async () => {
    await recorder.start({ uri: 'file:///changed.m4a', durationMs: 60000 })
  })
  expect(transcribeImportedAudio).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
  expect(recorder.error).toBe('Cannot decode whole audio')
})
