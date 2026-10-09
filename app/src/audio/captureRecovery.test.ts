import { finalizeCapture } from './captureRecovery'
import { concatWavFiles } from './wavConcat'
import type { CaptureSnapshot } from '../stt/nativeCapture'

jest.mock('../stt/nativeCapture', () => ({ nativeCapture: null }))
jest.mock('./wavConcat', () => ({ concatWavFiles: jest.fn() }))

const snapshot = (): CaptureSnapshot => ({
  manifest: {
    version: 1, sessionId: 'capture-test', language: 'pl', state: 'stopped',
    sampleRate: 16000, channels: 1, bitsPerSample: 16,
    frames: 419035, segments: [{ key: '000000.wav', frames: 419035 }],
    gaps: [], needsTranscription: true, startedAt: 1000,
  },
  directory: 'file:///capture/', cursor: 1, volumeLevel: 0,
  finalTranscript: 'Testy aplikacji', interimTranscript: '',
})

beforeEach(() => {
  jest.mocked(concatWavFiles).mockReset().mockResolvedValue({
    uri: 'file:///capture/000000.wav', durationMs: 26190,
  })
})

test('offers whole-audio transcription after a clean stop without certifying provisional text', async () => {
  const result = await finalizeCapture(snapshot())
  expect(result).toEqual(expect.objectContaining({
    autoTranscribeAudio: true, needsTranscription: true,
    transcript: 'Testy aplikacji', audioUri: 'file:///capture/000000.wav',
  }))
})

test.each(['interrupted', 'recovered'] as const)('keeps %s sessions available for manual recovery', async (state) => {
  const source = snapshot()
  source.manifest.state = state
  expect(await finalizeCapture(source)).not.toEqual(expect.objectContaining({ autoTranscribeAudio: true }))
})

test('does not automatically hide microphone gaps or journal errors', async () => {
  const gap = snapshot()
  gap.manifest.gaps = [{ atFrame: 16000, reason: 'interruption', startedAt: 2000 }]
  const error = snapshot()
  error.manifest.error = 'Capture interrupted'
  for (const source of [gap, error])
    expect(await finalizeCapture(source)).not.toEqual(expect.objectContaining({ autoTranscribeAudio: true }))
})

test('does not repeat transcription of a certified capture', async () => {
  const source = snapshot()
  source.manifest.needsTranscription = false
  expect(await finalizeCapture(source)).not.toEqual(expect.objectContaining({ autoTranscribeAudio: true }))
})

test('keeps a damaged transcript checkpoint available for explicit recovery', async () => {
  const source = snapshot()
  source.manifest.transcriptionRecoveryIssue = 'Transcript checkpoint is missing'
  expect(await finalizeCapture(source)).not.toEqual(expect.objectContaining({ autoTranscribeAudio: true }))
})

test('retains the audio-length check before offering automatic continuation', async () => {
  jest.mocked(concatWavFiles).mockResolvedValueOnce({ uri: 'file:///capture/000000.wav', durationMs: 1200 })
  await expect(finalizeCapture(snapshot())).rejects.toThrow('does not match audio length')
})
