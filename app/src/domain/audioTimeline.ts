import type { SummarySourceRange } from './summary'

// A stretch of transcript characters and the audio milliseconds it was spoken in.
export interface AudioSpan {
  readonly start: number
  readonly end: number
  readonly startMs: number
  readonly endMs: number
}

// What the recorder measured: loudness per fixed window and, when the
// recognizer exposed it, where each part of the transcript sits in the audio.
export interface AudioTimeline {
  readonly version: 1
  readonly levelMs: number
  // 0..100, RMS loudness on a dBFS scale (see levelFromRms).
  readonly levels: readonly number[]
  // The transcript the spans index into; spans are dropped once it changes.
  readonly source: string
  // 'words': recognizer word timestamps; 'utterances': recognizer session
  // boundaries plus the moment each final result arrived.
  readonly timing: 'words' | 'utterances'
  readonly spans: readonly AudioSpan[]
}

export const MAX_TIMELINE_LEVELS = 3000
const MIN_LEVEL_MS = 100
const FLOOR_DB = -60

/** Window length that keeps a recording of this length under the level cap. */
export const levelWindowMs = (durationMs: number): number => {
  const needed = Math.ceil(Math.max(0, durationMs) / MAX_TIMELINE_LEVELS / MIN_LEVEL_MS) * MIN_LEVEL_MS
  return Math.max(MIN_LEVEL_MS, needed)
}

/** RMS of 16-bit samples (0..1) mapped onto 0..100 over -60..0 dBFS. */
export const levelFromRms = (rms: number): number => {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  const db = 20 * Math.log10(Math.min(1, rms))
  return Math.round(Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) * 100)
}

// Streaming accumulator: feed PCM chunks, read one level per window.
export class LevelAccumulator {
  private readonly windowSamples: number
  private readonly stride: number
  private sum = 0
  private count = 0
  private seen = 0
  readonly levels: number[] = []

  constructor(sampleRate: number, levelMs: number, stride = 4) {
    this.windowSamples = Math.max(1, Math.round((sampleRate * levelMs) / 1000))
    this.stride = Math.max(1, stride)
  }

  push(samples: Int16Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      // Every sample counts toward the window; only every stride-th is measured.
      if (this.seen % this.stride === 0) {
        const value = samples[i]! / 32768
        this.sum += value * value
        this.count += 1
      }
      this.seen += 1
      if (this.seen === this.windowSamples) this.flushWindow()
    }
  }

  finish(): number[] {
    if (this.seen > 0) this.flushWindow()
    return this.levels
  }

  private flushWindow(): void {
    this.levels.push(levelFromRms(this.count > 0 ? Math.sqrt(this.sum / this.count) : 0))
    this.sum = 0
    this.count = 0
    this.seen = 0
  }
}

/** Collapse levels into a fixed number of bars, keeping each group's peak. */
export const barsFromLevels = (levels: readonly number[], bars: number): number[] => {
  if (bars <= 0 || levels.length === 0) return []
  const out: number[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * levels.length) / bars)
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / bars))
    let peak = 0
    for (let i = from; i < Math.min(to, levels.length); i += 1) peak = Math.max(peak, levels[i]!)
    out.push(peak)
  }
  return out
}

/** Bar heights 0..1 relative to this recording's own quiet floor and peak. */
export const relativeBarHeights = (bars: readonly number[]): number[] => {
  if (bars.length === 0) return []
  const sorted = [...bars].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]!
  const peak = sorted[sorted.length - 1]!
  if (peak - floor < 1) return bars.map(() => 0)
  return bars.map(value => Math.max(0, Math.min(1, (value - floor) / (peak - floor))))
}

// One final recognition result inside one recognizer session.
export interface RecognizedUtterance {
  readonly session: number
  readonly text: string
  // Milliseconds after the session started when the result arrived.
  readonly arrivedMs: number | null
  readonly words: readonly { readonly text: string; readonly startMs: number }[]
}

export interface RecordedPart {
  readonly session: number
  readonly durationMs: number
}

const findWords = (
  transcript: string,
  from: number,
  to: number,
  words: RecognizedUtterance['words'],
): { start: number; end: number; startMs: number }[] | null => {
  const found: { start: number; end: number; startMs: number }[] = []
  let cursor = from
  for (const word of words) {
    const text = word.text.trim()
    if (text.length === 0) continue
    const at = transcript.indexOf(text, cursor)
    if (at < 0 || at + text.length > to) return null
    found.push({ start: at, end: at + text.length, startMs: word.startMs })
    cursor = at + text.length
  }
  return found.length > 0 ? found : null
}

