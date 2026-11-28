export const MAX_ANIMATED_TAIL = 32
export const LETTER_DELAY_MS = 12
// New words are shown in the secondary color and switch to the text color
// after this long; there is no fade, so one timer per frame is enough.
export const LETTER_SECONDARY_MS = 300

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

// 0 while the letter is still secondary, 1 once it has settled to text color.
export function getTranscriptColorProgress(
  letter: TranscriptLetter,
  now: number,
): number {
  if (letter.startedAt === null) return 1
  return now - letter.startedAt >= LETTER_SECONDARY_MS ? 1 : 0
}

// Time at which the last new letter of the frame settles, or null if none is new.
export function transcriptSettleTime(tail: readonly TranscriptLetter[]): number | null {
  let latest: number | null = null
  for (const letter of tail)
    if (letter.startedAt !== null && (latest === null || letter.startedAt > latest))
      latest = letter.startedAt
  return latest === null ? null : latest + LETTER_SECONDARY_MS
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
