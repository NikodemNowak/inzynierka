import { resolveDue } from '../tasks/taskDue'
import type { AskChunk, AskIndex } from './askIndex'
import { plain, terms } from './askText'

// Picks the note passages a question needs: BM25 over stems, a boost for
// passages dated on the day (or week) the question asks about, and a boost for
// tasks when the question is about things to do.

export interface DayRange {
  from: number
  to: number
}

export interface RetrievedNote {
  noteId: string
  passages: AskChunk[]
  score: number
}

const DAY = 86400000
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const WEEK_THIS = /\b(?:w\s+tym\s+tygodniu|ten\s+tydzien|tego\s+tygodnia|this\s+week)\b/u
const WEEK_NEXT = /\b(?:w\s+przyszlym\s+tygodniu|przyszly\s+tydzien|next\s+week)\b/u
const TEMPORAL = /\b(?:dzis|dzisiaj|jutro|pojutrze|wczoraj|poniedzial\w*|wtor\w*|srod\w*|czwart\w*|piat\w*|sobot\w*|niedziel\w*|weekend\w*|today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}\s+(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|pazdz|listop|grud|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec)/u

const WEEKDAY_WORDS: readonly [RegExp, number][] = [
  [/^(?:niedziel\w*|sunday)$/u, 0], [/^(?:poniedzial\w*|monday)$/u, 1], [/^(?:wtor\w*|tuesday)$/u, 2], [/^(?:srod\w*|wednesday)$/u, 3],
  [/^(?:czwart\w*|thursday)$/u, 4], [/^(?:piat\w*|friday)$/u, 5], [/^(?:sobot\w*|saturday)$/u, 6],
]
// "co miałem w czwartek" asks about the last Thursday, "co mam w czwartek" about the next one.
const PAST = /\b(?:mialem|mialam|bylo|byla|byl|bylem|bylam|zrobilem|zrobilam|ostatni\w*|zeszl\w*|did|was|were|had|last)\b/u
const MONTH_DAY = /\d{1,2}\s+(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|pazdz|listop|grud|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec)\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?/u

const single = (day: number): DayRange => ({ from: day, to: day })

// The day or week a question is about, relative to "now".
export const questionDays = (question: string, now: Date): DayRange | null => {
  const text = plain(question).replace(/[?!.,;:]+(?=\s|$)/gu, ' ').replace(/\s+/gu, ' ').trim()
  const today = startOfDay(now)
  const weekEnd = today + ((7 - now.getDay()) % 7) * DAY
  if (WEEK_NEXT.test(text)) return { from: weekEnd + DAY, to: weekEnd + 7 * DAY }
  if (WEEK_THIS.test(text)) return { from: today, to: weekEnd }
  if (!TEMPORAL.test(text)) return null
  if (/\b(?:wczoraj|yesterday)\b/u.test(text)) return single(today - DAY)
  const monthDay = MONTH_DAY.exec(text)
  const dated = monthDay ? resolveDue(monthDay[0], now) : null
  if (dated) {
    // A question about "15 października" asked on the 16th means this year's, not next year's.
    const date = dated.date.getTime() - today > 180 * DAY ? new Date(dated.date.getFullYear() - 1, dated.date.getMonth(), dated.date.getDate()) : dated.date
    return single(startOfDay(date))
  }
  const weekday = text.split(' ').map((word) => WEEKDAY_WORDS.find(([pattern]) => pattern.test(word))?.[1]).find((value) => value !== undefined)
  if (weekday !== undefined && !/\b(?:przysz\w*|next)\b/u.test(text)) {
    const ahead = (weekday - now.getDay() + 7) % 7
    // Today counts as "w piątek" on a Friday.
    return single(PAST.test(text) ? today - (ahead === 0 ? 7 : 7 - ahead) * DAY : today + ahead * DAY)
  }
  const resolved = resolveDue(text, now)
  return resolved ? single(startOfDay(resolved.date)) : null
}

const TASK_QUESTION = /\b(?:zadan\w*|zrobic|zalatwic|do\s+zrobienia|co\s+mam|musze|mam\s+do|plan\w*|to\s*do|tasks?|have\s+to|need\s+to|what\s+do\s+i|errands?|remind\w*)\b/u

