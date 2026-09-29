export const MAX_ANIMATED_TAIL = 32
export const LETTER_DELAY_MS = 12
export const LETTER_FADE_MS = 170

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
  const progress = (now - letter.startedAt) / LETTER_FADE_MS
  return 0.12 + 0.88 * Math.max(0, Math.min(1, progress))
}
