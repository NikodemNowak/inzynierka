import { nativeCapture } from '../stt/nativeCapture'
import { transcribeBenchmarkAudio } from './benchmarkAudio'
import type { BenchmarkAudioRun } from './benchmarkTypes'

jest.mock('./llm', () => ({
  GenerationCancelledError: class extends Error { constructor() { super('Generation cancelled') } },
}))
jest.mock('../stt/nativeCapture', () => ({
  NativeSpeechWindowError: class extends Error {},
  nativeCapture: {
    inspectAudio: jest.fn(),
    transcribeWindow: jest.fn(async () => 'Actual recognized speech.'),
    cancelTranscription: jest.fn(async () => undefined),
  },
}))
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }))

const audioRun = (expectedDurationMs?: number): BenchmarkAudioRun => ({
  uri: 'file:///bundle/english.wav', locale: 'en-US', provenance: 'synthetic-audio',
  referenceTranscript: 'A diagnostic reference is never input to speech recognition.',
  ...(expectedDurationMs !== undefined ? { expectedDurationMs } : {}),
  requireOnDeviceRecognition: true, transcript: '', durationMs: null,
  sampleRate: null, channels: null, sttMs: 0, status: 'failed',
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 167220, sampleRate: 16000, channels: 1 })
})

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 42000])(
  'rejects invalid or different expected audio duration %p before any STT window', async (expected) => {
    const audio = audioRun(expected)
    await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).rejects.toThrow(/duration/i)
    expect(nativeCapture!.inspectAudio).toHaveBeenCalledTimes(1)
    expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
    expect(audio.status).toBe('failed')
    expect(audio.transcript).toBe('')
    expect(audio.durationMs).toBe(167220)
  },
)

test.each([
  [167220, 167270, 3],
  [600000, 600060, 11],
  [1800000, 1799900, 30],
] as const)('allows bounded duration rounding %p → %p and recognizes every actual window', async (expected, actual, count) => {
  const audio = audioRun(expected)
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: actual, sampleRate: 16000, channels: 1 })
  await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).resolves.toBe(Array(count).fill('Actual recognized speech.').join(' '))
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(count)
  expect(nativeCapture!.inspectAudio).toHaveBeenCalledTimes(1)
  expect(audio.status).toBe('complete')
  expect(audio.durationMs).toBe(actual)
  expect(audio.windows?.at(-1)).toMatchObject({ startMs: (count - 1) * 60000, durationMs: actual - (count - 1) * 60000 })
})

test('rejects duration drift outside the bounded rounding tolerance', async () => {
  const audio = audioRun(600000)
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 600061, sampleRate: 16000, channels: 1 })
  await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).rejects.toThrow(/duration/i)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
})

test('keeps unregistered legacy audio without expected duration compatible', async () => {
  const audio = audioRun()
  await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).resolves.toMatch(/Actual recognized speech/)
  expect(audio.status).toBe('complete')
})

test('recognizes bundled audio in fresh thirty-second windows without gaps or reference substitution', async () => {
  const audio = { ...audioRun(167220), bundled: true }
  const chunks = ['Actual first.', 'Actual second.', 'Actual third.', 'Actual fourth.', 'Actual fifth.', 'Actual last.']
  for (const chunk of chunks) jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValueOnce(chunk)
  await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).resolves.toBe(
    'Actual first. Actual second. Actual third. Actual fourth. Actual fifth. Actual last.',
  )
  const calls = jest.mocked(nativeCapture!.transcribeWindow).mock.calls
  expect(calls.map((call) => call.slice(1, 4))).toEqual([
    [0, 30000, 'en-US'], [30000, 30000, 'en-US'], [60000, 30000, 'en-US'],
    [90000, 30000, 'en-US'], [120000, 30000, 'en-US'], [150000, 17220, 'en-US'],
  ])
  expect(new Set(calls.map((call) => call[4])).size).toBe(6)
  expect(audio.windows?.map(({ startMs, durationMs }) => [startMs, durationMs])).toEqual([
    [0, 30000], [30000, 30000], [60000, 30000], [90000, 30000], [120000, 30000], [150000, 17220],
  ])
  expect(audio.transcript).not.toContain('diagnostic reference')
  expect(audio.status).toBe('complete')
})

test('runs the installed-only analyzer experiment on every actual source window', async () => {
  const experimental = jest.fn(async () => ({ transcript: 'Actual installed analyzer speech.' }))
  nativeCapture!.transcribeWindowWithBackend = experimental
  const audio = { ...audioRun(167220), bundled: true, speechBackend: 'analyzer-if-installed' as const }
  try {
    await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).resolves.toBe(Array(6).fill('Actual installed analyzer speech.').join(' '))
    expect(experimental).toHaveBeenCalledTimes(6)
    expect(experimental.mock.calls[0]).toEqual([audio.uri, 0, 30000, 'en-US', expect.any(String), 'analyzer-if-installed'])
    expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
    expect(audio.windows?.at(-1)).toMatchObject({ startMs: 150000, durationMs: 17220 })
  } finally {
    delete nativeCapture!.transcribeWindowWithBackend
  }
})

test('does not pretend that an old native binary ran the analyzer experiment', async () => {
  const audio = { ...audioRun(), speechBackend: 'analyzer-if-installed' as const }
  await expect(transcribeBenchmarkAudio(audio, new AbortController().signal)).rejects.toThrow(/backend.*unavailable/i)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(audio.status).toBe('failed')
})
