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
  // Share of the question's own words found in this note's passages (0..1).
  coverage?: number
}

const DAY = 86400000
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const WEEK_THIS = /\b(?:w\s+tym\s+tygodniu|ten\s+tydzien|tego\s+tygodnia|this\s+week)\b/u
const WEEK_NEXT = /\b(?:w\s+przyszlym\s+tygodniu|przyszly\s+tydzien|next\s+week)\b/u
const TEMPORAL = /\b(?:dzis|dzisiaj|jutro|pojutrze|wczoraj|poniedzial\w*|wtor\w*|srod(?:a|e|y|zie)|czwart(?:ek|ku|kiem)|piat(?:ek|ku|kiem)|sobot\w*|niedziel\w*|weekend\w*|today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}\s+(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|pazdz|listop|grud|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec)/u

const WEEKDAY_WORDS: readonly [RegExp, number][] = [
  [/^(?:niedziel\w*|sunday)$/u, 0], [/^(?:poniedzial\w*|monday)$/u, 1], [/^(?:wtor\w*|tuesday)$/u, 2], [/^(?:srod(?:a|e|y|zie)|wednesday)$/u, 3],
  [/^(?:czwart(?:ek|ku|kiem)|thursday)$/u, 4], [/^(?:piat(?:ek|ku|kiem)|friday)$/u, 5], [/^(?:sobot\w*|saturday)$/u, 6],
]
// "co miałem w czwartek" asks about the last Thursday, "co mam w czwartek" about the next one.
const PAST = /\b(?:mialem|mialam|bylo|byla|byl|bylem|bylam|zrobilem|zrobilam|ostatni\w*|zeszl\w*|did|was|were|had|last)\b/u
const MONTH_DAY = /\d{1,2}\s+(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|pazdz|listop|grud|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec)\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?/u

const single = (day: number): DayRange => ({ from: day, to: day })

const OVERDUE = /\b(?:zalegl\w*|przeterminowan\w*|po\s+terminie|overdue|past\s+due)\b/u
const WEEKEND = /\bweekend\w*\b/u
const NEXT = /\b(?:przysz\w*|nastepn\w*|next)\b/u

// Sat..Sun: the coming one (today counts on a weekend), the next one, or the last one.
const weekendRange = (text: string, now: Date): DayRange => {
  const today = startOfDay(now)
  const dow = now.getDay()
  if (PAST.test(text)) {
    const saturday = today - ((((dow - 6 + 7) % 7) || 7)) * DAY
    return { from: saturday, to: saturday + DAY }
  }
  const saturday = dow === 0 ? today - DAY : today + ((6 - dow + 7) % 7) * DAY
  if (NEXT.test(text)) return { from: saturday + 7 * DAY, to: saturday + 8 * DAY }
  return { from: Math.max(saturday, today), to: saturday + DAY }
}

