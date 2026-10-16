import { resolveDue } from '../tasks/taskDue'

// English counterpart of the task-lines prompt, candidate filter and guards.
// Same line protocol as Polish: "[id] Task — due" or "[id] -".

export interface EnTaskDraft {
  title: string
  due: string | null
  sourceIds: number[]
  modelIds: number[]
}

export const TASK_LINES_PROMPT_EN = `TASK: read the note sentences and list the author's tasks.
A task = something the AUTHOR of the note (me) has to do in the future: an action, an instruction to follow (e.g. take a pill at 8:00) or an agreed meeting or appointment.
NOT the author's task:
- another person's action ("Anna will send", "Tom will review", "Mark will water"),
- something already done ("I booked", "I already have", "done"),
- a cancelled or dropped plan ("we are not doing it anymore", "I dropped", "decided not to"),
- a fact, opinion, memory, general advice, a vague wish, "maybe / we'll see".
With a correction ("no, wait", "actually", "moved to") the later version counts; check the rest of the note.

For every sentence in the list write one line, in the same order and with the same number:
- if the sentence has no task of the author: the number and a dash, e.g. [5] -
- if it has one: the number, the action, then " — " and the deadline, e.g. [6] Pay the internet bill 60 dollars — by Friday
Do not create tasks from descriptions of the past, from numbers, prices or times given as information.
Action: 2–8 words, an imperative with the verb from the sentence (Buy…, Call…, Send…; not "I will call"); for a visit or meeting a noun (Visit to…, Meeting with…). No "I need to / I have to" and no reasons. Put amounts, numbers (as digits), places and a condition ("if…") into the action, e.g. Buy 12 eggs.
After " — " write only the deadline: a day, a date, a time or "by…/before…/tomorrow", and only if it was said IN THE SAME sentence; numbers and times as digits; do not add months or dates. Without a deadline do not write " — ".
Two tasks in one sentence: separate them with |; do not merge different events into one task.

Example (another note):
SENTENCES:
[1] Okay, on Wednesday I have to hand in the project, no, wait, on Thursday.
[2] Zoe will take care of the shopping, that's her thing.
[3] Yesterday I was at the gym, it was hard.
[4] The hairdresser was at eleven, but they called and moved it to one pm.
[5] Maybe one day I'll learn the guitar.
[6] The water bill, eighty dollars, has to be paid by the fifteenth.
[7] If Igor doesn't send the contract by tomorrow, I'll email him.
[8] I'm not going to the pool this week, I'm skipping it.
[9] I have to use the eye drops three times a day.
[10] Hannah asked me to give her the book back on Saturday.
[11] Need to fix the login screen.
[12] Kate will check the text by Wednesday.
[13] I'm heading to the pool now and at 5 pm today I have a dentist appointment.
ANSWER:
[1] Hand in the project — Thursday
[2] -
[3] -
[4] Hairdresser appointment — 13:00
[5] -
[6] Pay the water bill 80 dollars — by the 15th
[7] Email Igor if he doesn't send the contract — tomorrow
[8] -
[9] Use the eye drops 3 times a day
[10] Give Hannah the book back — Saturday
[11] Fix the login screen
[12] -
[13] Go to the pool — now | Dentist appointment — today 17:00`

// Cheap pre-filter: only sentences that can carry a task go to the model.
const CANDIDATE = new RegExp(
  [
    String.raw`\b(?:need(?:s)? to|have to|has to|got to|must|should|remember to|don'?t forget|I'?ll|I will|I'?m going to|going to|want to|plan to|supposed to)\b`,
    String.raw`\b(?:buy|call|send|book|pay|fix|prepare|check|email|write|finish|return|bring|pick up|order|register|update|take|visit|meet|submit|review|clean|top up|renew)\b`,
    String.raw`\b(?:appointment|meeting|visit|deadline|dentist|doctor|call|exam)\b`,
    String.raw`\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|by the|until|before|end of|this week|january|february|march|april|may|june|july|august|september|october|november|december)\b`,
  ].join('|'),
  'i',
)
const NO_TASK = /^\s*(?:okay|ok|well|so|anyway|right)\b[^.]{0,25}[.!?]?\s*$/i

export const isTaskCandidateEn = (text: string): boolean => !NO_TASK.test(text) && CANDIDATE.test(text)

