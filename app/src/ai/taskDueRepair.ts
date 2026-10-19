import { resolveDue } from '../tasks/taskDue'
import { numberWordValue, spokenClockForPrompt, wordsToDigits } from './polishNumbers'

// Deterministic repair of the deadline part of a task ("Title — due"). The app turns the
// due into a calendar date with resolveDue, so the due is rewritten into forms it understands
// ("piątek 10:00", "przed 9:00", "27 października") using the words of the cited sentence.

const REFERENCE = new Date(2026, 0, 7, 12, 0)
export const dueResolves = (due: string): boolean => resolveDue(due, REFERENCE) !== null

const WEEKDAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'] as const
const WEEKDAY_ROOTS: readonly (readonly [RegExp, number])[] = [
  [/^niedziel/u, 0], [/^poniedział/u, 1], [/^wtor/u, 2], [/^środ/u, 3], [/^czwart(?:ek|ku|kowi|kiem|k)$/u, 4],
  [/^piąt(?:ek|ku|kiem|k)$/u, 5], [/^sobot/u, 6],
]
// Garbled forms the model produces ('sobaty', 'wtork') still name the day by their first letters.
const WEEKDAY_FUZZY: readonly (readonly [RegExp, number])[] = [
  [/^nie[a-ząęó]{3,}$/u, 0], [/^pon[a-ząęó]{4,}$/u, 1], [/^wto[a-ząęó]{2,}$/u, 2], [/^śro[a-ząęó]*$/u, 3],
  [/^czw[a-ząęó]{3,}$/u, 4], [/^pią[a-ząęó]{2,}$/u, 5], [/^sob[a-ząęó]{2,}$/u, 6],
]
const weekdayIndex = (word: string): { index: number; exact: boolean } | null => {
  const exact = WEEKDAY_ROOTS.find(([pattern]) => pattern.test(word))
  if (exact) return { index: exact[1], exact: true }
  const fuzzy = /ego$/u.test(word) ? undefined : WEEKDAY_FUZZY.find(([pattern]) => pattern.test(word))
  return fuzzy ? { index: fuzzy[1], exact: false } : null
}
const MONTH_ROOTS: readonly (readonly [RegExp, string])[] = [
  [/^stycz/u, 'stycznia'], [/^lut/u, 'lutego'], [/^mar[cz]/u, 'marca'], [/^kwie/u, 'kwietnia'], [/^maj/u, 'maja'],
  [/^czerw/u, 'czerwca'], [/^lip/u, 'lipca'], [/^sierp/u, 'sierpnia'], [/^wrze/u, 'września'],
  [/^paźdz/u, 'października'], [/^listop/u, 'listopada'], [/^grud/u, 'grudnia'],
]
const monthName = (word: string): string | null => MONTH_ROOTS.find(([pattern]) => pattern.test(word))?.[1] ?? null
const RELATIVE = new Set(['jutro', 'pojutrze', 'dzisiaj', 'dziś'])
const DAY_PARTS = ['rano', 'wieczorem', 'wieczór', 'południe', 'południu', 'południem']
const PREPS = new Set(['do', 'przed', 'od', 'po', 'najpóźniej', 'około', 'koło'])
const CLOCK_PREPS = new Set(['o', 'na', 'do', 'od', 'przed', 'po', 'około', 'koło', 'godz', 'godzinie', 'godzinę'])
const UNIT_AFTER = /^(?:zł|złot|euro|osób|osoby|dni|dzień|tygodn|godzin|minut|razy|raz|litr|kg|proc|%)/u

interface Token {
  text: string
  index: number
}
const tokens = (text: string): Token[] => [...text.toLowerCase().matchAll(/\d{1,2}:\d{2}|\d+|\p{L}+/gu)].map((m) => ({ text: m[0], index: m.index ?? 0 }))

