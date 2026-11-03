import { recordGeneration } from './generationMetrics'
import { generate } from './llm'
import { throwIfProcessingAborted, type ProcessingExecutionContext } from './processingContext'
import { promptView } from './polishNumbers'

// A meeting recorded live has no speaker labels: "Tomek, do kiedy?" "Do czwartku
// zrobię" carries a commitment, but not in the author's first person the note
// task prompt looks for. Such a recording is read in overlapping parts; each part
// lists what was agreed, without names (the 4B model guesses speakers wrongly),
// and the lists are merged so that the later version of a task wins.

interface Unit {
  readonly id: number
  readonly text: string
}

export interface MeetingTask {
  title: string
  due: string | null
  sourceIds: number[]
}

// Addressing someone in the second person is what a recorded conversation has and a
// spoken note does not ("Paweł, zaczynasz?", "możesz to sprawdzić?").
const SECOND_PERSON = /(?<![\p{L}])(?:\p{L}{2,}(?:isz|ysz|esz|asz|iesz)|wiecie|słuchajcie|dawaj|zróbcie|róbcie|możecie|macie|chcecie|jesteś|byłeś|byłaś|zrobicie|dacie|daj)(?![\p{L}])/giu
// Fillers a speaker says to the phone ("wiesz, jak to jest").
const SECOND_PERSON_FILLERS = new Set(['wiesz', 'słuchaj'])
const MIN_CONVERSATION_WORDS = 800
const MIN_SECOND_PERSON_PER_1000 = 3

const wordCount = (text: string): number => text.split(/\s+/u).filter(Boolean).length

export const isRecordedConversation = (units: readonly Unit[]): boolean => {
  const text = units.map((unit) => unit.text).join(' ')
  const words = wordCount(text)
  if (words < MIN_CONVERSATION_WORDS) return false
  const addressed = (text.match(SECOND_PERSON) ?? []).filter((word) => !SECOND_PERSON_FILLERS.has(word.toLowerCase()))
  return (addressed.length * 1000) / words >= MIN_SECOND_PERSON_PER_1000
}

const PART_WORDS = 450
const OVERLAP_WORDS = 60
// A recap at the end of a meeting lists ten tasks at once.
const MAX_PART_TASKS = 10
const PART_OUTPUT_TOKENS = 160
const MAX_TASKS = 15

// Consecutive units of about PART_WORDS, each starting with the last OVERLAP_WORDS
// of the previous one so a commitment split across the boundary is seen whole.
export const meetingParts = (units: readonly Unit[]): Unit[][] => {
  const parts: Unit[][] = []
  let start = 0
  while (start < units.length) {
    let end = start
    let words = 0
    while (end < units.length && (words < PART_WORDS || end === start)) {
      words += wordCount(units[end]!.text)
      end += 1
    }
    parts.push(units.slice(start, end))
    if (end >= units.length) break
    let back = end
    let overlap = 0
    while (back > start + 1 && overlap < OVERLAP_WORDS) {
      back -= 1
      overlap += wordCount(units[back]!.text)
    }
    start = back
  }
  return parts
}

export const MEETING_SYSTEM = 'Wypisujesz zadania ustalone na spotkaniu nagranym telefonem. Zapis nie ma podziału na mówców.'

export const meetingPartPrompt = (part: readonly Unit[], index: number, total: number): string => [
  'Fragment zapisu spotkania lub rozmowy (bez podziału na mówców, często bez interpunkcji). Wypisz zadania, które ustalono: ktoś zobowiązał się coś zrobić albo uzgodniono, że coś ma być zrobione.',
  'Nie wypisuj rzeczy już zrobionych, odwołanych, odłożonych na "kiedyś", pytań, opinii ani propozycji, na które nikt się nie zgodził.',
  'Gdy termin zmieniono, podaj późniejszy. Gdy fragment podsumowuje zadania, wypisz każde. Czynność 2–6 słów w bezokoliczniku, bez imion osób.',
  'Format: - czynność — termin',
  'Gdy we fragmencie nie ma takich zadań, napisz tylko: -',
  '',
  `FRAGMENT ${index + 1}/${total}:`,
  part.map((unit) => promptView(unit.text)).join(' '),
].join('\n')