// "I need to send…" -> "Send…"
const DUTY_LEAD = /^(?:(?:and|also|so|then|okay|ok)\s+)*(?:i\s+)?(?:really\s+)?(?:need(?:s)? to|have to|has to|got to|must|should|remember to|don'?t forget to|will|'ll|am going to|'m going to|going to|want to|plan to|'d like to|would like to)\s+/i
const TEMPORAL = /\b(?:today|tonight|tomorrow|morning|afternoon|evening|noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december|by|before|until|end|next|this|asap|\d)/i
const NEGATED = /^(?:not|don'?t|do not|no|never|skip)\b/i
const OTHER_FUTURE = /\b(?!(?:I|We|It|This|That|There|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\b)(?:[A-Z][a-z]+|he|she|they|mum|mom|dad)\s+(?:will|'ll|is going to|are going to|is|are|can|has to|needs to|should|wants me|asked me)\b/
const OWN_DUTY = /\bI\s*(?:need|have|must|should|will|'ll|am going|'m going|want|plan)\b|\b(?:need|have|has) to\b/i
const ASKED_ME = /\b(?:asked|wants|told)\s+me\s+to\b/i
const CANCELLED = /\b(?:not\s+\w+(?:ing)?\b[^.]*\banymore|no longer|dropped|cancel(?:l?ed|ling)?|decided not|we(?:'re| are) not|not doing|won'?t|skipping)\b/i
const DONE = /\b(?:I|we)\s+(?:already\s+)?(?:booked|bought|paid|sent|did|finished)\b|\balready\b/i

const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)
const stems = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((word) => word.slice(0, 5)))

// "Pay the bill 212 dollars by the 20th": a deadline left inside the title.
const TRAILING_DUE = /\s+((?:by|before|until|on|at|next|this)\s+(?:the\s+)?[\w:]+(?:\s+(?:morning|afternoon|evening|night|noon|of\s+\w+|\d{1,2}(?::\d{2})?))?|today|tonight|tomorrow(?:\s+(?:morning|afternoon|evening))?)$/i
const DUE_WORD = /\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month|morning|evening|noon|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?)\b|\d{1,2}:\d{2}/i

const dueResolves = (due: string): boolean => resolveDue(due, new Date(2026, 0, 7, 12, 0)) !== null

export const tidyTaskEn = (t: EnTaskDraft): EnTaskDraft => {
  let title = capitalize(t.title.replace(DUTY_LEAD, '').replace(/[\s.,;:—–-]+$/u, '').trim())
  let due = t.due?.replace(/[\s.,;]+$/u, '').trim() || null
  if (!due) {
    const tail = TRAILING_DUE.exec(title)
    if (tail && DUE_WORD.test(tail[1]!)) {
      due = tail[1]!
      title = title.slice(0, tail.index).trim()
    }
  }
  return { ...t, title, due: due && TEMPORAL.test(due) ? due : null }
}

// "Book the station and send the invoice": two actions joined by "and".
const ACTION_VERB = /^(?:buy|call|send|book|pay|fix|prepare|check|email|write|finish|return|bring|pick|order|register|update|take|visit|meet|submit|review|clean|top|renew|get|go|make|ask|tell|cancel|print|read|reply|move|put|help|find|bake|clear)\b/i
export const splitJoinedEn = (t: EnTaskDraft): EnTaskDraft[] => {
  const parts = t.title.split(/\s+and\s+/i)
  if (parts.length < 2 || !parts.every((part) => ACTION_VERB.test(part.trim()))) return [t]
  return parts.map((part) => ({ ...t, title: capitalize(part.trim()) }))
}

// One sentence's guards: another person's job, a dropped plan, something already done.
export const rejectReasonEn = (t: EnTaskDraft, source: string): string | null => {
  if (!t.title || NEGATED.test(t.title)) return 'negated'
  if (OTHER_FUTURE.test(source) && !OWN_DUTY.test(source) && !ASKED_ME.test(source)) return 'other person'
  const overlap = [...stems(t.title)].some((stem) => stems(source).has(stem))
  if (overlap && CANCELLED.test(source)) return 'cancelled'
  if (overlap && DONE.test(source) && !OWN_DUTY.test(source)) return 'done'
  return null
}

const DUE_TOKEN = /\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month|morning|afternoon|evening|noon|january|february|march|april|may|june|july|august|september|october|november|december|now)\b|\d+/gi
const NUMBER_WORDS: Readonly<Record<string, string>> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' }
export const dueSaidIn = (due: string, source: string): boolean => {
  const said = new Set((source.toLowerCase().match(DUE_TOKEN) ?? []).map((token) => token.replace(/^0+(?=\d)/, '')))
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) if (new RegExp(`\\b${word}\\b`, 'i').test(source)) said.add(digit)
  // "by the twentieth" said in words: any spoken number backs a digit in the deadline.
  const spokenNumber = /\b(?:\w+teen(?:th)?|\w+t(?:y|ieth)|first|second|third|\w+th|hundred)\b/i.test(source)
  const tokens = (due.toLowerCase().match(DUE_TOKEN) ?? []).map((token) => token.replace(/^0+(?=\d)/, ''))
  // "18:00" for "6 PM": the hour may be written on a 24-hour clock.
  return tokens.length === 0 || tokens.some((token) => said.has(token) || (Number(token) > 12 && said.has(String(Number(token) - 12))) || (spokenNumber && /^\d+$/.test(token)))
}