// Numerals spoken as words become digits ('szesnastej piętnaście' -> '16:15').
// Ordinal day words left in a due ('czwartego wieczorem') become digits so the day can be matched.
const ordinalDigits = (text: string): string =>
  text.replace(/\p{L}+(?:ego|go)(?![\p{L}])/giu, (word) => {
    const value = numberWordValue(word)
    return value !== null && Number.isInteger(value) && value >= 1 && value <= 31 && !weekdayIndex(word.toLowerCase())?.exact ? String(value) : word
  })
export const digitView = (text: string): string => wordsToDigits(spokenClockForPrompt(text))

export interface Clock {
  hour: number
  minute: number
  prep: string | null
  lead: string | null
}
export interface When {
  weekdays: { index: number; word: string; exact: boolean; prep: string | null }[]
  relative: { word: string; prep: string | null }[]
  dates: { day: number; month: string | null }[]
  clocks: Clock[]
  loose: { value: number; prep: string | null }[]
  parts: string[]
}

export const whenOf = (text: string): When => {
  const toks = tokens(text)
  const when: When = { weekdays: [], relative: [], dates: [], clocks: [], loose: [], parts: [] }
  toks.forEach((tok, i) => {
    const prev = i > 0 ? toks[i - 1]!.text : null
    const next = i + 1 < toks.length ? toks[i + 1]!.text : ''
    const prep = prev && PREPS.has(prev) ? prev : null
    const clock = /^(\d{1,2}):(\d{2})$/u.exec(tok.text)
    if (clock) {
      when.clocks.push({ hour: Number(clock[1]), minute: Number(clock[2]), prep, lead: prev })
      return
    }
    if (/^\d+$/u.test(tok.text)) {
      const value = Number(tok.text)
      if (monthName(next)) when.dates.push({ day: value, month: monthName(next) })
      else if (value <= 31 && !UNIT_AFTER.test(next)) when.loose.push({ value, prep: prev && (PREPS.has(prev) || CLOCK_PREPS.has(prev)) ? prev : null })
      return
    }
    const wd = weekdayIndex(tok.text)
    if (wd) {
      when.weekdays.push({ index: wd.index, word: tok.text, exact: wd.exact, prep })
      return
    }
    if (RELATIVE.has(tok.text)) when.relative.push({ word: tok.text === 'dziś' ? 'dzisiaj' : tok.text, prep })
    else if (DAY_PARTS.includes(tok.text)) when.parts.push(tok.text === 'południe' || tok.text === 'południu' ? `${prev === 'po' ? 'po ' : prev === 'w' ? 'w ' : ''}${tok.text}` : tok.text)
  })
  return when
}

const pad = (value: number): string => String(value).padStart(2, '0')
const clockText = (clock: Clock, keepPrep: boolean): string => `${keepPrep && clock.prep ? `${clock.prep} ` : ''}${clock.hour}:${pad(clock.minute)}`