// The day or week a question is about, relative to "now". One calendar: a week
// runs to Sunday ("w tym tygodniu" = today..Sunday, "w przyszłym" = Monday..Sunday).
export const questionDays = (question: string, now: Date): DayRange | null => {
  const text = plain(question).replace(/[?!.,;:]+(?=\s|$)/gu, ' ').replace(/\s+/gu, ' ').trim()
  const today = startOfDay(now)
  const weekEnd = today + ((7 - now.getDay()) % 7) * DAY
  if (OVERDUE.test(text)) return { from: -Infinity, to: today - DAY }
  if (WEEK_NEXT.test(text)) return { from: weekEnd + DAY, to: weekEnd + 7 * DAY }
  if (WEEK_THIS.test(text)) return { from: today, to: weekEnd }
  if (!TEMPORAL.test(text)) return null
  if (/\b(?:wczoraj|yesterday)\b/u.test(text)) return single(today - DAY)
  if (WEEKEND.test(text)) return weekendRange(text, now)
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

export const GENERIC_DAY_WORDS = 'dzisiaj dziś jutro pojutrze wczoraj tydzień tygodniu tygodnia przyszły przyszłym przyszłego następny zrobienia zrobić załatwić zadania zadań plan planie planu dnia today tomorrow yesterday week next tasks task things plate todo errands overdue zaległe zaległych zaległa przeterminowane terminie weekend weekendu poniedziałek wtorek środa środę czwartek piątek sobota sobotę niedziela niedzielę monday tuesday wednesday thursday friday saturday sunday stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia january february march april june july august september october november december'
// Words that only a question about things to do uses.
export const TASK_WORDS = /\b(?:zadan\w*|do\s+zrobienia|plan\w*\s+na|plan\s+dnia|todo|to\s*do|tasks?|errands?|zalegl\w*|przeterminowan\w*|po\s+terminie|overdue|past\s+due|agenda)\b/u
// "Co mam jutro?" is about tasks only with a day; "co mam w lodówce" is not.
const HAVE_QUESTION = /\b(?:co\s+(?:mam|musze|powinienem|powinnam|trzeba|planuje|jest|robie|bede\s+robi\w*)|jakie\s+mam|what\s+do\s+i\s+(?:have|need|got)|what\s+have\s+i\s+got|what(?:'s|\s+is)\s+(?:on|due|up|planned)|what\s+should\s+i|what\s+am\s+i)\b/u
// Duties asked about without a day ("co muszę zrobić w sprawie urodzin taty").
const DUTY_QUESTION = /\b(?:musze|mam\s+do|zrobic|zalatwic|have\s+to|need\s+to|remind\w*|przypomn\w*)\b/u

export const isTaskQuestion = (question: string, now: Date = new Date()): boolean => {
  const text = plain(question)
  return TASK_WORDS.test(text) || (HAVE_QUESTION.test(text) && questionDays(question, now) !== null)
}
// Looser: also true for duty questions with no day; shapes retrieval and the list prompt.
export const asksForTasks = (question: string, now: Date = new Date()): boolean => isTaskQuestion(question, now) || DUTY_QUESTION.test(plain(question))
export { HAVE_QUESTION }

const WHEN_QUESTION = /\b(?:kiedy|kiedys|o\s+ktorej|na\s+kiedy|do\s+kiedy|ktorego|when|what\s+time|which\s+day|by\s+when)\b/u

const DUTY = /\b(?:musze|trzeba|mam\s+\w+c|mam\s+do|nalezy|przypomnij|oddac|zaplacic|kupic|zadzwonic|odebrac|have\s+to|need\s+to|must|remind|should|pick\s+up|pay|buy|call)\b/u

const KIND_WEIGHT: Readonly<Record<AskChunk['kind'], number>> = { sentence: 1, point: 0.8, task: 0.9, title: 0.7 }
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
  // Cosine similarity of the question to each chunk (by chunk id), from the embedding model.
  semantic?: ReadonlyMap<number, number>
  semanticWeight?: number
  // How much fresher notes win over old ones on the same topic (0 = no preference).
  recency?: number
}

// Similarities are rescaled per question: the best chunk gets 1, the median 0,
// so the weight means the same for any model and any question.
const semanticScores = (similarity: ReadonlyMap<number, number>): Map<number, number> => {
  const values = [...similarity.values()].sort((a, b) => a - b)
  const top = values.at(-1) ?? 0
  const median = values[Math.floor(values.length / 2)] ?? 0
  const span = Math.max(1e-6, top - median)
  const out = new Map<number, number>()
  for (const [id, value] of similarity) if (value > median) out.set(id, ((value - median) / span) ** 2)
  return out
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
  const wantsTasks = asksForTasks(question, options.now)
  // "Co mam dzisiaj do zrobienia?": the day is matched by dates and the duty by
  // task cues, so these words would only reward notes that happen to repeat them.
  if (days && wantsTasks) for (const term of terms(GENERIC_DAY_WORDS)) query.delete(term)
  // "Co mam dzisiaj?" gathers from many notes; a topic question needs few.
  const maxNotes = options.maxNotes ?? (days ? 8 : 4)
  const maxPassages = options.maxPassages ?? (days ? 18 : 10)

  const semantic = options.semantic ? semanticScores(options.semantic) : null
  const semanticWeight = options.semanticWeight ?? 4
  const recency = options.recency ?? 1.5
  const today = startOfDay(options.now)
  const asksWhen = WHEN_QUESTION.test(plain(question))
  const scored = index.chunks.flatMap((chunk) => {
    if (chunk.kind === 'task') {
      // A day question is a filter for tasks: only those due in the range, and
      // a question about things to do never lists finished ones.
      if (days && (chunk.day === null || chunk.day < days.from || chunk.day > days.to)) return []
      if (wantsTasks && chunk.done) return []
    }
    const base = bm25(chunk, query, index)
    let score = base * KIND_WEIGHT[chunk.kind]
    if (semantic) score += semanticWeight * (semantic.get(chunk.id) ?? 0) * KIND_WEIGHT[chunk.kind]
    if (days && chunk.day !== null && chunk.day >= days.from && chunk.day <= days.to) {
      score += chunk.kind === 'task' ? 4 : 2.5
      if (wantsTasks && chunk.kind !== 'task' && DUTY.test(plain(chunk.text))) score += 1
    }
    // Tasks lead only among those that match the words; no free lift for every open task.
    if (wantsTasks && !days && chunk.kind === 'task' && !chunk.done && base > 0) score += 1
    if (chunk.done) score *= 0.6
    // "Kiedy mam dentystę?" after years of notes means the next visit, not one from 2024.
    const created = index.notes.get(chunk.noteId)?.createdAt ?? 0
    const age = Math.max(0, (options.now.getTime() - created) / DAY)
    score *= 1 + recency * Math.exp(-age / 30)
    if (asksWhen && !days && chunk.day !== null && chunk.day >= today) score *= 1.3
    return [{ chunk, score }]
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
  // "Co muszę zrobić w sprawie urodzin taty?" is answered by one note: every
  // duty in it belongs to the answer, not only the sentences that share words.
  const top = kept[0]
  if (wantsTasks && !days && top && (kept[1]?.score ?? 0) < top.score * 0.7) {
    const have = new Set(top.passages.map((chunk) => chunk.id))
    const duties = index.chunks.filter((chunk) => chunk.noteId === top.noteId && !have.has(chunk.id) && (chunk.kind === 'task' ? !chunk.done : chunk.kind === 'sentence' && DUTY.test(plain(chunk.text))))
    top.passages.push(...duties.slice(0, 8))
  }
  let budget = maxPassages + (top ? Math.max(0, top.passages.length - 6) : 0)
  for (const note of kept) {
    note.passages = note.passages.slice(0, Math.max(1, Math.min(note.passages.length, budget)))
    budget -= note.passages.length
  }
  const own = [...new Set(terms(question))]
  for (const note of kept) {
    const have = new Set(note.passages.flatMap((chunk) => chunk.terms))
    note.coverage = own.length ? own.filter((term) => have.has(term)).length / own.length : 0
  }
  return kept.filter((note) => note.passages.length > 0)
}

// The words of the question already sit in the best note: synonym expansion would add only latency.
export const isConfidentMatch = (question: string, retrieved: readonly RetrievedNote[]): boolean => {
  const own = new Set(terms(question)).size
  return own >= 2 && (retrieved[0]?.coverage ?? 0) >= 0.8
}