// An unpunctuated transcript is cut mid-phrase ("... to Mr" / "Collins ... by tomorrow"): a unit that does not
// end a sentence shares its words with the neighbour.
const ENDS_SENTENCE = /[.!?…]["')\]]*\s*$/
export const withFragmentNeighbours = (ids: readonly number[], byId: ReadonlyMap<number, string>): string => {
  const parts = new Set<number>(ids)
  for (const id of ids) {
    if (byId.has(id + 1) && !ENDS_SENTENCE.test(byId.get(id) ?? '')) parts.add(id + 1)
    if (byId.has(id - 1) && !ENDS_SENTENCE.test(byId.get(id - 1) ?? '')) parts.add(id - 1)
  }
  return [...parts].sort((a, b) => a - b).map((id) => byId.get(id) ?? '').join(' ')
}

const CLOCK_TAIL = /\s+(?:by|at|before)\s+(\d{1,2}:\d{2})$/i
const CLOCK_IN_TEXT = /\d{1,2}:\d{2}/
const DAY_ANCHOR_ANY = /\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const HOUR_WORDS = /\b(at|by)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i
// Wording the app's date resolver cannot read becomes a form it can ("at four" -> "at 4").
export const repairDueEn = (title: string, due: string | null): { title: string; due: string | null } => {
  if (!due) return { title, due }
  // "Be home by 08:00" + "Thursday": the hour belongs to the deadline.
  const clockTail = CLOCK_TAIL.exec(title)
  if (clockTail && !CLOCK_IN_TEXT.test(due) && DAY_ANCHOR_ANY.test(due)) return repairDueEn(title.slice(0, clockTail.index).trim(), `${due} ${clockTail[1]!}`)
  let text = due.trim().replace(HOUR_WORDS, (_all, prep: string, word: string) => `${prep} ${NUMBER_WORDS[word.toLowerCase()]!}`)
  if (/^(?:in\s+)?this\s+week$/i.test(text)) text = 'by the end of the week'
  if (!dueResolves(text) && `${title} ${text}`.split(/\s+/).length <= 12 && !/\d{1,2}:\d{2}/.test(text)) return { title: `${title} ${text}`, due: null }
  return { title, due: text }
}

const DAY_ANCHOR = /^(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i
// A day said right next to the task words ("buy the food ... on Saturday") that the model left out.
export const inferDueEn = (title: string, source: string): string | null => {
  const tokens = source.toLowerCase().match(/[a-z0-9:']+/g) ?? []
  const days = new Set(tokens.filter((word) => DAY_ANCHOR.test(word)))
  if (days.size !== 1) return null
  const stems = new Set((title.toLowerCase().split(/\s+/).slice(1).join(' ').match(/[a-z]{4,}/g) ?? []).map((word) => word.slice(0, 4)))
  const at = tokens.findIndex((word) => DAY_ANCHOR.test(word))
  // A short sentence with one day names it for the whole sentence; a long one only next to the task words.
  const near = tokens.some((word, index) => word.length >= 4 && stems.has(word.slice(0, 4)) && (tokens.length <= 22 || Math.abs(index - at) <= 4))
  if (!near || title.toLowerCase().includes(tokens[at]!)) return null
  const prev = tokens[at - 1]
  const day = tokens[at]!.charAt(0).toUpperCase() + tokens[at]!.slice(1)
  return `${prev === 'by' || prev === 'before' ? `${prev} ` : ''}${prev === 'by' || prev === 'before' ? tokens[at]! : day}`
}

// "Actually no, wait, he said Thursday evening": the next sentence takes back the day of the task before it.
const CORRECTION_LEAD = /^(?:actually|no,? wait|wait,? no|wait|sorry|I mean|correction|scratch that)\b/i
const DAY_PHRASE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)(?:\s+(morning|afternoon|evening|night))?/gi
export const correctedDueEn = (due: string | null, id: number, byId: ReadonlyMap<number, string>): string | null => {
  const next = byId.get(id + 1) ?? ''
  if (!due || !DAY_ANCHOR_ANY.test(due) || !CORRECTION_LEAD.test(next.trim())) return due
  const found = [...next.matchAll(DAY_PHRASE)]
  // The corrected value is the first day the sentence names, close to its opening words.
  if (!found.length || found[0]!.index > 40) return due
  const [, day, part] = found[0]!
  return capitalize(`${day!.toLowerCase()}${part ? ` ${part.toLowerCase()}` : ''}`)
}

export const postprocessTaskLinesEn = (raw: readonly EnTaskDraft[], units: readonly { id: number; text: string }[]): EnTaskDraft[] => {
  const byId = new Map(units.map((unit) => [unit.id, unit.text]))
  const seen = new Set<string>()
  const kept: EnTaskDraft[] = []
  for (const task of raw.map(tidyTaskEn).flatMap(splitJoinedEn).map((draft) => ({ ...draft }))) {
    const source = task.sourceIds.map((id) => byId.get(id) ?? '').join(' ')
    if (rejectReasonEn(task, englishPromptView(source))) continue
    // A deadline the sentence never said ("Buy milk — today") is the model's guess.
    const wide = englishPromptView(withFragmentNeighbours(task.sourceIds, byId))
    if (task.due && !dueSaidIn(task.due, wide)) task.due = null
    if (!task.due) task.due = inferDueEn(task.title, wide)
    task.due = correctedDueEn(task.due, Math.max(...task.sourceIds), byId)
    Object.assign(task, repairDueEn(task.title, task.due))
    const key = task.title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(task)
  }
  // A task whose words all appear in a fuller one says nothing new.
  return kept.filter((task) => {
    const own = contentWords(task.title)
    return own.size === 0 || !kept.some((other) => other !== task && other.title.length > task.title.length &&
      [...own].every((word) => contentWords(other.title).has(word)))
  })
}

// Words that carry meaning, short ones included ("gym", "eye").
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'with', 'my', 'go', 'get', 'do'])
const contentWords = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => !FUNCTION_WORDS.has(word)).map((word) => word.slice(0, 5)))

