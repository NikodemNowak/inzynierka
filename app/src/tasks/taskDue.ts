import { numberWordValue } from '../ai/polishNumbers'

// Task text is stored as "Title — due". The due part is spoken language
// ("jutro 18:00", "do końca miesiąca"); this turns it into a calendar date,
// relative to when the note was recorded, not to when it is read.

export interface TaskParts {
  title: string
  due: string | null
}

export const splitTaskText = (text: string): TaskParts => {
  const at = text.lastIndexOf(' — ')
  if (at < 0) return { title: text.trim(), due: null }
  return { title: text.slice(0, at).trim(), due: text.slice(at + 3).trim() || null }
}

export interface ResolvedDue {
  date: Date
  // No time was said: the whole day.
  allDay: boolean
}

const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/^(?:poniedział|monday|mon$)/u, 1], [/^(?:wtor|tuesday|tue$)/u, 2], [/^(?:(?:środ|srod)(?:a|ę|e|y|zie|ą)[,.;:!?]?$|wednesday|wed$)/u, 3],
  [/^(?:czwart(?:ek|ku|kiem|ki)[,.;:!?]?$|thursday|thu$)/u, 4], [/^(?:piąt(?:ek|ku|kiem)$|piatek|friday|fri$)/u, 5],
  [/^(?:sobot|saturday|sat$)/u, 6], [/^(?:niedziel|sunday|sun$)/u, 0],
]
const MONTHS: readonly (readonly [RegExp, number])[] = [
  [/^(?:stycz|january|jan$)/u, 0], [/^(?:lut|february|feb$)/u, 1], [/^(?:mar(?:ca|zec|cu)|march|mar$)/u, 2],
  [/^(?:kwie|april|apr$)/u, 3], [/^(?:maj|may$)/u, 4], [/^(?:czerw|june|jun$)/u, 5], [/^(?:lip|july|jul$)/u, 6],
  [/^(?:sierp|august|aug$)/u, 7], [/^(?:wrze|september|sep$)/u, 8], [/^(?:paźdz|pazdz|october|oct$)/u, 9],
  [/^(?:listop|november|nov$)/u, 10], [/^(?:grud|december|dec$)/u, 11],
]
const DAY_PARTS: readonly (readonly [RegExp, number])[] = [
  [/(?:^|\s)(?:rano|rana|morning)(?=\s|$)/u, 9], [/przed\s+południem/u, 10], [/(?:w\s+południe|noon)/u, 12],
  [/(?:po\s+południu|afternoon)/u, 15], [/(?:wieczorem|wieczór|wieczor|evening|tonight)/u, 19],
]

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const lastDayOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0)

// Next date with this weekday strictly after the base day.
const nextWeekday = (base: Date, weekday: number): Date => {
  const delta = (weekday - base.getDay() + 7) % 7 || 7
  return addDays(base, delta)
}

const isoWeek = (date: Date): number => {
  const monday = addDays(date, -((date.getDay() + 6) % 7))
  return Math.floor(monday.getTime() / (7 * 86400000))
}

const clockOf = (text: string): { hour: number; minute: number } | null => {
  const clock = /(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/u.exec(text)
  if (clock) return { hour: Number(clock[1]), minute: Number(clock[2]) }
  const pm = /(?:^|\s)(\d{1,2})\s*(am|pm)(?=\s|$)/u.exec(text)
  if (pm) return { hour: (Number(pm[1]) % 12) + (pm[2] === 'pm' ? 12 : 0), minute: 0 }
  // "o 18", "at 6" (a bare hour after a clock preposition)
  const bare = /(?:^|\s)(?:o|godz\.?|at)\s+(\d{1,2})(?=\s|$)/u.exec(text)
  if (bare && Number(bare[1]) <= 24) return { hour: Number(bare[1]) % 24, minute: 0 }
  return null
}

const dayOfMonthOf = (words: readonly string[]): number | null => {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    const next = words[index + 1] ?? ''
    // "25 listopada", "listopad 25" are dates with a month; handled by monthDate.
    if (MONTHS.some(([pattern]) => pattern.test(next))) continue
    const prev = words[index - 1] ?? ''
    const digits = /^(\d{1,2})(?:st|nd|rd|th)?$/u.exec(word)
    if (digits && ['do', 'by', 'dnia', 'on', 'the'].includes(prev)) return Number(digits[1])
    if (/(?:ego|go)$/u.test(word)) {
      const value = numberWordValue(word)
      if (value !== null && value >= 1 && value <= 31) return value
    }
  }
  return null
}