// Clock times the cited text states, in spoken order. `hourWords` = hours spoken as words or after
// a clock preposition (the caller's hourValues); it keeps dates ('na sobotę 24') out.
export type HourSet = (text: string) => ReadonlySet<number>
const CORRECTION = /\b(?:przesun|przełoż|jednak|zamiast|czekaj|poprawk|zmieni)/u
const sentenceClocks = (cited: string, hourWords: HourSet): Clock[] => {
  const view = digitView(cited)
  const toks = tokens(view)
  const spoken = hourWords(cited)
  const out: Clock[] = []
  toks.forEach((tok, i) => {
    const prev = i > 0 ? toks[i - 1]!.text : ''
    const clock = /^(\d{1,2}):(\d{2})$/u.exec(tok.text)
    if (clock) out.push({ hour: Number(clock[1]), minute: Number(clock[2]), prep: PREPS.has(prev) ? prev : null, lead: prev || null })
    else if (/^\d{1,2}$/u.test(tok.text) && CLOCK_PREPS.has(prev) && Number(tok.text) <= 24 && spoken.has(Number(tok.text)) && !monthName(toks[i + 1]?.text ?? '') && !UNIT_AFTER.test(toks[i + 1]?.text ?? ''))
      out.push({ hour: Number(tok.text) % 24, minute: 0, prep: PREPS.has(prev) ? prev : null, lead: prev || null })
  })
  const seen = new Set<string>()
  const distinct = out.filter((c) => {
    const key = `${c.hour}:${c.minute}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // 'miało być na dziewiątą, ale przesunęli na dziesiątą': the later time stands.
  return distinct.length > 1 && CORRECTION.test(cited.toLowerCase()) ? [out[out.length - 1]!] : distinct
}

// A clock that opens ('od ósmej') or books a table ('na dziewiątą') is not when the task is due.
const addableClock = (clock: Clock, title: string, cited: string): boolean => {
  if (clock.lead === 'od' || clock.lead === 'po') return false
  if (clock.lead === 'na') return !/^\p{L}+ć(?:\s|$)/u.test(title) || CORRECTION.test(cited.toLowerCase())
  return true
}
// 'do dwudziestego drugiego' / 'do 22' name a day; 'do trzydziestu' counts people.
const dayStated = (cited: string, prep: string): boolean =>
  new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${prep}\s+(?:\d{1,2}(?![\d:])|\p{L}+(?:ego|go))(?![\p{L}])`, 'iu').test(cited)

// Weekday and relative day words of a text, in spoken order.
const dayAnchors = (view: string): string[] =>
  tokens(view).flatMap((t) => {
    const wd = weekdayIndex(t.text)
    if (wd?.exact) return [WEEKDAY_NAMES[wd.index]!]
    return RELATIVE.has(t.text) ? [t.text === 'dziś' ? 'dzisiaj' : t.text] : []
  })
const CLOSING = /\b(?:zamyka|zamknięt|czynn|otwart|otwiera|do której)/u
const END_OF_WEEK = /^(do\s+)?końca\s+(?:tego\s+)?tygodnia$/iu
const END_OF_NEXT_WEEK = /^(?:do\s+)?końca\s+przyszłego\s+tygodnia$/iu

export interface DueTask {
  title: string
  due: string | null
  sourceIds: number[]
}

const MAX_TITLE_WORDS = 12
const TITLE_PART_TAIL = /\s+(rano|wieczorem|po południu)$/u
const DAY_PART_IN_DUE = /(?:rano|wieczor|południ)/u
const TITLE_CLOCK_TAIL = /\s+(?:o|na|do|od)\s+(\d{1,2}:\d{2})$/u

// Rewrites an odd due into a clear one. `cited` = text of the cited sentences.
export const repairDue = (title: string, due: string | null, cited: string, hourWords: HourSet, late = true): { title: string; due: string | null } => {
  if (!due) return { title, due }
  let text = due.trim()
  // 'Zadzwonić do Oli rano' + 'jutro', 'Wizyta o 8:00' + 'czwartek': the time of day belongs to the due.
  const partTail = TITLE_PART_TAIL.exec(title)
  if (partTail && late && !DAY_PART_IN_DUE.test(text) && !/\d{1,2}:\d{2}/u.test(text)) {
    return repairDue(title.slice(0, partTail.index).trim(), `${text} ${partTail[1]!}`, cited, hourWords, late)
  }
  const clockTail = TITLE_CLOCK_TAIL.exec(title)
  if (clockTail && late && !/\d{1,2}:\d{2}/u.test(text) && (whenOf(text).weekdays.length > 0 || whenOf(text).relative.length > 0)) {
    return repairDue(title.slice(0, clockTail.index).trim(), `${text} ${clockTail[1]!}`, cited, hourWords, late)
  }
  if (late && END_OF_WEEK.test(text)) return { title, due: 'do końca tygodnia' }
  if (late && END_OF_NEXT_WEEK.test(text)) return { title, due: 'do piątku przyszłego tygodnia' }
  const dueView = whenOf(ordinalDigits(digitView(text)))
  const said = whenOf(digitView(cited))
  const hours = sentenceClocks(cited, hourWords)
  const spokenHours = hourWords(cited)
  const hourSaid = (value: number): Clock | undefined =>
    hours.find((c) => c.hour === value || c.hour === value % 24) ?? (spokenHours.has(value) ? { hour: value % 24, minute: 0, prep: null, lead: null } : undefined)
  const looseHours = dueView.loose.filter((l) => hourSaid(l.value) && (l.prep === null || l.prep !== 'dnia'))
  // Day numbers: a bare number that the sentence states as a date, not as an hour.
  const looseDays = dueView.loose.filter(
    (l) => !looseHours.includes(l) && (said.dates.some((d) => d.day === l.value) || said.loose.some((v) => v.value === l.value)),
  )
  const garbled = dueView.loose.length > 0 && dueView.weekdays.length > 0
  const dateNoMonth = dueView.dates.length === 0 && looseDays.length > 0
  const singleHour = hours.length === 1 && addableClock(hours[0]!, title, cited) ? hours[0]! : null
  const needsClock =
    dueView.clocks.length === 0 &&
    looseHours.length === 0 &&
    dueView.parts.length === 0 &&
    (dueView.weekdays.length > 0 || dueView.relative.length > 0) &&
    singleHour !== null &&
    !CLOSING.test(cited.toLowerCase()) &&
    true
  // A clock or day part without a day: the day the sentence states (after a correction: the last one).
  const dayless = dueView.weekdays.length === 0 && dueView.relative.length === 0 && dueView.dates.length === 0 && (dueView.clocks.length > 0 || dueView.parts.length > 0 || looseHours.length > 0) && dueView.clocks.length + dueView.parts.length <= 1
  const spokenDays = dayAnchors(digitView(cited))
  const sentenceDay = dayless && spokenDays.length > 0 && (spokenDays.length === 1 || CORRECTION.test(cited.toLowerCase())) ? spokenDays[spokenDays.length - 1]! : null
  // A month the sentence never said ('26 października' for 'w poniedziałek dwudziestego szóstego'): keep the day number only.
  const monthUnsaid = dueView.dates.some((d) => d.month !== null && !said.dates.some((x) => x.month === d.month) && !cited.toLowerCase().includes(d.month.slice(0, 4)))
  // '22 dwudziestego' for 'do dwudziestego drugiego': two numbers, the sentence says which one is the day.
  const stated = dueView.loose.length >= 2 && !dueView.weekdays.length && !dueView.relative.length && !dueView.clocks.length
    ? dueView.loose.map((l) => said.loose.find((v) => v.value === l.value && v.prep !== null && dayStated(cited, v.prep))).find((v) => v !== undefined)
    : undefined
  const resolvable = dueResolves(text)
  const worth = sentenceDay !== null || monthUnsaid || stated !== undefined || !resolvable || garbled || looseHours.length > 0 || needsClock || (dateNoMonth && said.dates.some((d) => d.month))
  if (worth) {
    const pieces: string[] = []
    const weekday = dueView.weekdays[0]
    const relative = dueView.relative[0]
    if (stated) pieces.push(`${stated.prep} ${stated.value}`)
    if (!weekday && !relative && sentenceDay) pieces.push(sentenceDay)
    if (monthUnsaid) {
      const day = dueView.dates[0]!.day
      const spokenWeekday = said.weekdays.find((w) => w.exact)
      if (!weekday && spokenWeekday) pieces.push(WEEKDAY_NAMES[spokenWeekday.index]!)
      if (said.loose.some((v) => v.value === day)) pieces.push(String(day))
    }
    if (weekday) {
      const word = weekday.exact ? weekday.word : WEEKDAY_NAMES[weekday.index]!
      pieces.push(`${weekday.prep ? `${weekday.prep} ` : ''}${weekday.prep ? word : WEEKDAY_NAMES[weekday.index]!}`)
    } else if (relative) pieces.push(`${relative.prep ? `${relative.prep} ` : ''}${relative.word}`)
    const date = monthUnsaid ? null : dueView.dates[0] ?? (looseDays[0] ? { day: looseDays[0].value, month: said.dates.find((d) => d.day === looseDays[0]!.value)?.month ?? null } : null)
    if (date) pieces.push(date.month ? `${date.day} ${date.month}` : weekday ? String(date.day) : '')
    let clock: Clock | null = dueView.clocks[0] ?? null
    if (!clock && looseHours[0]) clock = { hour: looseHours[0].value % 24, minute: hourSaid(looseHours[0].value)?.minute ?? 0, prep: looseHours[0].prep && PREPS.has(looseHours[0].prep) ? looseHours[0].prep : null, lead: looseHours[0].prep }
    if (!clock && needsClock) clock = singleHour
    if (clock) pieces.push(clockText(clock, true))
    else if (dueView.parts[0]) pieces.push(dueView.parts[0])
    // 'środa 21 11:00' reads as one number: a comma separates the day number from the hour.
    const rebuilt = pieces.filter(Boolean).join(' ').trim().replace(/(?<=(?:^|\s)\d{1,2}) (?=\d{1,2}:\d{2})/u, ', ')
    if (rebuilt && dueResolves(rebuilt) && (pieces.length > 1 || !resolvable)) text = rebuilt
  }
  if (late && !dueResolves(text)) {
    // 'po antybiotyku', 'przed wyjazdem do mamy', 'przez 10 dni': a condition, not a date.
    const merged = `${title} ${text}`
    if (!/\d{1,2}:\d{2}/u.test(text) && merged.split(/\s+/u).length <= MAX_TITLE_WORDS + 3) return { title: merged, due: null }
  }
  return { title, due: text }
}

// The day word sits within a few words of a title word, with no other infinitive in between.
const anchoredNear = (view: string, stems: ReadonlySet<string>, verb: string): boolean => {
  const toks = tokens(view).map((t) => t.text)
  const anchors = toks.flatMap((w, i) => (RELATIVE.has(w) || weekdayIndex(w)?.exact ? [i] : []))
  return anchors.some((a) =>
    toks.some((w, i) => {
      if (!stems.has(w.slice(0, 4)) || w.length < 4 || Math.abs(i - a) > 5) return false
      const [from, to] = i < a ? [i + 1, a] : [a + 1, i]
      return !toks.slice(from, to).some((x) => x.length > 4 && x.endsWith('ć') && x.slice(0, 5) !== verb)
    }),
  )
}

// A day said once in a one-sentence task ('Kupić kwiaty w czwartek po pracy') that the model left out.
export const inferDue = (title: string, cited: string, hourWords: HourSet): string | null => {
  const view = digitView(cited)
  const when = whenOf(view)
  const days = new Set<string>([...when.weekdays.filter((w) => w.exact).map((w) => `w${w.index}`), ...when.relative.map((r) => r.word)])
  if (days.size !== 1 || when.dates.length > 0) return null
  if (when.weekdays.some((w) => title.toLowerCase().includes(w.word.slice(0, 5))) || when.relative.some((r) => title.toLowerCase().includes(r.word))) return null
  const stems = new Set((title.toLowerCase().split(/\s+/u).slice(1).join(' ').match(/\p{L}{4,}/gu) ?? []).map((w) => w.slice(0, 4)))
  if (!stems.size || !anchoredNear(view, stems, (title.toLowerCase().match(/\p{L}+/u) ?? [''])[0]!.slice(0, 5))) return null
  const hours = sentenceClocks(cited, hourWords)
  const weekday = when.weekdays.find((w) => w.exact)
  const day = weekday ? `${weekday.prep ? `${weekday.prep} ` : ''}${weekday.prep ? weekday.word : WEEKDAY_NAMES[weekday.index]!}` : when.relative[0]!.word
  const part = when.parts.length === 1 ? when.parts[0]! : null
  if (hours.length === 1 && addableClock(hours[0]!, title, cited) && !CLOSING.test(cited.toLowerCase())) return `${day} ${clockText(hours[0]!, true)}`
  return part ? `${day} ${part}` : day
}