/**
 * Join utterances the way the recorder joins its transcript and place each in
 * the concatenated audio. Utterances whose session left no audio are skipped.
 */
export const buildAudioSpans = (
  utterances: readonly RecognizedUtterance[],
  parts: readonly RecordedPart[],
): { transcript: string; spans: AudioSpan[]; timing: AudioTimeline['timing'] } => {
  const offsets = new Map<number, { offsetMs: number; durationMs: number }>()
  let offset = 0
  for (const part of parts) {
    if (!offsets.has(part.session)) offsets.set(part.session, { offsetMs: offset, durationMs: part.durationMs })
    offset += part.durationMs
  }

  let transcript = ''
  const spans: AudioSpan[] = []
  let allWords = true
  const sessionCursor = new Map<number, number>()
  utterances.forEach((utterance, index) => {
    const text = utterance.text.trim()
    if (text.length === 0) return
    if (transcript.length > 0) transcript += ' '
    const start = transcript.length
    transcript += text
    const end = transcript.length
    const part = offsets.get(utterance.session)
    if (!part) return

    const sessionStart = sessionCursor.get(utterance.session) ?? 0
    const arrived = utterance.arrivedMs === null ? part.durationMs : Math.min(part.durationMs, Math.max(0, utterance.arrivedMs))
    const next = utterances.slice(index + 1).find(other => other.session === utterance.session && other.text.trim().length > 0)
    const words = findWords(transcript, start, end, utterance.words)
    if (words && words.every(word => word.startMs >= 0 && word.startMs <= part.durationMs)) {
      // The last word has no end of its own; the result arriving bounds it.
      const nextStart = next?.words[0]?.startMs
      const lastEnd = Math.max(words[words.length - 1]!.startMs + 1, Math.min(arrived, nextStart ?? arrived))
      words.forEach((word, wordIndex) => {
        const following = words[wordIndex + 1]
        const endMs = following ? Math.max(word.startMs + 1, following.startMs) : lastEnd
        spans.push({ start: word.start, end: word.end, startMs: part.offsetMs + word.startMs, endMs: part.offsetMs + endMs })
      })
      sessionCursor.set(utterance.session, lastEnd)
      return
    }
    allWords = false
    const startMs = Math.min(sessionStart, arrived)
    const endMs = Math.max(startMs + 1, arrived)
    spans.push({ start, end, startMs: part.offsetMs + startMs, endMs: part.offsetMs + endMs })
    sessionCursor.set(utterance.session, endMs)
  })
  return { transcript, spans, timing: allWords && spans.length > 0 ? 'words' : 'utterances' }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Levels survive edits; spans only while the transcript is the one they index. */
export const parseAudioTimeline = (value: unknown, content: string): AudioTimeline | null => {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }
  if (!isRecord(candidate) || candidate.version !== 1 || !isCount(candidate.levelMs) || candidate.levelMs === 0 ||
    !Array.isArray(candidate.levels) || candidate.levels.length === 0 || candidate.levels.length > MAX_TIMELINE_LEVELS ||
    (candidate.timing !== 'words' && candidate.timing !== 'utterances') || typeof candidate.source !== 'string' ||
    !Array.isArray(candidate.spans)) return null
  const levels: number[] = []
  for (const level of candidate.levels as readonly unknown[]) {
    if (!isCount(level) || level > 100) return null
    levels.push(level)
  }
  const spans: AudioSpan[] = []
  if (candidate.source === content) {
    for (const span of candidate.spans as readonly unknown[]) {
      if (!isRecord(span) || !isCount(span.start) || !isCount(span.end) || !isCount(span.startMs) ||
        !isCount(span.endMs) || span.start >= span.end || span.end > content.length || span.startMs >= span.endMs) return null
      spans.push({ start: span.start, end: span.end, startMs: span.startMs, endMs: span.endMs })
    }
  }
  return { version: 1, levelMs: candidate.levelMs, levels, source: content, timing: candidate.timing, spans }
}

/** Audio window covered by these transcript ranges, or null when untimed. */
export const timeForRanges = (
  spans: readonly AudioSpan[],
  ranges: readonly SummarySourceRange[],
): { startMs: number; endMs: number } | null => {
  let startMs = Infinity
  let endMs = -Infinity
  for (const span of spans) {
    if (!ranges.some(range => span.start < range.end && range.start < span.end)) continue
    startMs = Math.min(startMs, span.startMs)
    endMs = Math.max(endMs, span.endMs)
  }
  return Number.isFinite(startMs) ? { startMs, endMs } : null
}
