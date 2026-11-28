// Presentation of an answer: the text keeps its [n] citation marks (parseAnswer
// needs them), the screen shows it without them and as lists where it has any.

const MARK = /\s*\[\d+\]/gu
const LEADING_MARKS = /^\s*(?:\[\d+\]\s*)+/u
// A mark still being typed ("[", "[1") must not flash while the answer streams.
const OPEN_MARK = /\s*\[\d*$/u

export const stripCitationMarks = (text: string): string =>
  text.replace(LEADING_MARKS, '').replace(MARK, '').replace(OPEN_MARK, '')

export type AnswerBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[]; labels?: string[] }

const BULLET = /^\s*(?:[-•*])\s+(.*)$/u
const NUMBERED = /^\s*(\d+)\.\s+(.*)$/u
// "27. listopada" is a date, not item 27.
const MONTH = /^(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?!\p{L})/iu

export function parseAnswerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  for (const raw of answer.split(/\n+/u)) {
    if (!raw.trim()) continue
    const bullet = BULLET.exec(raw)
    const found = bullet ? null : NUMBERED.exec(raw)
    const numbered = found && !MONTH.test(found[2] ?? '') ? found : null
    const match = bullet ? [bullet[0], bullet[1]] : numbered ? [numbered[0], numbered[2]] : null
    if (!match) {
      blocks.push({ kind: 'paragraph', text: stripCitationMarks(raw.trim()) })
      continue
    }
    const ordered = numbered !== null
    const item = stripCitationMarks(match[1] ?? '').trim()
    const label = numbered ? `${numbered[1]}.` : '•'
    const previous = blocks.at(-1)
    if (previous?.kind === 'list' && previous.ordered === ordered) {
      previous.items.push(item)
      previous.labels?.push(label)
    } else blocks.push({ kind: 'list', ordered, items: [item], labels: [label] })
  }
  return blocks
}

const dayStart = (timestamp: number): number => {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// "Plan na jutro · dziś": the note title and the day it was written.
export function sourceChipLabel(title: string, createdAt: number | undefined, now: Date, language: 'pl' | 'en'): string {
  if (createdAt === undefined) return title
  const days = Math.round((dayStart(now.getTime()) - dayStart(createdAt)) / 86_400_000)
  const day =
    days === 0 ? (language === 'pl' ? 'dziś' : 'today')
      : days === 1 ? (language === 'pl' ? 'wczoraj' : 'yesterday')
        : new Intl.DateTimeFormat(language === 'pl' ? 'pl-PL' : 'en-US', { day: 'numeric', month: 'short' }).format(createdAt)
  return `${title} · ${day}`
}