const LINE = /^\s*[-•*]\s*(.+?)(?:\s+[—–-]\s+(.+))?\s*$/u
const NO_DUE = /^(?:brak|nie\s+podan\p{L}*|nieokreślon\p{L}*|bez\s+terminu|-)$/iu
// The verb or verbal noun names the kind of work ("wysłać", "wysłanie", "wyślanie");
// the object tells two tasks apart.
const ACTION_WORD = /(?:ć|nie|nia|niu|niem)$/u
const LIGHT_NOUNS = new Set(['naprawa', 'aktualizacja', 'zmiana', 'wysyłka', 'przeróbka', 'udział'])

// What the model lists although the prompt excludes it: put off, already past, an open question.
const NOT_A_TASK = /(?<!\p{L})(?:kiedyś|odłożon\p{L}*|na\s+przyszłość|wczoraj|przedwczoraj)(?!\p{L})|^ustalić,?\s+(?:kto|czy|kiedy|jak|gdzie|co)(?!\p{L})/iu

export const parseMeetingLines = (text: string): { title: string; due: string | null }[] =>
  text.replace(/<think>[\s\S]*?<\/think>/gu, '').split(/\r?\n/u).flatMap((line) => {
    const match = LINE.exec(line)
    if (!match || !/\p{L}{3,}/u.test(match[1]!)) return []
    const title = match[1]!.replace(/^[^:]{1,20}:\s*/u, '').trim()
    const due = match[2]?.trim() ?? null
    if (!title || NOT_A_TASK.test(title) || (due && NOT_A_TASK.test(due))) return []
    return [{ title, due: due && !NO_DUE.test(due) ? due : null }]
  })

const objectKey = (title: string): string => {
  const words = title.toLowerCase().match(/\p{L}{4,}/gu) ?? []
  // Only the leading word names the action: "zaproszenie" further on is the object.
  const content = words[0] && (ACTION_WORD.test(words[0]) || LIGHT_NOUNS.has(words[0])) ? words.slice(1) : words
  return (content[0] ?? words[0] ?? title.toLowerCase()).slice(0, 5)
}

// The unit of the part that shares the most words with the task: the transcript link.
const sourceOf = (title: string, part: readonly Unit[]): number => {
  const stems = new Set((title.toLowerCase().match(/\p{L}{4,}/gu) ?? []).map((word) => word.slice(0, 4)))
  let best = part[0]!.id
  let bestScore = 0
  for (const unit of part) {
    const score = (unit.text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((word) => stems.has(word.slice(0, 4))).length
    if (score > bestScore) {
      best = unit.id
      bestScore = score
    }
  }
  return best
}

// One task per object; a later mention sets the deadline (a moved date, a recap at
// the end), while the fuller wording stays: a recap says only "makiety — czwartek".
// Too many: the ones mentioned last stay, since a meeting closes on what was agreed.
// The list keeps the order tasks first came up in.
export const mergeMeetingTasks = (found: readonly MeetingTask[]): MeetingTask[] => {
  const byKey = new Map<string, { task: MeetingTask; first: number; last: number }>()
  found.forEach((task, order) => {
    const key = objectKey(task.title)
    const earlier = byKey.get(key)
    const fuller = earlier && wordCount(earlier.task.title) > wordCount(task.title) ? earlier.task : task
    const merged = { ...fuller, due: task.due ?? earlier?.task.due ?? null }
    byKey.set(key, { task: merged, first: earlier?.first ?? order, last: order })
  })
  return [...byKey.values()]
    .sort((a, b) => b.last - a.last).slice(0, MAX_TASKS)
    .sort((a, b) => a.first - b.first).map((item) => item.task)
}

export const extractMeetingTasks = async (units: readonly Unit[], execution?: ProcessingExecutionContext): Promise<MeetingTask[]> => {
  const parts = meetingParts(units)
  const found: MeetingTask[] = []
  for (const [index, part] of parts.entries()) {
    throwIfProcessingAborted(execution)
    const prompt = meetingPartPrompt(part, index, parts.length)
    const result = await generate(prompt, () => undefined, {
      system: MEETING_SYSTEM,
      nPredict: PART_OUTPUT_TOKENS,
      temperature: 0.1,
      topP: 0.8,
      topK: 20,
      minP: 0,
      ...(execution?.signal ? { signal: execution.signal } : {}),
    })
    recordGeneration('task-lines', prompt.length, result, part.reduce((sum, unit) => sum + unit.text.length, 0))
    throwIfProcessingAborted(execution)
    if (result.completion?.interrupted) throw new Error('Generation interrupted')
    for (const line of parseMeetingLines(result.text).slice(0, MAX_PART_TASKS))
      found.push({ ...line, sourceIds: [sourceOf(line.title, part)] })
  }
  return mergeMeetingTasks(found)
}
