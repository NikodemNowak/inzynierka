import {
  validateCaptureManifest,
  MAX_AUDIO_DURATION_MS,
  validateImportDuration,
} from './captureManifest'

const manifest = () => ({
  version: 1,
  sessionId: 'capture-123',
  language: 'en',
  state: 'stopped',
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  frames: 32000,
  segments: [
    { key: '000000.wav', frames: 16000 },
    { key: '000001.wav', frames: 16000 },
  ],
  gaps: [],
  needsTranscription: true,
  startedAt: 1000,
})

test('validates ordered native audio and keeps its partial transcription provenance', () => {
  expect(validateCaptureManifest(manifest()).needsTranscription).toBe(true)
})
test('rejects missing, duplicated or malformed segment references instead of dropping them', () => {
  expect(() =>
    validateCaptureManifest({
      ...manifest(),
      segments: [{ key: '000001.wav', frames: 32000 }],
    }),
  ).toThrow()
  expect(() =>
    validateCaptureManifest({
      ...manifest(),
      segments: [manifest().segments[0], manifest().segments[0]],
    }),
  ).toThrow()
  expect(() =>
    validateCaptureManifest({
      ...manifest(),
      segments: [{ key: '../private.wav', frames: 32000 }],
    }),
  ).toThrow()
  expect(() =>
    validateCaptureManifest({ ...manifest(), frames: 31999 }),
  ).toThrow()
})
test('checks the native thirty minute frame ceiling', () => {
  expect(() =>
    validateCaptureManifest({ ...manifest(), frames: 16000 * 1800 + 1 }),
  ).toThrow()
  expect(MAX_AUDIO_DURATION_MS).toBe(1800000)
})
test('rejects unknown, empty and over-limit imports before private copying', () => {
  for (const duration of [NaN, Infinity, -1, 0, MAX_AUDIO_DURATION_MS + 1])
    expect(() => validateImportDuration(duration)).toThrow()
  expect(validateImportDuration(MAX_AUDIO_DURATION_MS)).toBe(
    MAX_AUDIO_DURATION_MS,
  )
})
