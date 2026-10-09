import { LETTER_FADE_MS, LETTER_BLUE_HOLD_MS, LETTER_COLOR_FADE_MS, LETTER_COLOR_SETTLE_MS, getTranscriptLetterAlpha } from '../stt/liveTranscriptAnimation'

export interface NativeTextLine {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly ascender: number
  readonly descender: number
}
export interface RasterLine {
  readonly text: string
  readonly x: number
  readonly baseline: number
  readonly y: number
  readonly height: number
  readonly width: number
  readonly xPositions?: readonly number[]
}
export interface RevealLayout {
  readonly source: string
  readonly width: number
  readonly height: number
  readonly totalHeight: number
  readonly measuredLines: number
  readonly lines: readonly RasterLine[]
}
export const skeletonLineCount = (lines: number): number =>
  Number.isFinite(lines) ? Math.max(1, Math.min(6, Math.floor(lines))) : 3

// Neutral word shapes are decorative, never note content or accessibility copy.
// Keep ordinary word lengths and spaces beneath the unreadable blur.
const skeletonWords = ['numiraveno', 'li', 'veluma', 'renovila', 'muneravi', 'no', 'limurena', 'venumira', 'lori', 'naverumi', 'ri', 'meluniva'] as const
export const skeletonRowWidth = (width: number, row: number): number => width * [1, 0.86, 0.68, 0.95, 0.78, 0.61][row % 6]
export const skeletonTextRows = (lines: number, title: boolean, width = 300, fontSize = title ? 28 : 16): readonly string[] => {
  return Object.freeze(Array.from({ length: skeletonLineCount(lines) }, (_, row) => {
    const count = Math.max(12, Math.min(96, Math.ceil(skeletonRowWidth(width, row) / Math.max(8, fontSize * 0.46))))
    let text = ''
    for (let index = 0; index < count; index++) {
      const word = skeletonWords[(row * 5 + index * 7) % skeletonWords.length]
      const next = `${text}${text ? ' ' : ''}${word}`
      if (text && next.length > count) break
      text = next
    }
    return text
  }))
}
// SVG x arrays are wired through react-native-svg's extractLengthList into
// native TSpan. Its public textLength prop is currently dropped by extraction.
export const skeletonGlyphPositions = (text: string, width: number, fontSize: number): readonly number[] => {
  const weight = (letter: string) => letter === ' ' ? 0.9 : /[il]/u.test(letter) ? 0.24 : /[r]/u.test(letter) ? 0.34 : /[mw]/u.test(letter) ? 0.83 : 0.55
  const advances = [...text].slice(0, -1).map(weight)
  const total = advances.reduce((sum, value) => sum + value, 0)
  const span = Math.max(0, width - fontSize * 0.58)
  let offset = 0
  return Object.freeze([0, ...advances.map(advance => { offset += advance; return total ? offset / total * span : 0 })])
}

export const motionPalette = (dark: boolean, accent?: string): readonly [string, string, string] =>
  dark ? ['#A39CE8', accent ?? '#80B9F2', '#C4BEF2'] : ['#8273CE', accent ?? '#286BC2', '#AAA3DB']

// Reuse the live dictation's fresh-ink lifetime. Ages belong to positions along
// the moving reveal, so early letters settle while later letters are still blue.
export const focusMorphDuration = 320
export const focusRevealTiming = (row: number, layout: RevealLayout, morph = false) => {
  const reveal = lineRevealTiming(row, layout)
  const preparation = morph ? focusMorphDuration : 0
  const duration = Math.min(4200, reveal.duration + LETTER_COLOR_SETTLE_MS + preparation)
  const sweep = duration - LETTER_COLOR_SETTLE_MS - preparation
  return {
    start: (preparation + reveal.start * sweep) / duration,
    end: (preparation + reveal.end * sweep) / duration,
    hold: (preparation + reveal.end * sweep + LETTER_BLUE_HOLD_MS) / duration,
    settled: (preparation + reveal.end * sweep + LETTER_COLOR_SETTLE_MS) / duration,
    duration,
  }
}

export interface FocusInkBand {
  readonly fromAge: number
  readonly toAge: number
  readonly opacity: number
}

