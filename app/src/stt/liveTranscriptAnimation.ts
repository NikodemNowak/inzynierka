export const MAX_ANIMATED_TAIL = 32
export const LETTER_DELAY_MS = 12
export const LETTER_FADE_MS = 170
export const LETTER_BLUE_HOLD_MS = 400
export const LETTER_COLOR_FADE_MS = 500
export const LETTER_COLOR_SETTLE_MS = LETTER_BLUE_HOLD_MS + LETTER_COLOR_FADE_MS

export interface TranscriptLetter {
  index: number
  character: string
  startedAt: number | null
}

export interface TranscriptFrame {
  prefix: string
  tail: TranscriptLetter[]
}

const commonPrefixLength = (left: string[], right: string[]): number => {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

export function buildTranscriptFrame(
  previousText: string,
  previousTail: ReadonlyMap<number, TranscriptLetter>,
  text: string,
  now: number,
): TranscriptFrame {
  const previousCharacters = Array.from(previousText)
  const characters = Array.from(text)
  const commonLength = commonPrefixLength(previousCharacters, characters)
  const tailStart = Math.max(0, characters.length - MAX_ANIMATED_TAIL)
  const tail: TranscriptLetter[] = []
  let newLetterIndex = 0

  for (let index = tailStart; index < characters.length; index += 1) {
    const character = characters[index]
    const previousLetter = previousTail.get(index)
    if (index < commonLength && previousLetter?.character === character) {
      tail.push(previousLetter)
    } else if (index < commonLength) {
      // Text that was already outside the animated window is already visible.
      tail.push({ index, character, startedAt: null })
    } else {
      tail.push({
        index,
        character,
        startedAt: now + newLetterIndex * LETTER_DELAY_MS,
      })
      newLetterIndex += 1
    }
  }

  return { prefix: characters.slice(0, tailStart).join(''), tail }
}

export function getTranscriptLetterAlpha(
  letter: TranscriptLetter,
  now: number,
): number {
  if (letter.startedAt === null) return 1
  const progress = Math.max(
    0,
    Math.min(1, (now - letter.startedAt) / LETTER_FADE_MS),
  )
  return 0.12 + 0.88 * Math.max(0, Math.min(1, progress))
}

export function getTranscriptColorProgress(
  letter: TranscriptLetter,
  now: number,
): number {
  if (letter.startedAt === null) return 1
  const elapsed = now - letter.startedAt - LETTER_BLUE_HOLD_MS
  return Math.max(0, Math.min(1, elapsed / LETTER_COLOR_FADE_MS))
}

const parseHexColor = (color: string): [number, number, number] | null => {
  const match = /^#?([\da-f]{6})$/i.exec(color)
  if (!match) return null
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ]
}

export function interpolateTranscriptColor(
  fromColor: string,
  toColor: string,
  progress: number,
): string {
  const destination = parseHexColor(toColor) ?? [73, 87, 106]
  const source = parseHexColor(fromColor) ?? destination
  const amount = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 1
  const channels = source.map((channel, index) =>
    Math.round(channel + (destination[index] - channel) * amount),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}