const monthDate = (words: readonly string[], base: Date): Date | null => {
  for (let index = 0; index < words.length; index += 1) {
    const month = MONTHS.find(([pattern]) => pattern.test(words[index]!))?.[1]
    if (month === undefined) continue
    // "25 listopada", "22nd of November", "November 22nd"
    const ordinal = (word: string | undefined): number | null => {
      const m = /^(\d{1,2})(?:st|nd|rd|th)?$/u.exec(word ?? '')
      return m ? Number(m[1]) : null
    }
    const before = words[index - 1] === 'of' ? words[index - 2] : words[index - 1]
    const raw = ordinal(before) ?? ordinal(words[index + 1]) ?? (before ? numberWordValue(before) : null)
    const day = raw !== null && raw >= 1 && raw <= 31 ? raw : null
    if (day === null) {
      // "do końca listopada" / "w listopadzie": the last or first day of that month.
      const year = month < base.getMonth() ? base.getFullYear() + 1 : base.getFullYear()
      return words.includes('końca') || words.includes('konca') || words.includes('end') ? new Date(year, month + 1, 0) : new Date(year, month, 1)
    }
    const candidate = new Date(base.getFullYear(), month, day)
    return candidate < startOfDay(base) ? new Date(base.getFullYear() + 1, month, day) : candidate
  }
  return null
}

export const resolveDue = (due: string, base: Date): ResolvedDue | null => {
  const text = due.toLowerCase().replace(/[,;]/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!text) return null
  const words = text.split(' ')
  const today = startOfDay(base)
  let day: Date | null = null

  if (/(?:^|\s)(?:dzisiaj|dziś|dzis|today|tonight)(?=\s|$)/u.test(text)) day = today
  else if (/(?:^|\s)pojutrze(?=\s|$)/u.test(text)) day = addDays(today, 2)
  else if (/(?:^|\s)(?:jutro|tomorrow)(?=\s|$)/u.test(text)) day = addDays(today, 1)
  else if (/(?:koń\S*|kon\S*|end)\s+(?:of\s+(?:the\s+)?)?(?:miesiąc\S*|miesiac\S*|month)/u.test(text)) day = lastDayOfMonth(today)
  else if (/(?:koń\S*|kon\S*|end)\s+(?:of\s+(?:the\s+)?)?(?:tygodni\S*|week)/u.test(text)) day = addDays(today, (7 - today.getDay()) % 7)
  else if (/(?:początk\S*|poczatk\S*|beginning|start)\s+(?:of\s+(?:the\s+)?)?(?:miesiąc\S*|miesiac\S*|month)/u.test(text))
    day = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  else if (/(?:^|\s)(?:weekend\S*)/u.test(text)) day = nextWeekday(today, 6)
  else {
    const inDays = /(?:za|in)\s+(\d{1,2}|\p{L}+)\s+(dni|dzień|days?|tygodni\S*|tydzień|weeks?)/u.exec(text)
    const weekday = words.map((word) => WEEKDAYS.find(([pattern]) => pattern.test(word))?.[1]).find((value) => value !== undefined)
    if (inDays) {
      const count = /^\d+$/u.test(inDays[1]!) ? Number(inDays[1]) : numberWordValue(inDays[1]!) ?? 1
      day = addDays(today, /^(?:tydz|tygod|week)/u.test(inDays[2]!) ? count * 7 : count)
    } else if (/(?:^|\s)(?:za\s+tydzień|next\s+week)(?=\s|$)/u.test(text)) day = addDays(today, 7)
    else if (weekday !== undefined) {
      day = nextWeekday(today, weekday)
      // "w przyszły wtorek" said early in a week means the one after this week.
      if (/(?:przysz|next)/u.test(text) && isoWeek(day) === isoWeek(today)) day = addDays(day, 7)
    } else {
      day = monthDate(words, today)
      if (!day) {
        const dom = dayOfMonthOf(words)
        if (dom !== null) {
          const candidate = new Date(today.getFullYear(), today.getMonth(), dom)
          day = candidate < today ? new Date(today.getFullYear(), today.getMonth() + 1, dom) : candidate
        }
      }
    }
  }

  const clock = clockOf(text)
  const part = DAY_PARTS.find(([pattern]) => pattern.test(text))?.[1]
  const time = clock ?? (part !== undefined ? { hour: part, minute: 0 } : null)
  if (!day && !time) return null
  if (!day) {
    // A time alone: today if still ahead of the recording, otherwise tomorrow.
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), time!.hour, time!.minute)
    return { date: at > base ? at : new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, at.getHours(), at.getMinutes()), allDay: false }
  }
  if (!time) return { date: day, allDay: true }
  return { date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute), allDay: false }
}

export interface TaskDay {
  date: Date
  allDay: boolean
  // Start of the calendar day (ms).
  day: number
}

// A task's deadline as a calendar day, read relative to the note it came from.
// The single place that turns "Title — due" into a day: lists, groups and the chat use it.
export const resolveTaskDay = (taskText: string, noteCreatedAt: number | string | Date): TaskDay | null => {
  const { due } = splitTaskText(taskText)
  const resolved = due ? resolveDue(due, new Date(noteCreatedAt)) : null
  return resolved ? { date: resolved.date, allDay: resolved.allDay, day: startOfDay(resolved.date).getTime() } : null
}