// Stationary native Text is clipped by a small stack of moving age windows.
// This samples dictation's letter fade/color trail without per-glyph views or
// JS frame updates. Composited layers sum to full blue for fresh readable ink.
export const focusInkBands = (lineCount: number): readonly FocusInkBand[] => {
  const rows = Math.max(1, Math.min(32, lineCount))
  const freshSteps = rows <= 4 ? 4 : 2
  const fadeSteps = Math.max(2, Math.min(8, Math.floor(128 / rows) - freshSteps))
  const trail = Array.from({ length: fadeSteps }, (_, index) => ({
    fromAge: LETTER_BLUE_HOLD_MS,
    toAge: LETTER_BLUE_HOLD_MS + LETTER_COLOR_FADE_MS * (fadeSteps - index) / fadeSteps,
    opacity: 1 / (fadeSteps - index),
  }))
  let previousAlpha = 0
  const fresh = Array.from({ length: freshSteps }, (_, index) => {
    const fromAge = LETTER_FADE_MS * index / (freshSteps - 1)
    const alpha = getTranscriptLetterAlpha({ index: 0, character: '', startedAt: 0 }, fromAge)
    const opacity = (alpha - previousAlpha) / (1 - previousAlpha)
    previousAlpha = alpha
    return { fromAge, toAge: LETTER_BLUE_HOLD_MS, opacity }
  })
  return Object.freeze([...trail, ...fresh].map(band => Object.freeze(band)))
}

export const textRevealEligible = (text: string): boolean => {
  let count = 0
  for (const _character of text) if (++count > 1200) return false
  return count > 0
}

// onTextLayout is authoritative. SVG paints soft words within measured ink bounds;
// the complete React Native Text remains the layout/accessibility owner.
export const buildRevealLayout = (source: string, input: readonly NativeTextLine[], width: number): RevealLayout | null => {
  if (!textRevealEligible(source) || !Number.isFinite(width) || width <= 0 || width > 600 || input.length === 0 || input.length > 32) return null
  if (input.map(line => line.text).join('').replace(/[\r\n]/gu, '') !== source.replace(/[\r\n]/gu, '')) return null
  const lines: RasterLine[] = []
  let height = 0
  for (const line of input) {
    if (![line.x, line.y, line.width, line.height, line.ascender, line.descender].every(Number.isFinite) ||
      line.x < 0 || line.y < 0 || line.width < 0 || line.x + line.width > width + 2 || line.height <= 0 || line.height > 80 ||
      line.ascender < 0 || line.ascender > line.height || line.descender < 0 || line.y < (lines.at(-1)?.y ?? 0)) return null
    height = Math.max(height, line.y + line.height)
    lines.push(Object.freeze({ text: line.text.replace(/[\r\n]/gu, ''), x: line.x, y: line.y, baseline: line.y + line.ascender, height: line.height, width: line.width }))
  }
  if (height > 360) return null
  return Object.freeze({ source, width, height, totalHeight: height, measuredLines: input.length, lines: Object.freeze(lines) })
}

export interface WordRevealProbe {
  readonly key: string
  readonly row: number
  readonly text: string
  readonly expectedWidth?: number
}
interface WordRevealFragment {
  readonly key: string
  readonly row: number
  readonly text: string
  readonly order: number
  readonly before: string | null
  readonly through: string
  readonly y: number
  readonly height: number
  readonly x: number
  readonly baseline: number
}
export interface WordRevealPlan {
  readonly width: number
  readonly words: readonly WordRevealFragment[]
  readonly probes: readonly WordRevealProbe[]
  readonly count: number
}
export interface WordRevealRect extends WordRevealFragment {
  readonly left: number
  readonly width: number
  readonly inkLeft: number
  readonly inkWidth: number
  readonly baseline: number
}