// Model-facing view of a self-corrected sentence: "at 8 PM sorry 6 PM" -> "at 6 PM",
// "go by car sorry I'm going to go by tram" -> "I'm going to go by tram". The note keeps the original words.
const CORRECTION = /\b(?:sorry|no wait|wait no|I mean|actually no)\b,?\s*/i
// "on Wednesday, no sorry, on Thursday": the first day or time is dropped.
const CORRECTABLE = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|(?:the )?\d{1,2}(?:st|nd|rd|th))`
const DAY_CORRECTION = new RegExp(
  String.raw`(?:\b(?:on|by|for|until)\s+)?\b${CORRECTABLE}\b,?\s+(?:no,?\s+)?(?:sorry|wait|I mean|actually)\b,?\s*(?:no,?\s*)?(?=(?:(?:on|by|for|until)\s+)?${CORRECTABLE}\b)`,
  'gi',
)

export const englishPromptView = (text: string): string => {
  let out = text.replace(DAY_CORRECTION, '').replace(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:sorry|no|I mean)\s+(?=\d)/gi, '')
  for (let round = 0; round < 3; round += 1) {
    const m = CORRECTION.exec(out)
    if (!m) break
    const before = out.slice(0, m.index)
    const after = out.slice(m.index + m[0].length)
    const head = after.split(/\s+/).slice(0, 3).join(' ').toLowerCase()
    const restart = head ? before.toLowerCase().lastIndexOf(head) : -1
    // Cut back to where the corrected phrase first started; otherwise only the marker goes.
    out = restart >= 0 && before.slice(restart).split(/\s+/).length <= 14 ? before.slice(0, restart) + after : `${before}${after}`
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}
