import type { Language } from '../i18n/language'

export const MAX_AUDIO_DURATION_MS = 30 * 60 * 1000
export const CAPTURE_SAMPLE_RATE = 16000

export interface CaptureSegment {
  key: string
  frames: number
}
export interface CaptureGap {
  atFrame: number
  reason: string
  startedAt: number
  endedAt?: number
}
export interface CaptureManifest {
  version: 1
  sessionId: string
  language: Language
  state: 'recording' | 'interrupted' | 'stopped' | 'recovered' | 'error'
  sampleRate: number
  channels: number
  bitsPerSample: number
  frames: number
  segments: CaptureSegment[]
  gaps: CaptureGap[]
  needsTranscription: boolean
  startedAt: number
  error?: string
  transcriptionRecoveryIssue?: string
  materializedNoteId?: string
}

const fail = (): never => {
  throw new Error('Invalid capture manifest; source audio has been retained.')
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail()
const frames = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail()

// Every referenced segment is required. A broken journal must not turn into a
// plausible shorter recording by filtering out the parts we cannot read.
export const validateCaptureManifest = (raw: unknown): CaptureManifest => {
  const value = object(raw)
  if (
    value.version !== 1 ||
    typeof value.sessionId !== 'string' ||
    !/^capture-[a-zA-Z0-9-]+$/.test(value.sessionId) ||
    (value.language !== 'pl' && value.language !== 'en') ||
    value.sampleRate !== CAPTURE_SAMPLE_RATE ||
    value.channels !== 1 ||
    value.bitsPerSample !== 16 ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.gaps) ||
    typeof value.needsTranscription !== 'boolean' ||
    typeof value.startedAt !== 'number' ||
    !Number.isFinite(value.startedAt) ||
    !['recording', 'interrupted', 'stopped', 'recovered', 'error'].includes(
      String(value.state),
    )
  )
    fail()
  const total = frames(value.frames)
  if (total > (CAPTURE_SAMPLE_RATE * MAX_AUDIO_DURATION_MS) / 1000) fail()
  let sum = 0
  const segments = (value.segments as unknown[]).map((rawSegment, index) => {
    const segment = object(rawSegment)
    if (segment.key !== `${index.toString().padStart(6, '0')}.wav`) fail()
    const count = frames(segment.frames)
    if (count === 0) fail()
    sum += count
    return { key: segment.key as string, frames: count }
  })
  if (sum !== total) fail()
  const gaps = (value.gaps as unknown[]).map((rawGap) => {
    const gap = object(rawGap)
    if (
      typeof gap.reason !== 'string' ||
      typeof gap.startedAt !== 'number' ||
      !Number.isFinite(gap.startedAt) ||
      frames(gap.atFrame) > total ||
      (gap.endedAt !== undefined &&
        (typeof gap.endedAt !== 'number' ||
          !Number.isFinite(gap.endedAt) ||
          gap.endedAt < gap.startedAt))
    )
      fail()
    return gap as unknown as CaptureGap
  })
  return { ...(value as unknown as CaptureManifest), segments, gaps }
}

export const validateImportDuration = (durationMs: number): number => {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('invalid-audio-duration')
  if (durationMs > MAX_AUDIO_DURATION_MS)
    throw new Error('audio-duration-limit')
  return durationMs
}
