import {
  transcribeImportedAudio,
  readImportCheckpoint,
} from './importTranscription'
import * as settings from '../data/settingsRepository'
import { nativeCapture } from './nativeCapture'

jest.mock('../data/settingsRepository', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))
jest.mock('./nativeCapture', () => ({
  nativeCapture: {
    transcribeWindow: jest.fn(),
    cancelTranscription: jest.fn(),
  },
}))
const storage = jest.mocked(settings)
const native = jest.mocked(nativeCapture!)
beforeEach(() => {
  jest.clearAllMocks()
  storage.getSetting.mockResolvedValue(null)
  storage.setSetting.mockResolvedValue()
  native.transcribeWindow.mockResolvedValue('Recognized text')
})
test('resumes a complete ordered window prefix and processes the full remaining source', async () => {
  storage.getSetting.mockResolvedValue(
    JSON.stringify({
      version: 1,
      uri: 'file:///import.m4a',
      durationMs: 130000,
      language: 'en',
      windows: [{ startMs: 0, durationMs: 60000, transcript: 'First part.' }],
    }),
  )
  const text = await transcribeImportedAudio(
    'file:///import.m4a',
    130000,
    'en',
    { signal: new AbortController().signal },
  )
  expect(
    native.transcribeWindow.mock.calls.map((call) => call.slice(1, 4)),
  ).toEqual([
    [60000, 60000, 'en-US'],
    [120000, 10000, 'en-US'],
  ])
  expect(text).toBe('First part. Recognized text Recognized text')
  expect(
    JSON.parse(storage.setSetting.mock.calls.at(-1)![1]).windows,
  ).toHaveLength(3)
})
test.each([
  null,
  { windows: [null] },
  {
    windows: [
      { startMs: 60000, durationMs: 60000, transcript: 'Missing first' },
    ],
  },
])(
  'rejects malformed checkpoint %s without fabricating covered audio',
  async (bad) => {
    storage.getSetting.mockResolvedValue(
      JSON.stringify(
        bad === null
          ? null
          : {
              version: 1,
              uri: 'file:///a.wav',
              durationMs: 120000,
              language: 'pl',
              ...bad,
            },
      ),
    )
    await expect(
      readImportCheckpoint('file:///a.wav', 120000, 'pl'),
    ).rejects.toThrow()
  },
)
test('cancellation does not publish a late transcript or advance its checkpoint', async () => {
  const controller = new AbortController()
  native.transcribeWindow.mockImplementationOnce(async () => {
    controller.abort()
    return 'Late result'
  })
  await expect(
    transcribeImportedAudio('file:///a.wav', 120000, 'pl', {
      signal: controller.signal,
    }),
  ).rejects.toThrow('cancelled')
  expect(storage.setSetting).not.toHaveBeenCalled()
  expect(native.cancelTranscription).toHaveBeenCalled()
})

const longCaptures = [
  { language: 'pl' as const, durationMs: 1800000 },
  { language: 'en' as const, durationMs: 1800000 },
  { language: 'pl' as const, durationMs: 1781630 },
  { language: 'en' as const, durationMs: 1781630 },
]
const completeWindows = (durationMs: number) =>
  Array.from({ length: 30 }, (_, index) => ({
    startMs: index * 60000,
    durationMs: Math.min(60000, durationMs - index * 60000),
    transcript: `Completed window ${index + 1}.`,
  }))

test.each(longCaptures)(
  'rejects an appended zero-length EOF window before publishing text or progress: $language/$durationMs',
  async ({ language, durationMs }) => {
    const uri = 'file:///long-capture.wav'
    storage.getSetting.mockResolvedValue(
      JSON.stringify({
        version: 1,
        uri,
        durationMs,
        language,
        windows: [
          ...completeWindows(durationMs),
          {
            startMs: durationMs,
            durationMs: 0,
            transcript: 'Fabricated text beyond EOF.',
          },
        ],
      }),
    )
    const onProgress = jest.fn()
    await expect(
      transcribeImportedAudio(uri, durationMs, language, {
        signal: new AbortController().signal,
        onProgress,
      }),
    ).rejects.toThrow('Missing or malformed transcription window')
    expect(onProgress).not.toHaveBeenCalled()
    expect(native.transcribeWindow).not.toHaveBeenCalled()
    expect(storage.setSetting).not.toHaveBeenCalled()
  },
)

test.each(longCaptures)(
  'reuses a complete thirty-window checkpoint with its exact positive EOF tail: $language/$durationMs',
  async ({ language, durationMs }) => {
    const uri = 'file:///long-capture.wav'
    const windows = completeWindows(durationMs)
    storage.getSetting.mockResolvedValue(
      JSON.stringify({ version: 1, uri, durationMs, language, windows }),
    )
    const onProgress = jest.fn()
    const text = await transcribeImportedAudio(uri, durationMs, language, {
      signal: new AbortController().signal,
      onProgress,
    })
    expect(windows.at(-1)?.durationMs).toBe(
      durationMs === 1800000 ? 60000 : 41630,
    )
    expect(text).toBe(windows.map((window) => window.transcript).join(' '))
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(text, 30, 30)
    expect(native.transcribeWindow).not.toHaveBeenCalled()
    expect(storage.setSetting).not.toHaveBeenCalled()
  },
)

test('a silent window is empty speech and the import continues', async () => {
  native.transcribeWindow
    .mockResolvedValueOnce('Pierwsza część')
    .mockResolvedValueOnce('Druga część')
    .mockRejectedValueOnce(new Error('No speech detected'))
  const text = await transcribeImportedAudio('file:///import.m4a', 150000, 'pl', { signal: new AbortController().signal })
  expect(text).toBe('Pierwsza część Druga część')
  expect(JSON.parse(storage.setSetting.mock.calls.at(-1)![1]).windows).toHaveLength(3)
})

test('other window failures still stop the import', async () => {
  native.transcribeWindow.mockRejectedValueOnce(new Error('On-device speech for this language is unavailable'))
  await expect(transcribeImportedAudio('file:///import.m4a', 30000, 'pl', { signal: new AbortController().signal }))
    .rejects.toThrow('unavailable')
})