const DUTY = /\b(?:musze|trzeba|mam\s+\w+c|mam\s+do|nalezy|przypomnij|oddac|zaplacic|kupic|zadzwonic|odebrac|have\s+to|need\s+to|must|remind|should|pick\s+up|pay|buy|call)\b/u

const KIND_WEIGHT: Readonly<Record<AskChunk['kind'], number>> = { sentence: 1, point: 1.1, task: 1.2, title: 0.7 }
const K1 = 1.2
const B = 0.6

const bm25 = (chunk: AskChunk, query: ReadonlyMap<string, number>, index: AskIndex): number => {
  const counts = new Map<string, number>()
  for (const term of chunk.terms) counts.set(term, (counts.get(term) ?? 0) + 1)
  const n = index.chunks.length
  let score = 0
  for (const [term, weight] of query) {
    const tf = counts.get(term)
    if (!tf) continue
    const df = index.df.get(term) ?? 0
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
    score += weight * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * chunk.terms.length) / index.averageLength)))
  }
  return score
}

export interface RetrieveOptions {
  now: Date
  // Earlier user turns, for short follow-ups ("a o której?").
  history?: readonly string[]
  // Extra search words (e.g. synonyms or a translation), weighted lower.
  expansion?: readonly string[]
  maxNotes?: number
  maxPassages?: number
}

export const retrieve = (question: string, index: AskIndex, options: RetrieveOptions): RetrievedNote[] => {
  const query = new Map<string, number>()
  const add = (text: string, weight: number): void => {
    for (const term of terms(text)) query.set(term, Math.max(query.get(term) ?? 0, weight))
  }
  add(question, 1)
  // A short follow-up borrows the words of the previous question.
  const last = options.history?.at(-1)
  if (last && terms(question).length <= 3) add(last, 0.6)
  for (const extra of options.expansion ?? []) add(extra, 0.5)
  const days = questionDays(question, options.now) ?? (last && terms(question).length <= 3 ? questionDays(last, options.now) : null)
  const wantsTasks = TASK_QUESTION.test(plain(question))
  // "Co mam dzisiaj?" gathers from many notes; a topic question needs few.
  const maxNotes = options.maxNotes ?? (days ? 8 : 4)
  const maxPassages = options.maxPassages ?? (days ? 18 : 10)

  const scored = index.chunks.map((chunk) => {
    let score = bm25(chunk, query, index) * KIND_WEIGHT[chunk.kind]
    if (days && chunk.day !== null && chunk.day >= days.from && chunk.day <= days.to) {
      score += chunk.kind === 'task' ? 4 : 2.5
      if (wantsTasks && chunk.kind !== 'task' && DUTY.test(plain(chunk.text))) score += 1
    }
    if (wantsTasks && chunk.kind === 'task' && !chunk.done) score += days ? 0.5 : 1
    if (chunk.done) score *= 0.6
    return { chunk, score }
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  // Group the best passages by note; a note's score is its best passage plus a little for the rest.
  const byNote = new Map<string, RetrievedNote>()
  for (const { chunk, score } of scored) {
    const entry = byNote.get(chunk.noteId)
    if (entry) {
      if (entry.passages.length < 6) entry.passages.push(chunk)
      entry.score += score * 0.15
    } else if (byNote.size < maxNotes * 2) {
      byNote.set(chunk.noteId, { noteId: chunk.noteId, passages: [chunk], score })
    }
  }
  const notes = [...byNote.values()].sort((a, b) => b.score - a.score)
  // Drop notes far weaker than the best one: they are noise for the model.
  const best = notes[0]?.score ?? 0
  const kept = notes.filter((note, position) => position < maxNotes && note.score >= best * 0.25)
  let budget = maxPassages
  for (const note of kept) {
    note.passages = note.passages.slice(0, Math.max(1, Math.min(note.passages.length, budget)))
    budget -= note.passages.length
  }
  return kept.filter((note) => note.passages.length > 0)
}