// Prefixes are measured by native Text with the same typography, once. No
// character-width estimates, word reflow, or JS work during the native clock.
export const buildWordRevealPlan = (layout: RevealLayout): WordRevealPlan | null => {
  if (/[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(layout.source)) return null
  const words: WordRevealFragment[] = []
  const probes = new Map<string, WordRevealProbe>()
  let cursor = 0, count = 0, previousEnd = -1, previousOrder = -1
  for (const [row, line] of layout.lines.entries()) {
    while (/[\r\n]/u.test(layout.source[cursor] ?? '') && cursor < layout.source.length) cursor++
    if (layout.source.slice(cursor, cursor + line.text.length) !== line.text) return null
    const probe = (end: number, expectedWidth?: number): string | null => {
      if (end === 0) return null
      const key = `${row}-${end}`
      probes.set(key, Object.freeze({ key, row, text: line.text.slice(0, end), expectedWidth }))
      return key
    }
    for (const match of line.text.matchAll(/\S+/gu)) {
      const start = match.index, end = start + match[0].length
      const absoluteStart = cursor + start
      const order = absoluteStart === previousEnd ? previousOrder : count++
      words.push(Object.freeze({ key: `${row}-${start}`, row, text: match[0], order, before: probe(start), through: probe(end)!, x: line.x, y: line.y, height: line.height, baseline: line.baseline }))
      previousEnd = cursor + end; previousOrder = order
      if (count > 96 || words.length > 104) return null
    }
    probe(line.text.length, line.width)
    cursor += line.text.length
  }
  return count > 0 && probes.size <= 208 ? Object.freeze({ width: layout.width, words: Object.freeze(words), probes: Object.freeze([...probes.values()]), count }) : null
}

export const buildWordRevealRects = (plan: WordRevealPlan, measured: Readonly<Record<string, number>>): readonly WordRevealRect[] | null => {
  for (const probe of plan.probes) {
    const width = measured[probe.key]
    if (!Number.isFinite(width) || width < 0 || width > plan.width + 2 || probe.expectedWidth !== undefined && Math.abs(width - probe.expectedWidth) > 1.5) return null
  }
  const rects: WordRevealRect[] = []
  for (let index = 0; index < plan.words.length; index++) {
    const word = plan.words[index], previous = plan.words[index - 1], next = plan.words[index + 1]
    const start = word.before ? measured[word.before] : 0, end = measured[word.through]
    if (end <= start || previous?.row === word.row && start < measured[previous.through] - 1.5) return null
    const left = previous?.row === word.row ? word.x + (measured[previous.through] + start) / 2 : 0
    const right = next?.row === word.row ? word.x + (end + (next.before ? measured[next.before] : 0)) / 2 : plan.width
    if (right <= left) return null
    rects.push(Object.freeze({ ...word, left, width: right - left, inkLeft: word.x + start, inkWidth: end - start }))
  }
  return Object.freeze(rects)
}

export const wordRevealTiming = (order: number, count: number): { start: number; end: number; duration: number } => {
  const duration = Math.min(1800, 900 + Math.max(0, count - 2) * 20)
  const focus = count === 1 ? 1 : 0.38
  const start = count <= 1 ? 0 : order / (count - 1) * (1 - focus)
  return { start, end: order === count - 1 ? 1 : start + focus, duration }
}

// A continuous native clipping edge crosses the original glyphs. Rows finish
// in reading order; no approximate character widths or rebuilt strings.
export const lineRevealTiming = (row: number, layout: RevealLayout): { start: number; end: number; duration: number } => {
  const weights = layout.lines.map(line => Array.from(line.text.trim()).length)
  const total = Math.max(1, weights.reduce((sum, count) => sum + count, 0))
  const before = weights.slice(0, row).reduce((sum, count) => sum + count, 0)
  return { start: before / total, end: (before + (weights[row] ?? 0)) / total, duration: Math.min(4200, Math.max(650, total * 18 + 240)) }
}

export interface RasterTypography {
  readonly fontSize: number
  readonly fontWeight: string
  readonly fontFamily?: string
  readonly letterSpacing: number
}
export const rasterPadding = 8

// A smooth alpha envelope reaches zero at the paint frame, before its SVG or
// native view can cut the blur. Both axes have eased shoulders, even when narrow.
export const softInkEdgeStops = (length: number, fontSize: number, vertical = false): readonly { offset: number; opacity: number }[] => {
  const size = Number.isFinite(length) && length > 0 ? length : 1
  const font = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16
  const edge = Math.min(0.48, Math.max(vertical ? 4 : 8, Math.min(vertical ? 16 : 36, font * (vertical ? 0.32 : 0.8))) / size)
  return Object.freeze([[0, 0], [edge * 0.22, 0.08], [edge * 0.55, 0.5], [edge, 1], [1 - edge, 1], [1 - edge * 0.55, 0.5], [1 - edge * 0.22, 0.08], [1, 0]]
    .map(([offset, opacity]) => Object.freeze({ offset, opacity })))
}

export const waitingInkPeriod = 1900
export const waitingInkKeyframes = (row = 0): { inputRange: number[]; outputRange: number[] } => ({
  inputRange: [0, 0.35, 0.7, 1],
  outputRange: row % 3 === 0 ? [0.76, 0.95, 0.84, 0.76] : row % 3 === 1 ? [0.76, 0.84, 0.95, 0.76] : [0.76, 0.8, 0.91, 0.76],
})

export interface SoftWord {
  readonly text: string
  readonly x: number
  readonly width: number
  readonly y: number
  readonly height: number
  readonly baseline: number
  readonly xPositions?: readonly number[]
}

// Horizontal detail is softened more than line height. Native SVG implements
// unequal axes with motion blur; its optical result still needs an iOS check.
export const softTextBlur = (fontSize: number): readonly [number, number] =>
  [Math.max(2.5, Math.min(12, fontSize * 0.3)), Math.max(1.8, Math.min(8, fontSize * 0.18))]

// A single glyph survives a word-width mask. Tiny islands use one neutral
// printed sample fitted to the same bounds, never the short source identity.
export const tinyWordSample = 'na'
export const softWordIsTiny = (word: SoftWord, fontSize: number): boolean =>
  [...word.text.replace(/[^\p{L}\p{N}]/gu, '')].length <= 2 || word.width <= fontSize * 0.65
export const tinyWordScale = (word: SoftWord, fontSize: number): number => word.width / (fontSize * 1.1)
export const tinyTextBlur = (fontSize: number): readonly [number, number] =>
  [Math.max(1.5, Math.min(10.5, fontSize * 0.34)), Math.max(1, Math.min(8.5, fontSize * 0.2))]

export const buildSoftWords = (words: readonly WordRevealRect[], fontSize = 16): readonly SoftWord[] => Object.freeze(words.slice(0, 104)
  .filter(word => [word.inkLeft, word.inkWidth, word.y, word.height, word.baseline].every(Number.isFinite) && word.inkLeft >= 0 && word.inkWidth > 0 && word.y >= 0 && word.height > 0)
  .map((word, index) => {
    // Geometry comes from the result, but its literal letters never enter the
    // blurred bitmap. Anonymous ink can safely precede the actual reveal.
    const count = Math.max(3, Math.min(72, Math.ceil(word.inkWidth / Math.max(4, fontSize * 0.5))))
    const seed = skeletonWords[index % skeletonWords.length]
    const text = seed.repeat(Math.ceil(count / seed.length)).slice(0, count)
    return Object.freeze({ text, x: word.inkLeft, width: word.inkWidth, y: word.y, height: word.height, baseline: word.baseline,
      xPositions: Object.freeze(skeletonGlyphPositions(text, word.inkWidth, fontSize).map(position => position + word.inkLeft)) })
  }))

export const skeletonSoftWords = (lines: readonly RasterLine[], fontSize: number): readonly SoftWord[] => {
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 48) return []
  const words: SoftWord[] = []
  for (const line of lines) {
    const positions = line.xPositions ?? skeletonGlyphPositions(line.text, line.width, fontSize)
    for (const match of line.text.matchAll(/\S+/gu)) {
      const first = positions[match.index] ?? 0
      const last = positions[match.index + match[0].length - 1] ?? first
      const end = Math.min(line.width, last + fontSize * 0.48)
      if (end > first) words.push(Object.freeze({ text: match[0], x: line.x + first, width: end - first, y: line.y, height: line.height, baseline: line.baseline,
        xPositions: Object.freeze(positions.slice(match.index, match.index + match[0].length).map(value => line.x + value)) }))
    }
  }
  return Object.freeze(words.slice(0, 104))
}

// These exported values are also the source for an outside-repo SVG preview.
// Native filter metrics, bitmap export and frame time still require iOS checks.
