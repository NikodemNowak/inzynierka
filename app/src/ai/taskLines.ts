import type { Language } from '../i18n/language'
import { recordGeneration } from './generationMetrics'
import { generate, getContextWindowSize, measureFormattedPromptTokens } from './llm'
import { throwIfProcessingAborted, type ProcessingExecutionContext } from './processingContext'
import { numberSpans } from './polishNumbers'
import { noteSourceSystem, sourceFirstPrompt } from './sharedSourcePrompt'

// Single-call task extractor: one batched pass over the candidate sentences of
// a note, then deterministic guards. Polish only (the pre-filter, the numeral
// parser and the guards are Polish); for 'en' it returns an empty result and
// the existing pipeline stays the fallback.

export interface TaskLine {
  title: string
  due: string | null
  sourceIds: number[]
}
export interface TaskLinesResult {
  tasks: TaskLine[]
  rendered: string[]
  warnings: string[]
}
interface Unit {
  readonly id: number
  readonly text: string
}
// A parsed task; modelIds keeps the sentences the model cited before the
// guards widen sourceIds to neighbours.
export interface TaskDraft extends TaskLine {
  modelIds: number[]
}
export interface RejectedTask {
  title: string
  due: string | null
  reason: string
}
interface GuardResult {
  kept: TaskDraft[]
  rejected: RejectedTask[]
}

// ---------------------------------------------------------------- regex helpers
// JS \w and \b are ASCII-only. Sources are written with Python-style \w and \b
// and expanded to Unicode-aware lookarounds.
const WORD = '[\\p{L}\\p{N}_]'
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`
const rx = (source: string, flags = ''): RegExp =>
  new RegExp(source.replace(/\\b/g, BOUNDARY).replace(/\\w/g, WORD), `${flags}u`)
const NON_WORD = /[^\p{L}\p{N}_]/gu
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stripChars = (text: string, chars: string, left = true, right = true): string => {
  let start = 0
  let end = text.length
  if (left) while (start < end && chars.includes(text.charAt(start))) start += 1
  if (right) while (end > start && chars.includes(text.charAt(end - 1))) end -= 1
  return text.slice(start, end)
}
const sortedUnique = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b)
const isSubset = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => [...a].every((x) => b.has(x))
const isUpperChar = (ch: string): boolean => ch !== '' && ch !== ch.toLowerCase() && ch === ch.toUpperCase()

// ---------------------------------------------------------------- Polish numerals
const EXACT = new Map<string, number>(
  Object.entries({
    jeden: 1, jedna: 1, jedno: 1, jednego: 1, jednej: 1, jednym: 1, jedną: 1, jednemu: 1,
    dwa: 2, dwie: 2, dwóch: 2, dwu: 2, dwoma: 2, dwom: 2, dwiema: 2,
    trzy: 3, trzech: 3, trzema: 3, trzem: 3, cztery: 4, czterech: 4, czterema: 4,
    pięć: 5, pięciu: 5, pięcioma: 5, sześć: 6, sześciu: 6, siedem: 7, siedmiu: 7,
    osiem: 8, ośmiu: 8, dziewięć: 9, dziewięciu: 9, dziesięć: 10, dziesięciu: 10,
    sto: 100, stu: 100, dwieście: 200, dwustu: 200, trzysta: 300, trzystu: 300,
    czterysta: 400, czterystu: 400, pięćset: 500, pięciuset: 500, sześćset: 600, sześciuset: 600,
    siedemset: 700, siedmiuset: 700, osiemset: 800, ośmiuset: 800, dziewięćset: 900,
    dziewięciuset: 900, pół: 0.5, półtora: 1.5,
    tysiąc: 1000, tysiąca: 1000, tysiące: 1000, tysięcy: 1000, tysiącem: 1000,
    zero: 0,
  }),
)
const PREFIX: [string, number][] = Object.entries({
  pierwsz: 1, drug: 2, trzec: 3, czwart: 4, piąt: 5, szóst: 6, siódm: 7, ósm: 8, dziewiąt: 9,
  dziesiąt: 10, jedenast: 11, jedenaście: 11, dwunast: 12, dwanaście: 12, trzynast: 13, trzynaście: 13,
  czternast: 14, czternaście: 14, piętnast: 15, piętnaście: 15, szesnast: 16, szesnaście: 16,
  siedemnast: 17, siedemnaście: 17, osiemnast: 18, osiemnaście: 18, dziewiętnast: 19,
  dziewiętnaście: 19, dwadzieścia: 20, dwudziest: 20, trzydzieści: 30, trzydziest: 30,
  czterdzieści: 40, czterdziest: 40, pięćdziesiąt: 50, pięćdziesięciu: 50, sześćdziesiąt: 60,
  sześćdziesięciu: 60, siedemdziesiąt: 70, siedemdziesięciu: 70, osiemdziesiąt: 80,
  osiemdziesięciu: 80, dziewięćdziesiąt: 90, dziewięćdziesięciu: 90, setn: 100,
}).sort((a, b) => b[0].length - a[0].length)
const NOT_NUM = /^(?:czwart(?:ek|ku|kowi|kiem)|czwartk|piąt(?:ek|ku|kiem)|piątk|drugorzęd|setk)/u

export const wordValue = (word: string): number | null => {
  const w = word.toLowerCase()
  const exact = EXACT.get(w)
  if (exact !== undefined) return exact
  if (NOT_NUM.test(w)) return null
  for (const [prefix, value] of PREFIX) if (w.startsWith(prefix)) return value
  return null
}

const seqValue = (values: readonly number[]): number => {
  let total = 0
  let cur = 0
  for (const v of values) {
    if (v === 1000) {
      cur = (cur || 1) * 1000
      total += cur
      cur = 0
    } else cur += v
  }
  return total + cur
}

const wordTokens = (text: string): string[] => text.match(/\p{L}+|\d+/gu) ?? []
const lettersOnly = (text: string): string[] => text.toLowerCase().match(/\p{L}+/gu) ?? []

// All numeric values plausibly spoken in the text (words or digits).
export const sourceNumbers = (text: string): Set<number> => {
  const vals = new Set<number>()
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/gu)) {
    vals.add(Number(m[0].replace(',', '.')))
    for (const part of m[0].split(/[.,]/u)) vals.add(Number(part))
  }
  const lower = text.toLowerCase()
  const toks = wordTokens(lower)
  let i = 0
  while (i < toks.length) {
    if (wordValue(toks[i]!) === null) {
      i += 1
      continue
    }
    const seq: number[] = []
    while (i < toks.length) {
      const v = wordValue(toks[i]!)
      if (v !== null) {
        seq.push(v)
        i += 1
      } else if (toks[i] === 'i' && i + 1 < toks.length && toks[i + 1] === 'pół') i += 1
      else break
    }
    for (let a = 0; a < seq.length; a += 1)
      for (let b = a + 1; b <= seq.length; b += 1) vals.add(seqValue(seq.slice(a, b)))
  }
  for (const m of lower.matchAll(rx(String.raw`wpół do (\w+)`, 'g'))) {
    const v = wordValue(m[1]!)
    if (v) {
      vals.add(v - 1)
      vals.add(30)
    }
  }
  if (lower.includes('pół') || lower.includes('połow')) for (const v of [0.5, 5, 30]) vals.add(v)
  if (lower.includes('kwadrans')) for (const v of [15, 45]) vals.add(v)
  return vals
}

// Numbers written by the model as digits: '14:00' -> [14]; '1 200' -> [1200]; '38,5' -> [38.5].
export const taskNumbers = (text: string): number[] => {
  const out: number[] = []
  const compact = text.replace(/(?<=\d) (?=\d{3}(?![\p{L}\p{N}_]))/gu, '')
  const pushParts = (s: string): void => {
    for (const p of s.split(/[.,:]/u)) if (/^\d+$/u.test(p) && Number(p) !== 0) out.push(Number(p))
  }
  for (const m of compact.matchAll(/\d+(?:[.,:]\d+)*/gu)) {
    const s = m[0]
    if (s.includes(':')) pushParts(s)
    else if (
      /^\d+[.,]\d+$/u.test(s) &&
      s.includes(',') &&
      (s.split(',').pop() ?? '').split('.').pop()!.length <= 2
    )
      out.push(Number(s.replace(',', '.')))
    else pushParts(s)
  }
  return out
}

export const numbersAnchored = (taskText: string, citedText: string): number[] => {
  const have = sourceNumbers(citedText)
  const bad: number[] = []
  for (const n of taskNumbers(taskText)) {
    if (have.has(n)) continue
    if (!Number.isInteger(n) && have.has(Math.trunc(n)) && have.has(0.5)) continue
    bad.push(n)
  }
  return bad
}

// ---------------------------------------------------------------- dates, clock
const MONTH_GROUPS: string[][] = [
  ['stycz'], ['luty', 'lutego', 'lutym'], ['marzec', 'marca', 'marcu'], ['kwiet'], ['maj', 'maja', 'maju'],
  ['czerw'], ['lipiec', 'lipca', 'lipcu'], ['sierp'], ['wrze'], ['paźdz'], ['listop'], ['grud'],
]
// 'czwartego' / 'piątego' are ordinals (4th/5th), not Thursday/Friday.
const DAYS: string[][] = [
  ['poniedz'], ['wtor', 'wtork'], ['środ'], ['czwartek', 'czwartk'], ['piątek', 'piątk'], ['sobot'], ['niedziel'],
]
const REL: string[][] = [['jutr'], ['dziś', 'dzisiaj', 'dzisiejsz'], ['weekend'], ['pojutrz']]
const STOP = new Set(
  ('który która które jest będzie mieć bardzo przez jako tylko także jeśli żeby oraz albo przed potem razem ' +
    'najlepiej jeszcze trzeba muszę zrobić sprawdzić').split(' '),
)
const GENERIC = new Set(
  ('zrobić zrobi zrobię trzeba muszę musze mam mamy kupić sprawdzić zadzwonić wysłać jutro piątek piątku ' +
    'wtorek środa środę czwartek sobota sobotę niedziela niedzielę poniedziałek rano wieczorem przed').split(' '),
)
const APPT_NOUNS = [
  'wizyta', 'spotkanie', 'kontrola', 'wymiana', 'prezentacja', 'rozmowa', 'badanie', 'szczepienie',
  'zebranie', 'egzamin', 'kolokwium', 'odbiór', 'wizytę', 'termin',
]
const ORDINAL_PIATY = /^piąt(?:y|ego|ej|ym|a|ą)$/u

const groupHits = (words: readonly string[], groups: readonly string[][]): Set<number> => {
  const hits = new Set<number>()
  groups.forEach((group, index) => {
    if (words.some((w) => group.some((p) => w === p || (p.length >= 4 && w.startsWith(p))))) hits.add(index)
  })
  return hits
}

export const dateWordsUnanchored = (taskText: string, citedText: string): string[] => {
  const tw = lettersOnly(taskText)
  const cw = lettersOnly(citedText)
  const bad: string[] = []
  const sets: [string[][], string][] = [[MONTH_GROUPS, 'month'], [DAYS, 'day'], [REL, 'rel']]
  for (const [groups, name] of sets) {
    const th = groupHits(tw.filter((w) => !ORDINAL_PIATY.test(w)), groups)
    const ch = groupHits(cw, groups)
    for (const h of th) if (!ch.has(h)) bad.push(`${name}:${groups[h]![0]}`)
  }
  return bad
}

// Clock hours spoken in the text: feminine ordinals ('o ósmej', 'szesnastej piętnaście'), digits after
// 'o'/'na'/'godz', 'wpół do'. Dates ('dwudziestego trzeciego') are excluded.
export const hourValues = (text: string): Set<number> => {
  const vals = new Set<number>()
  const toks = text.toLowerCase().match(/\p{L}+|\d+(?::\d+)?/gu) ?? []
  const hourPreps = ['o', 'na', 'godz', 'godzina', 'godzinie', 'od', 'do', 'między', 'a']
  let i = 0
  while (i < toks.length) {
    const w = toks[i]!
    if (/^\d+:\d+$/u.test(w)) {
      vals.add(Number(w.split(':')[0]))
      i += 1
      continue
    }
    if (/^\d+$/u.test(w) && i > 0 && hourPreps.includes(toks[i - 1]!)) {
      vals.add(Number(w))
      i += 1
      continue
    }
    const v = wordValue(w)
    if (v !== null && Number.isInteger(v) && v > 0 && v <= 24 && /(?:ej|ą)$/u.test(w)) {
      const seq = [v]
      let j = i + 1
      while (j < toks.length) {
        const v2 = wordValue(toks[j]!)
        if (v2 !== null && v2 < 10 && /(?:ej|ą)$/u.test(toks[j]!) && seq[seq.length - 1]! >= 20) {
          seq.push(Math.trunc(v2))
          j += 1
        } else break
      }
      vals.add(seq.reduce((a, b) => a + b, 0))
      i = j
      continue
    }
    if (w === 'wpół' && i + 2 < toks.length) {
      const v3 = wordValue(toks[i + 2]!)
      if (v3) vals.add(Math.trunc(v3) - 1)
    }
    if (w === 'południe' || w === 'południa') vals.add(12)
    if (w === 'północ' || w === 'północy') {
      vals.add(24)
      vals.add(0)
    }
    i += 1
  }
  return vals
}

export const clockUnanchored = (taskText: string, citedText: string): string[] => {
  const hv = hourValues(citedText)
  const bad: string[] = []
  for (const m of taskText.matchAll(rx(String.raw`\b(\d{1,2}):(\d{2})\b`, 'g')))
    if (!hv.has(Number(m[1]))) bad.push(m[0])
  return bad
}

// ---------------------------------------------------------------- text helpers
const cstems = (text: string): Set<string> =>
  new Set(lettersOnly(text).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)).map((w) => w.slice(0, 4)))

// A glued infinitive ('Dokupićubezpieczenie') is a rare tokenizer glitch.
const fixGlued = (title: string): string => {
  const space = title.indexOf(' ')
  const head = space < 0 ? title : title.slice(0, space)
  const tail = space < 0 ? null : title.slice(space + 1)
  const m = rx(String.raw`^(\w{3,}?(?:ić|ać|eć|yć|uć|ść|źć))(\w{4,})$`).exec(head)
  if (m && wordValue(head) === null) return `${m[1]} ${m[2]}${tail !== null ? ` ${tail}` : ''}`
  return title
}

// At least one >=4-letter word of the title shares a 4-letter prefix with the cited text.
const contentAnchor = (title: string, cited: string): boolean => {
  const cw = new Set(lettersOnly(cited).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)))
  const tw = lettersOnly(title).filter((w) => w.length >= 4 && !STOP.has(w))
  if (!tw.length) return false
  return tw.some((w) => cw.has(w.slice(0, 4)))
}

const TEMPORAL = rx(
  String.raw`(\d{1,2}:\d\d|\b\d{1,2}\b(?!\s*(zł|złotych|euro|€|osób|os\.|%|g\b|kg|litr))|jutr|dziś|dzisiaj|pojutrz|weekend|poniedz|wtor|środ|czwart|piąt|sobot|niedziel|stycz|luty|lutego|marc|kwiet|\bmaj|czerw|lipc|lipiec|sierp|wrześ|paźdz|listop|grud|tydz|tygod|miesią|rano|wieczor|południ|końca|najpóźniej|\bprzed\b|^do\b|^od\b|przez (\d|tydz|tyg|miesi|dni|cał|czas)|codzienn|dziennie|godzin|wiosn|latem|jesieni|zim|święt|\brok|\bdni\b|\bdzień\b|\bza\s+\w+\s+(dni|tygodni\w*|miesi\w*))`,
  'i',
)
const COND = rx(String.raw`^(jeśli|jeżeli|jak|gdy|gdyby|chyba że)\b`, 'i')
const MONTH_WORD = /^(?:stycz|lut|marc|kwiet|maj|czerw|lip|sierp|wrze|paźdz|listop|grud)/iu
const CLOCK_PREP = ['o', 'na', 'do', 'od', 'około', 'koło', 'godz']
const DATE_PREP = ['do', 'od', 'przed', 'o', 'na', 'godz', 'po', 'około', 'koło', 'dnia']
const COUNT_ONLY = /^\s*\d+\s*(?:zł|złotych|euro|€|osób)?\s*$/u

const isOrdinalWord = (w: string): boolean => !EXACT.has(w) && /(?:ego|ej|ą)$/u.test(w) && wordValue(w) !== null

// Replace spoken numerals with digits; the value is computed from the words, so it stays anchored in the
// source. Ordinal adjectives ('drugą subskrypcję') stay words outside a date/time context.
export const wordsToDigits = (text: string): string => {
  const toks = text.split(/(\s+)/u)
  const clean = (token: string): string => token.toLowerCase().replace(NON_WORD, '')
  const out: string[] = []
  let i = 0
  while (i < toks.length) {
    const w = toks[i]!
    const lw = clean(w)
    const v = lw ? wordValue(lw) : null
    if (v === null || lw === 'pół' || lw === 'zero') {
      out.push(w)
      i += 1
      continue
    }
    const seq = [v]
    const words = [lw]
    let j = i + 2
    while (j < toks.length) {
      const lw2 = clean(toks[j]!)
      const v2 = lw2 ? wordValue(lw2) : null
      if (v2 === null || lw2 === 'pół') break
      seq.push(v2)
      words.push(lw2)
      j += 2
    }
    const last = words[words.length - 1]!
    const ordinal = isOrdinalWord(last) || (/(?:gi|ga|gie|ci|cia|cie|y|a|e|ą|ym)$/u.test(last) && !EXACT.has(last))
    const prev = out.length >= 2 ? clean(out[out.length - 2]!) : ''
    const next = j < toks.length ? clean(toks[j]!) : ''
    if (ordinal && !(DATE_PREP.includes(prev) || MONTH_WORD.test(next))) {
      out.push(...toks.slice(i, j - 1))
      i = j - 1
      continue
    }
    const val = seqValue(seq)
    const trail = toks[j - 2]!.replace(rx(String.raw`^\w+`), '')
    let num = String(val)
    if (CLOCK_PREP.includes(prev) && ordinal && val <= 24 && (prev === 'o' || prev === 'na' || /ej$/u.test(last)))
      num = `${Math.trunc(val)}:00`
    out.push(num + trail)
    i = j - 1
  }
  return out.join('')
}

// 'trzydziestu', 'dwieście na drobne', '50 zł' is an amount/count, not a deadline.
const dueIsCount = (due: string): boolean => {
  const nums = lettersOnly(due).filter((w) => wordValue(w) !== null)
  if (TEMPORAL.test(due) && !COUNT_ONLY.test(due)) return false
  if (nums.some(isOrdinalWord)) return false
  return nums.length > 0 || /\d/u.test(due)
}

// ---------------------------------------------------------------- parsing
// The model sometimes writes an imperative or gerund title ('Wyślij wyniki', 'Wzywając serwisanta').
const IMPERATIVES: Readonly<Record<string, string>> = {
  wyślij: 'wysłać', pokaż: 'pokazać', zrób: 'zrobić', sprawdź: 'sprawdzić', zadzwoń: 'zadzwonić',
  napisz: 'napisać', zapłać: 'zapłacić', kup: 'kupić', popraw: 'poprawić', odbierz: 'odebrać',
  zamów: 'zamówić', umów: 'umówić', wymień: 'wymienić', oddaj: 'oddać', wpłać: 'wpłacić',
  zabierz: 'zabrać', weź: 'wziąć', dokończ: 'dokończyć', skończ: 'skończyć', ćwicz: 'ćwiczyć',
  odłóż: 'odłożyć', usuń: 'usunąć', dopisz: 'dopisać', zapisz: 'zapisać', ustaw: 'ustawić',
  odnów: 'odnowić', przelej: 'przelać', przepisz: 'przepisać', przejrzyj: 'przejrzeć', wydrukuj: 'wydrukować',
  piszę: 'napisać', pisze: 'napisać', przygotuj: 'przygotować', zarezerwuj: 'zarezerwować', skopiuj: 'skopiować', wyślę: 'wysłać',
}
export const toInfinitive = (title: string): string => {
  const space = title.indexOf(' ')
  const first = space < 0 ? title : title.slice(0, space)
  const tail = space < 0 ? '' : title.slice(space)
  const lower = first.toLowerCase()
  let verb = IMPERATIVES[lower]
  if (!verb && lower.length >= 6 && /^\p{L}+$/u.test(lower)) {
    if (/ując$/u.test(lower)) verb = `${lower.slice(0, -4)}ować`
    else if (/ając$/u.test(lower)) verb = `${lower.slice(0, -4)}ać`
    else if (/(?:uj|aj)$/u.test(lower)) verb = lower.endsWith('uj') ? `${lower.slice(0, -2)}ować` : `${lower.slice(0, -2)}ać`
  }
  if (!verb) return title
  return verb.charAt(0).toUpperCase() + verb.slice(1) + tail
}

export const splitTitleDue = (text: string): { title: string; due: string | null } => {
  const body = stripChars(stripChars(text.trim(), '"„”'), '.', false, true).trim()
  let title: string
  let due: string | null
  const sep = /\s+[—–-]{1,2}\s+/u.exec(body)
  if (sep) {
    title = body.slice(0, sep.index).trim()
    due = body.slice(sep.index + sep[0].length).trim()
    if (['', 'brak', 'bez terminu', '-', 'brak terminu', 'nie podano', 'none'].includes(due.toLowerCase())) due = null
  } else {
    const paren = /^(.*?)\s*\((.+)\)\s*$/u.exec(body)
    if (paren) {
      title = paren[1]!.trim()
      due = paren[2]!.trim()
    } else {
      title = body
      due = null
    }
  }
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1)
  return { title, due }
}

// 'Czynność — zarezerwować nocleg – piątek': the real title/due sit in the remainder.
const repairPlaceholder = (t: TaskDraft): TaskDraft => {
  if (!t.due || !['czynność', 'zadanie'].includes(stripChars(t.title.trim().toLowerCase(), ':', false, true))) return t
  const { title, due } = splitTitleDue(t.due.replace(/\s+[–-]\s+/gu, ' — '))
  if ((title && title.toLowerCase() !== t.due.toLowerCase()) || due) return { ...t, title, due }
  return { ...t, title: t.due, due: null }
}

// The model sometimes puts non-temporal details after the dash: move them into the title or drop them.
export const cleanDue = (t: TaskDraft): TaskDraft => {
  if (!t.due) return t
  const d = stripChars(t.due.trim(), ',;')
  if (/\btemu\b/iu.test(d)) return { ...t, due: null }
  if (COND.test(d)) return { ...t, title: `${t.title}, ${d}`, due: null }
  if (TEMPORAL.test(d) || lettersOnly(d).some((w) => wordValue(w) !== null)) return { ...t, due: d }
  if (/\d/u.test(d)) return { ...t, title: `${t.title} ${d}`, due: null }
  return { ...t, due: null }
}

const LINE = /^\s*\[(\d+)\]\s*(.*?)\s*$/u
export const parseTaskLines = (text: string, allowed: ReadonlySet<number>): TaskDraft[] => {
  const out: TaskDraft[] = []
  for (const line of text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u)) {
    const m = LINE.exec(line)
    if (!m) continue
    const id = Number(m[1])
    if (!allowed.has(id)) continue
    const body = m[2]!.trim()
    if (!body || ['-', '—', '–'].includes(body) || body.toUpperCase().startsWith('BRAK') || body.startsWith('- ')) continue
    for (const part of body.split('|')) {
      const { title, due } = splitTitleDue(part)
      if (title && title !== '-') out.push(cleanDue(repairPlaceholder({ title, due, sourceIds: [id], modelIds: [] })))
    }
  }
  return out
}

// ---------------------------------------------------------------- guards
// A bare nominative month ('wrzesień') is a leaked detail ('faktura za wrzesień'), not a deadline.
const BARE_MONTH = /^(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień)$/iu

export const tidyTask = (t: TaskDraft): TaskDraft => {
  let title = toInfinitive(fixGlued(t.title.replace(/[\s—–\-:,;]+$/u, '').trim()))
  title = title.replace(rx(String.raw`\s+\b(z|u|do|na|w|we|o|dla|i)$`, 'i'), '')
  let due: string | null = t.due ? stripChars(t.due, ' -—–.,') || null : null
  if (due && dueIsCount(due)) {
    title = `${title} ${wordsToDigits(due)}`
    due = null
  }
  if (due && BARE_MONTH.test(due)) due = null
  title = wordsToDigits(title)
  if (due) due = wordsToDigits(due)
  return { ...t, title: title.charAt(0).toUpperCase() + title.slice(1), due }
}

// 'Czynność', 'Nie ...' and '<Name> <infinitive>' (another person's task) are not the author's tasks.
const isActionish = (title: string): boolean => {
  const w = lettersOnly(title)
  if (!w.length) return false
  if (w[0] === 'nie') return false
  if (['czynność', 'zadanie', 'termin', 'brak'].includes(w[0]!)) return false
  const endsInfinitive = (x: string): boolean => /(?:ć|c)$/u.test(x)
  if (
    w.length > 1 &&
    isUpperChar(Array.from(title.trim().split(/\s+/u)[0]!)[0] ?? '') &&
    !endsInfinitive(w[0]!) &&
    !APPT_NOUNS.includes(w[0]!) &&
    endsInfinitive(w[1]!)
  )
    return false
  const hasInf = w.some((x) => (endsInfinitive(x) && x.length > 3) || ['być', 'iść', 'jeść', 'nieść'].includes(x))
  if (w.includes('nie') && !hasInf) return false
  return hasInf || APPT_NOUNS.includes(w[0]!) || w.filter((x) => x.length >= 4).length >= 2
}

// Merge tasks whose content words are (almost) contained in another task.
const mergeSimilar = (tasks: readonly TaskDraft[]): TaskDraft[] => {
  const out: TaskDraft[] = []
  for (const t of tasks) {
    const ts = cstems(t.title)
    let merged = false
    for (let index = 0; index < out.length; index += 1) {
      const o = out[index]!
      const os = cstems(o.title)
      if (!ts.size || !os.size) continue
      const inter = [...ts].filter((x) => os.has(x)).length
      const sameVerb = lettersOnly(t.title)[0] === lettersOnly(o.title)[0]
      const sharedAmount = taskNumbers(t.title).some((n) => n >= 10 && taskNumbers(o.title).includes(n))
      if ((inter / Math.min(ts.size, os.size) >= 0.67 && sameVerb) || (sharedAmount && inter >= 1) || isSubset(ts, os) || isSubset(os, ts)) {
        const [keep, drop] = os.size >= ts.size ? [o, t] : [t, o]
        out[index] = {
          ...o,
          title: keep.title,
          due: keep.due || drop.due || null,
          sourceIds: sortedUnique([...o.sourceIds, ...t.sourceIds]),
        }
        merged = true
        break
      }
    }
    if (!merged) out.push({ ...t })
  }
  return out
}

// 'Pokazać 3 rzeczy', 'Zakończyć zadania': the object says nothing.
const VAGUE_WORDS = new Set(['rzeczy', 'rzecz', 'sprawy', 'sprawę', 'zadania', 'zadanie', 'kilka', 'kilku', 'parę'])
export const isVagueTitle = (title: string): boolean => {
  if (/^\p{L}+,\s*(?:jeśli|jeżeli|gdy|gdyby)\b/iu.test(title)) return true
  const w = lettersOnly(title).slice(1)
  return w.length > 0 && w.every((x) => VAGUE_WORDS.has(x) || wordValue(x) !== null) && w.some((x) => VAGUE_WORDS.has(x))
}
// 'Spotkanie z Oliwią, dentysta i serwisant': a summary of several events, each stated on its own elsewhere.
export const isMergedEvents = (title: string): boolean => {
  const first = lettersOnly(title)[0] ?? ''
  return APPT_NOUNS.includes(first) && (title.match(/,|\s(?:i|oraz)\s/gu) ?? []).length >= 2
}

// 'Wracam w niedzielę', 'Jadę do rodziców': a plan stated in the first person, not a task phrased as one.
const FINITE_VERB = /^(?:wracam|jadę|idę|robię|piszę|wysyłam|poprawiam|kończę|odpoczywam|ćwiczę|ograniczam|wzywam|zaczynam)$/iu

export const finalizeTasks = (tasks: readonly TaskDraft[]): GuardResult => {
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    if (isVagueTitle(t.title)) rejected.push({ title: t.title, due: t.due, reason: 'vague' })
    else if (isMergedEvents(t.title)) rejected.push({ title: t.title, due: t.due, reason: 'merged events' })
    else if (FINITE_VERB.test(t.title.split(/\s+/u)[0] ?? '')) rejected.push({ title: t.title, due: t.due, reason: 'finite verb' })
    else if (isActionish(t.title)) kept.push(t)
    else rejected.push({ title: t.title, due: t.due, reason: 'not an action' })
  }
  return { kept: mergeSimilar(kept), rejected }
}

const CORR_CUE = rx(
  String.raw`(przesun\w*|przełoż\w*|nie,?\s+czekaj|czekaj,?\s+nie|nie,\s+(?=\w)|jednak|a potem się poprawił\w*|sprawdziłe?m jeszcze raz|znaczy)`,
  'gi',
)
const DAY_RE = rx(
  String.raw`\b(poniedział\w*|wtor\w*|środ\w*|czwart\w*|piąt(?:ek|ku)|sobot\w*|niedziel\w*)(?:\s+(rano|wieczorem|po południu|przed południem))?`,
  'gi',
)
const DAY_NOM: [string, string][] = [
  ['poniedz', 'poniedziałek'], ['wtor', 'wtorek'], ['środ', 'środa'], ['czwart', 'czwartek'],
  ['piąt', 'piątek'], ['sobot', 'sobota'], ['niedziel', 'niedziela'],
]
const dayKey = (word: string): string | null => {
  const w = word.toLowerCase()
  for (const [key] of DAY_NOM) if (w.startsWith(key)) return key
  return null
}

// Spoken self-corrections inside one sentence: the value after 'nie, czekaj' / 'jednak' wins.
export const applyCorrections = (task: TaskDraft, units: readonly Unit[]): TaskDraft => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  let t = task
  for (const id of task.sourceIds) {
    const s = byId.get(id) ?? ''
    const cues = [...s.matchAll(CORR_CUE)]
    if (!cues.length) continue
    const cue = cues[cues.length - 1]!
    const pre = s.slice(0, cue.index)
    const post = s.slice(cue.index + cue[0].length)
    const preN = sourceNumbers(pre)
    const postN = sourceNumbers(post)
    const postOnly = [...postN].filter((n) => !preN.has(n) && n >= 1 && Number.isInteger(n)).sort((a, b) => a - b)
    for (const field of ['title', 'due'] as const) {
      const txt = t[field]
      if (!txt) continue
      for (const n of taskNumbers(txt)) {
        if (preN.has(n) && !postN.has(n) && postOnly.length >= 1) {
          const cands = postOnly.filter((m) => m >= 100 === n >= 100)
          if (cands.length >= 1) {
            const m = Math.max(...cands)
            const updated: string = txt.replace(rx(String.raw`\b${Math.trunc(n)}\b`, ''), String(Math.trunc(m)))
            if (updated !== txt) t = { ...t, [field]: updated }
          }
        }
      }
    }
    const dueNow = t.due ?? ''
    const dm = new RegExp(DAY_RE.source, 'iu').exec(dueNow)
    const postDays = [...post.matchAll(DAY_RE)]
    if (dm && postDays.length) {
      const last = postDays[postDays.length - 1]!
      const dueKey = dayKey(dm[1]!)
      const earlier = [...pre.matchAll(DAY_RE), ...postDays.slice(0, -1)].map((x) => dayKey(x[1]!))
      const lastKey = dayKey(last[1]!)
      if (lastKey && dueKey !== lastKey && earlier.includes(dueKey)) {
        const nominative = DAY_NOM.find(([key]) => key === lastKey)![1]
        t = { ...t, due: nominative + (last[2] ? ` ${last[2]}` : '') }
      }
    }
  }
  return t
}

const CORRECTION_LEAD = rx(String.raw`^\s*(?:poprawka|korekta)\b`, 'i')
// A bare date sentence or a spoken correction ('Poprawka: nie środa, tylko czwartek') can carry a task's deadline.
export const isDateCarrier = (text: string): boolean => CORRECTION_LEAD.test(text) || isDateOnlySentence(text)

// 'Termin: środa do osiemnastej.' - a short sentence that says only when.
export const isDateOnlySentence = (text: string): boolean => {
  const words = lettersOnly(text)
  if (words.length > 8) return false
  const content = words.filter(
    (w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w) && wordValue(w) === null && groupHits([w], [...DAYS, ...REL, ...MONTH_GROUPS]).size === 0,
  )
  return content.length <= 1
}

const SPOKEN_FIX = rx(
  String.raw`^\s*(?:poprawka|korekta|jednak)?\W*nie,?\s+(poniedział\w*|wtor\w*|środ\w*|czwart\w*|piąt(?:ek|ku)|sobot\w*|niedziel\w*),?\s+(?:tylko|a)\s+(poniedział\w*|wtor\w*|środ\w*|czwart\w*|piąt(?:ek|ku)|sobot\w*|niedziel\w*)`,
  'i',
)

// 'Termin: środa. Poprawka: nie środa, tylko czwartek.' - the correction sits in the sentence after the task.
export const applyNextSentenceFix = (task: TaskDraft, units: readonly Unit[]): TaskDraft => {
  if (!task.due) return task
  const dueMatch = new RegExp(DAY_RE.source, 'iu').exec(task.due)
  const dueDay = dueMatch ? dayKey(dueMatch[1]!) : null
  if (!dueDay) return task
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const last = Math.max(0, ...task.sourceIds)
  for (const id of [...task.sourceIds, last + 1, last + 2]) {
    const m = SPOKEN_FIX.exec(byId.get(id) ?? '')
    if (!m || dayKey(m[1]!) !== dueDay) continue
    const nominative = DAY_NOM.find(([key]) => key === dayKey(m[2]!))
    if (!nominative) continue
    return { ...task, due: task.due.replace(new RegExp(DAY_RE.source, 'iu'), nominative[1]) }
  }
  return task
}

export const validateTasks = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  const join = (ids: readonly number[]): string => ids.map((i) => byId.get(i) ?? '').join(' ')
  const neighbours = (ids: readonly number[]): number[] =>
    sortedUnique(ids.flatMap((i) => [i - 1, i + 1]).filter((j) => byId.has(j) && !ids.includes(j)))
  // Date sentences right after (or before) the cited ones, up to two in a row.
  const dateChain = (ids: readonly number[]): number[] => {
    const out: number[] = []
    for (const [start, step] of [[Math.max(...ids), 1], [Math.min(...ids), -1]] as const) {
      for (let j = start + step; out.length < 4 && byId.has(j) && !ids.includes(j) && Math.abs(j - start) <= 2; j += step) {
        if (!isDateCarrier(byId.get(j)!)) break
        out.push(j)
      }
    }
    return sortedUnique(out)
  }
  const reject = (t: TaskDraft, reason: string): void => {
    rejected.push({ title: t.title, due: t.due, reason })
  }
  for (const t of tasks) {
    if (['', 'BRAK'].includes(stripChars(t.title, ' -—–.').toUpperCase())) continue
    let ids = t.sourceIds.filter((i) => byId.has(i))
    if (!ids.length) {
      reject(t, 'no valid source ids')
      continue
    }
    let cited = join(ids)
    let title = fixGlued(t.title)
    let due = t.due
    const first = lettersOnly(title)[0]
    const apptOk =
      first !== undefined &&
      APPT_NOUNS.includes(first) &&
      !!due &&
      (taskNumbers(due).length > 0 || dateWordsUnanchored(due, '').length > 0) &&
      numbersAnchored(due, cited).length + dateWordsUnanchored(due, cited).length === 0
    if (!apptOk && !contentAnchor(title, cited)) {
      // The model sometimes cites the wrong neighbouring sentence.
      const fixed = neighbours(ids).filter((j) => contentAnchor(title, byId.get(j)!))
      if (!fixed.length) {
        reject(t, 'title not anchored in cited sentences')
        continue
      }
      ids = sortedUnique([...ids, ...fixed])
      cited = join(ids)
    }
    const badClock = clockUnanchored(title, join(ids))
    for (const b of badClock) title = title.replace(new RegExp(String.raw`\s*(?:o\s+)?${escapeRegExp(b)}`, 'gu'), '')
    const badTitle = numbersAnchored(title, cited).length + dateWordsUnanchored(title, cited).length
    if (badTitle) {
      const wider = join(sortedUnique([...ids, ...neighbours(ids)]))
      if (numbersAnchored(title, wider).length + dateWordsUnanchored(title, wider).length === 0) {
        ids = sortedUnique([...ids, ...neighbours(ids)])
        cited = wider
      } else {
        // 'Zapłacić czynsz 1050 zł' with an invented amount: keep the action, recoverAmount restores the real one.
        const bare = title.replace(/\s*\d[\d\s.,]*\s*(?:zł|złotych|euro|€)(?![\p{L}\p{N}_])/giu, '').trim()
        if (bare === title || numbersAnchored(bare, cited).length + dateWordsUnanchored(bare, cited).length > 0) {
          reject(t, 'title value not in source')
          continue
        }
        title = bare
      }
    }
    if (due) {
      const unanchored = (text: string, source: string): number =>
        numbersAnchored(text, source).length + dateWordsUnanchored(text, source).length + clockUnanchored(text, source).length
      if (unanchored(due, cited)) {
        // Only a bare date sentence next door may supply the deadline, never another task's sentence.
        const dateOnly = dateChain(ids)
        const wider = join(sortedUnique([...ids, ...dateOnly]))
        if (unanchored(due, wider) === 0) ids = sortedUnique([...ids, ...dateOnly])
        else {
          // An invented clock time is dropped, the day stays when the source states it.
          const day = stripChars(due.replace(new RegExp(CLOCK_IN_DUE.source, 'gu'), '').trim(), ' ,;-')
          due = day && unanchored(day, wider) === 0 ? day : null
          if (due) ids = sortedUnique([...ids, ...dateOnly])
        }
      }
    }
    kept.push({ title, due, sourceIds: ids, modelIds: t.modelIds.length ? t.modelIds : t.sourceIds })
  }
  return { kept, rejected }
}

// A deadline stays only when the sentence(s) that carry the task's own words state it (or a bare date sentence).
export const dueFromOwnSentence = (task: TaskDraft, units: readonly Unit[]): TaskDraft => {
  if (!task.due) return task
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const ids = (task.modelIds.length ? task.modelIds : task.sourceIds).filter((i) => byId.has(i))
  const objectStems = new Set(
    lettersOnly(task.title.split(/\s+/u).slice(1).join(' ')).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 4)),
  )
  const own = ids.filter((i) => lettersOnly(byId.get(i)!).some((w) => w.length >= 4 && objectStems.has(w.slice(0, 4))))
  if (!own.length) return task
  const dueStems = lettersOnly(task.due).filter((w) => w.length >= 4 && wordValue(w) === null).map((w) => w.slice(0, 4))
  const bad = (source: string): number => {
    const have = new Set(lettersOnly(source).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)))
    return (
      numbersAnchored(task.due!, source).length +
      dateWordsUnanchored(task.due!, source).length +
      clockUnanchored(task.due!, source).length +
      dueStems.filter((s) => !have.has(s)).length
    )
  }
  if (bad(own.map((i) => byId.get(i)!).join(' ')) === 0) return task
  const bare = task.sourceIds.filter((i) => !own.includes(i) && byId.has(i) && isDateCarrier(byId.get(i)!))
  if (bare.length && bad([...own, ...bare].map((i) => byId.get(i)!).join(' ')) === 0) return task
  return { ...task, due: null }
}

const OTHER_SUBJ = rx(
  String.raw`(?:^|[,.:;]\s*|\b(?:a|i|ale|więc|że)\s+)(?:(?!Ja\b)[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+|mama|tata|szef\w*|ona|on|oni|one)` +
    String.raw`(?:\s+\w+){0,4}?\s+(?:(?:ma|mają)\s+(?:\w+\s+){0,2}?\w+(?:ć|c)\b|zrobi|przygotuje|odbierze|przejmuje|przywiezie|kupi|roześle|wpuści|zamówi|zadzwoni|zarezerwuje|podeśle|zajmuje się|zajmie się|zajmują się|bierze|biorą|załatwi|załatwia|ogarnia|ogarnie|pilnuje|przyniesie|zawiezie|pójdzie|przyjdzie|sprawdzi|sprawdzą|przejrzy|poprawi|przyśle|wyśle|napisze|przeczyta|oceni|dokończy|skończy|odpowie|obejrzy|zatwierdzi|zorganizuje)\b` +
    String.raw`|^(?:(?!Ja\b)[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+|Mama|Tata)\s*:`,
)
const FIRST_PERSON = rx(
  String.raw`(?<!nie )\b(?:muszę|mam\s+(?:\w+\s+){0,3}?\w+ć|ja\s+(?!się nie|nie)\w+|zrobię|zadzwonię|napiszę|piszę|wyślę|wysyłam|wpłacam|zamawiam|oddam|pójdę|przyjadę|kupię|sprawdzę|zapytam|dzwonię|trzeba)\b`,
  'i',
)
// Verb-subject order: 'testy płatności robi Tomek'.
const OTHER_VS = rx(
  String.raw`\b(?:robi|zrobi|robią|zrobią|przygotuje|przygotowuje|odbierze|kupi|załatwi|zajmie się|zajmuje się|ogarnia|ogarnie|bierze|przyniesie|zawiezie|podeśle|wysyła|wyśle|zamówi|zamawia|zadzwoni|dzwoni|napisze|pisze|sprawdzi|sprawdza|pilnuje)\s+(?!Ja\b)[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+`,
)
export const isOtherOwned = (sentence: string): boolean =>
  (OTHER_SUBJ.test(sentence) || OTHER_VS.test(sentence)) && !FIRST_PERSON.test(sentence)

// Ownership is judged on the sentences the model pointed at that actually carry the task's content words
// (a neighbouring date sentence says nothing about who does the work).
export const ownerFilter = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    const ids = (t.modelIds.length ? t.modelIds : t.sourceIds).filter((i) => byId.has(i))
    const objectStems = new Set(lettersOnly(t.title.split(/\s+/u).slice(1).join(' ')).filter((w) => w.length >= 4).map((w) => w.slice(0, 4)))
    const anchored = ids.filter((i) => lettersOnly(byId.get(i)!).some((w) => w.length >= 4 && objectStems.has(w.slice(0, 4))))
    const judged = anchored.length ? anchored : ids
    if (judged.length && judged.every((i) => isOtherOwned(byId.get(i)!)))
      rejected.push({ title: t.title, due: t.due, reason: 'other person' })
    else kept.push(t)
  }
  return { kept, rejected }
}

const SUPERSEDED = rx(
  String.raw`\b(miał[aoy]?|miałe[mś]|miała[mś])\s+(?:\w+\s+){0,2}?(być|przyjść|się odbyć|zamówić|robić)\b|pierwsza wersja|na początku (?:miał|mówil)|najpierw (?:mówil|powiedzia)`,
  'i',
)
const IN_SENTENCE_CHANGE = rx(String.raw`(jednak|przesun|przełoż|zamiast|czekaj|poprawi|\bale\b|okazało)`, 'i')

// Drop tasks whose every source sentence only describes an earlier, replaced plan ('miała być w czwartek').
export const supersededFilter = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    const sentences = t.sourceIds.filter((i) => byId.has(i)).map((i) => byId.get(i)!)
    if (sentences.length && sentences.every((s) => SUPERSEDED.test(s) && !IN_SENTENCE_CHANGE.test(s)))
      rejected.push({ title: t.title, due: t.due, reason: 'superseded plan' })
    else kept.push(t)
  }
  return { kept, rejected }
}

const MONEY = rx(String.raw`((?:\p{L}+\s+){1,4}?|\d[\d\s]*)(zł\b|złot\w*|euro\b|€)`, 'gi')
interface Amount {
  value: number
  currency: 'zł' | 'euro'
}

// Final money amounts in a sentence (after a spoken correction, the later amount wins).
const sentenceAmounts = (s: string): Amount[] => {
  let vals: { value: number; currency: 'zł' | 'euro'; at: number }[] = []
  for (const m of s.matchAll(MONEY)) {
    const tokens = (m[1] ?? '').match(/\p{L}+|\d+/gu) ?? []
    const isNumeral = (x: string): boolean => /^\d+$/u.test(x) || wordValue(x) !== null
    const run: string[] = []
    for (const x of [...tokens].reverse()) {
      if (isNumeral(x)) run.unshift(x)
      else if (run.length) break
    }
    if (!run.length) continue
    const value = run.every((x) => /^\d+$/u.test(x))
      ? Number(run.join(''))
      : seqValue(run.map((x) => wordValue(x) ?? 0))
    const currency = /^(?:euro|€)/iu.test(m[2]!) ? 'euro' : 'zł'
    vals.push({ value, currency, at: m.index })
  }
  const cues = [...s.matchAll(CORR_CUE)]
  if (cues.length && vals.length) {
    const cue = cues[cues.length - 1]!
    const after = vals.filter((v) => v.at > cue.index)
    const postNum = [...sourceNumbers(s.slice(cue.index + cue[0].length))].filter((n) => n >= 100).sort((a, b) => a - b)
    if (after.length) vals = after
    else if (postNum.length) vals = [{ value: Math.trunc(postNum[postNum.length - 1]!), currency: vals[vals.length - 1]!.currency, at: 0 }]
  }
  const unique = new Map<string, Amount>()
  for (const v of vals) unique.set(`${Math.trunc(v.value)}|${v.currency}`, { value: Math.trunc(v.value), currency: v.currency })
  return [...unique.values()].sort((a, b) => a.value - b.value || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
}

// The model often drops the amount ('Zapłacić ratę za laptopa'); re-attach the single amount of its
// sentence when it sits near a word of the task.
export const recoverAmount = (t: TaskDraft, units: readonly Unit[]): TaskDraft => {
  if (/\d/u.test(t.title)) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const ids = t.modelIds.length ? t.modelIds : t.sourceIds
  const ts = cstems(t.title)
  const found = new Map<string, Amount>()
  for (const id of ids) {
    const s = byId.get(id) ?? ''
    const amounts = sentenceAmounts(s)
    if (amounts.length !== 1) continue
    const words = s.toLowerCase().match(rx(String.raw`\w+`, 'g')) ?? []
    const near = words.some(
      (w, k) =>
        (w.startsWith('zł') || w.startsWith('złot') || w.startsWith('euro')) &&
        words.slice(Math.max(0, k - 9), k + 9).some((x) => x.length >= 4 && ts.has(x.slice(0, 4))),
    )
    if (near) found.set(`${amounts[0]!.value}|${amounts[0]!.currency}`, amounts[0]!)
  }
  if (found.size !== 1) return t
  const { value, currency } = [...found.values()][0]!
  return { ...t, title: `${t.title} ${value} ${currency}` }
}

// ---------------------------------------------------------------- repairs
const REMINDER = rx(String.raw`przypomn\w*(?:\s+(?:mi|nam))?,?\s+(?:o tym,?\s+)?(?:że|żeby\w*)\s+(.+)`, 'i')
const REMINDER_ABOUT = rx(String.raw`przypomn\w*(?:\s+(?:mi|nam))\s+(?:też\s+)?o\s+(.+)`, 'i')
const ABOUT_TAIL = /\s+((?:w|we|na|do|przed)\s+\p{L}+(?:\s+(?:rano|wieczorem))?)$/u
const PAST_VERB = /^(\p{L}+?)(ił|ał|ył)(?:a|em|am)?$/u

// 'Zapomnieć …' is the model garbling 'przypomnij mi, żebym … zadzwonił': rebuild from the sentence.
export const repairReminder = (t: TaskDraft, units: readonly Unit[]): TaskDraft | null => {
  if (/^przypomnij\b/iu.test(t.title) && !/^przypomnij\s+mi\b/iu.test(t.title))
    return { ...t, title: `Przypomnieć${t.title.slice('Przypomnij'.length).replace(/,?\s+żeb.*$/iu, '')}` }
  if (!/^(?:zapomn|przypomnij\s+mi)/iu.test(t.title) || /\bnie\b/iu.test(t.title)) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  for (const id of t.sourceIds) {
    const sentence = byId.get(id) ?? ''
    const about = REMINDER_ABOUT.exec(sentence)
    const m = REMINDER.exec(sentence)
    if (!m && about) {
      const text = stripChars(about[1]!.trim(), '.,;!? ')
      const tail = ABOUT_TAIL.exec(text)
      const when = tail && TEMPORAL.test(tail[1]!) ? tail[1]! : ''
      const what = when ? text.slice(0, text.length - tail![0].length) : text
      return { ...t, title: wordsToDigits(`Pamiętać o ${what}`), due: when ? wordsToDigits(when) : t.due }
    }
    if (!m) continue
    const words = m[1]!.split(/\s+/u).map((w) => stripChars(w, '.,;!?'))
    const at = words.findIndex((w) => PAST_VERB.test(w.toLowerCase()) && w.length > 4)
    if (at < 0) continue
    const verb = words[at]!.toLowerCase().replace(PAST_VERB, (_all, stem: string, end: string) => `${stem}${end.slice(0, -1)}ć`)
    const rest = m[1]!.split(/\s+/u).slice(at + 1)
    const stop = rest.findIndex((w) => /[,;.]$/u.test(w))
    const object = (stop < 0 ? rest : rest.slice(0, stop + 1)).map((w) => stripChars(w, '.,;!?')).join(' ')
    const when = words.slice(0, at).join(' ')
    const title = verb.charAt(0).toUpperCase() + verb.slice(1) + (object ? ` ${object}` : '')
    return { ...t, title: wordsToDigits(title), due: when && TEMPORAL.test(when) ? wordsToDigits(when) : t.due }
  }
  return null
}

const editDistance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_v, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1)
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = cur
  }
  return prev[b.length]!
}

// 'Odbić' for 'odebrać': swap an invented infinitive for a close infinitive that the sentence really uses.
export const repairVerb = (t: TaskDraft, units: readonly Unit[]): TaskDraft => {
  const first = t.title.split(/\s+/u)[0] ?? ''
  const verb = first.toLowerCase()
  if (verb.length < 5 || !verb.endsWith('ć')) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const words = lettersOnly(t.sourceIds.map((i) => byId.get(i) ?? '').join(' '))
  if (words.includes(verb)) return t
  const near = [...new Set(words.filter((w) => w.length >= 5 && w.endsWith('ć')))]
    .map((w) => ({ w, d: editDistance(verb, w) }))
    .filter((x) => x.d <= (words.some((w) => w.startsWith(verb.slice(0, 4))) ? 2 : 3))
    .sort((a, b) => a.d - b.d)[0]
  if (!near) return t
  return { ...t, title: near.w.charAt(0).toUpperCase() + near.w.slice(1) + t.title.slice(first.length) }
}

const CLOSING = rx(String.raw`\b(zamyka\w*|zamknięt\w*|czynn\w*|otwart\w*|otwiera\w*|do której)\b`, 'i')

// A clock time that only says when a place closes is not the task's deadline.
const CLOCK_IN_DUE = rx(String.raw`\s*(?:\b(?:o|do|od)\s+)?\b\d{1,2}:\d{2}\b`)
export const dropClosingDue = (t: TaskDraft, units: readonly Unit[]): TaskDraft => {
  if (!t.due) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const cited = (t.modelIds.length ? t.modelIds : t.sourceIds).map((i) => byId.get(i) ?? '').join(' ')
  if (!CLOSING.test(cited)) return t
  if (dateWordsUnanchored(t.due, '').length === 0) return { ...t, due: null }
  // 'jutro o 18:00' where 18:00 is only the closing hour: keep the day.
  const hours = [...t.due.matchAll(rx(String.raw`\b(\d{1,2}):\d{2}\b`, 'g'))].map((m) => Number(m[1]))
  const clauses = cited.split(/[,;.]/u)
  const stated = (closing: boolean): boolean =>
    clauses.some((c) => CLOSING.test(c) === closing && hours.some((h) => hourValues(c).has(h)))
  if (hours.length && stated(true) && !stated(false)) {
    const due = stripChars(t.due.replace(new RegExp(CLOCK_IN_DUE.source, 'gu'), '').trim(), ' ,;-')
    return { ...t, due: due || null }
  }
  return t
}

const CANCELLED = rx(
  String.raw`\bnie\s+(?:trzeba|muszę|potrzeb\w*|zapisuję|kupuję|biorę|idę|jadę|robię|zamawiam|będę)\b|\b(?:odpuszczam|rezygnuję|odpada|zrezygnowałem|zrezygnowałam)\b`,
  'i',
)

// 3-letter stems survive Polish declension ('kawę' / 'kawy').
const stems3 = (text: string): Set<string> =>
  new Set(lettersOnly(text).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)).map((w) => w.slice(0, 3)))

const LATE_CANCEL = rx(
  String.raw`\bjednak\s+(?:nie|odpuszcz\w*|zrezygnuj\w*|rezygnuj\w*)|\b(?:odpuszczam|rezygnuję|zrezygnowałe?m|zrezygnowałam|odpada|odpadło)\b|\bnie\s+(?:będę|zamierzam|zapisuję|kupuję|biorę|idę|jadę)\b`,
  'i',
)
const LATE_WINDOW = 10

// A task whose own clause is cancelled ('kawy nie trzeba', 'odpuszczam') is not active; a later sentence
// that rejects the same thing ('z kursu jednak rezygnuję') cancels it too.
export const cancelledFilter = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    const ts = stems3(t.title)
    const ids = (t.modelIds.length ? t.modelIds : t.sourceIds).filter((i) => byId.has(i))
    const clauses = ids.flatMap((i) => byId.get(i)!.split(/[,;.]|\s(?:a|ale|za to|natomiast)\s/u))
    const best = clauses
      .map((clause) => ({ clause, hit: [...stems3(clause)].filter((x) => ts.has(x)).length }))
      .filter((x) => x.hit > 0)
      .sort((a, b) => b.hit - a.hit)[0]
    // The verb is not evidence of the same plan: judge the later clause on the object words only.
    const objectStems = new Set(
      lettersOnly(t.title.split(/\s+/u).slice(1).join(' ')).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)).map((w) => w.slice(0, 3)),
    )
    const last = Math.max(0, ...ids)
    const later = units
      .filter((u) => u.id > last && u.id <= last + LATE_WINDOW)
      .flatMap((u) => u.text.split(/[,;.]|\s(?:a|ale|za to|natomiast)\s/u))
      .some((clause) => {
        if (!LATE_CANCEL.test(clause)) return false
        const shared = [...stems3(clause)].filter((x) => objectStems.has(x)).length
        return shared >= Math.min(2, objectStems.size) && shared > 0
      })
    if ((best && CANCELLED.test(best.clause)) || later) rejected.push({ title: t.title, due: t.due, reason: 'cancelled' })
    else kept.push(t)
  }
  return { kept, rejected }
}

// 'Sprawdzić opony, dolać płynu i zatankować' -> one task per infinitive (the due is shared).
export const splitCompound = (t: TaskDraft): TaskDraft[] => {
  const words = t.title.split(/\s+/u)
  const starts = [0]
  for (let i = 1; i < words.length; i += 1) {
    const w = stripChars(words[i]!, ',').toLowerCase()
    const before = words[i - 1]!
    if (w.length >= 5 && w.endsWith('ć') && wordValue(w) === null && (/,$/u.test(before) || ['i', 'oraz'].includes(before.toLowerCase())))
      starts.push(i)
  }
  if (starts.length < 2) return [t]
  const parts = starts.map((from, k) =>
    words.slice(from, starts[k + 1] ?? words.length).join(' ').replace(/[\s,]+$/u, '').replace(/\s+(?:i|oraz)$/iu, ''),
  )
  // 'Przygotować i wysłać podsumowanie': a verb without its own object shares the next one.
  if (parts.slice(0, -1).some((part) => part.split(/\s+/u).length < 2)) return [t]
  return parts.map((part) => ({ ...t, title: part.charAt(0).toUpperCase() + part.slice(1) }))
}

const VAGUE_OBJECT = /^(\p{L}+)\s+(?:wszystko|to|te rzeczy|resztę|całość)$/iu

// 'Kupić wszystko — środa' next to 'Kupić: list' only adds its due to the list.
export const mergeVague = (tasks: readonly TaskDraft[]): TaskDraft[] => {
  const out = [...tasks]
  for (const t of tasks) {
    const m = VAGUE_OBJECT.exec(t.title)
    if (!m) continue
    const host = out.find((o) => o !== t && o.title.toLowerCase().startsWith(m[1]!.toLowerCase()) && o.title.length > t.title.length)
    if (!host) continue
    out.splice(out.indexOf(t), 1)
    if (!host.due && t.due) out[out.indexOf(host)] = { ...host, due: t.due, sourceIds: sortedUnique([...host.sourceIds, ...t.sourceIds]) }
  }
  return out
}

export const dedupeTasks = (tasks: readonly TaskDraft[]): TaskDraft[] => {
  const seen = new Set<string>()
  const out: TaskDraft[] = []
  for (const t of tasks) {
    const key = t.title.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

// ---------------------------------------------------------------- grounding guards
// Cyrillic letters that look like Latin ones, which the model sometimes emits mid-word.
const CYRILLIC_TWINS: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', к: 'k', м: 'm', т: 't', і: 'i',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
}
const REFLEXIVE_ENDINGS: Readonly<Record<string, string>> = { а: 'ać się', е: 'eć się', и: 'ić się', ы: 'yć się' }
const isForeignLetter = (ch: string): boolean => /\p{L}/u.test(ch) && !/[A-Za-zÀ-ɏ]/u.test(ch)

// Russian infinitive endings and lookalike letters are mapped to Polish; null = other foreign letters remain.
export const foldScripts = (text: string): string | null => {
  const folded = text
    .replace(/([аеиы])ться(?![\p{L}])/gu, (_all, v: string) => REFLEXIVE_ENDINGS[v] ?? v)
    .replace(/ть(?![\p{L}])/gu, 'ć')
    .replace(/[аеорсхуктіАВЕКМНОРСТХ]/gu, (c) => CYRILLIC_TWINS[c] ?? c)
  return Array.from(folded).some(isForeignLetter) ? null : folded
}

// Count/unit pairs ('2 razy', '5 ml'): the number alone may be stated in the source ('siedem dni') while
// being bound to another unit in the title ('7 razy dziennie').
const UNIT_KEYS: readonly (readonly [RegExp, string])[] = [
  [/^raz(?:y|ów)?$/u, 'raz'], [/^(?:ml|mililitr\p{L}*)$/u, 'ml'], [/^(?:mg|miligram\p{L}*)$/u, 'mg'],
  [/^(?:kg|kilogram\p{L}*)$/u, 'kg'], [/^(?:g|gram\p{L}*)$/u, 'g'], [/^(?:l|litr\p{L}*)$/u, 'l'],
  [/^(?:godz|godzin\p{L}*)$/u, 'h'], [/^(?:min|minut\p{L}*)$/u, 'min'], [/^(?:dni|dzień|dnia|dniach|dób|dobę)$/u, 'd'],
  [/^(?:tydz|tyg|tygodni\p{L}*|tygodn\p{L}*)$/u, 'tydz'], [/^miesi\p{L}*$/u, 'mies'], [/^(?:zł|złot\p{L}*)$/u, 'zł'],
  [/^(?:euro|eur|€)$/u, 'euro'], [/^(?:osób|osoby|osoba|osobom)$/u, 'os'], [/^(?:szt|sztuk\p{L}*)$/u, 'szt'],
  [/^tabletk\p{L}*$/u, 'tab'], [/^(?:paczk\p{L}*|opakowa\p{L}*)$/u, 'pak'], [/^(?:proc|procent\p{L}*|%)$/u, '%'],
]
const unitKey = (word: string): string | null => {
  const w = word.toLowerCase()
  for (const [pattern, key] of UNIT_KEYS) if (pattern.test(w)) return key
  return null
}
const digitize = (text: string): string => {
  let out = ''
  let pos = 0
  for (const span of numberSpans(text)) {
    out += text.slice(pos, span.start) + String(span.value)
    pos = span.end
  }
  return out + text.slice(pos)
}
const PAIR = /(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s*([\p{L}%€]+)/gu
const NUMBER_THEN_WORD = /(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)(?:\s*([\p{L}%€]+))?/gu
const pairValue = (raw: string): number => Number(raw.replace(/ /gu, '').replace(',', '.'))
// Unit keys that follow each stated value in the text; null = a number with no known unit after it.
const unitsByValue = (text: string): Map<number, Set<string | null>> => {
  const out = new Map<number, Set<string | null>>()
  for (const m of digitize(text).matchAll(NUMBER_THEN_WORD)) {
    const value = pairValue(m[1]!)
    const keys = out.get(value) ?? new Set<string | null>()
    keys.add(m[2] ? unitKey(m[2]) : null)
    out.set(value, keys)
  }
  return out
}
const QUALIFIER = /^\s+(?:dziennie|tygodniowo|miesięcznie|dobę|na dobę)(?![\p{L}])/iu

// A number the cited text binds to another unit ('siedem dni' vs '7 razy dziennie') is replaced by the
// value the source gives for that unit when there is exactly one, otherwise the pair is dropped.
export const repairNumberUnits = (text: string, cited: string): string => {
  const source = unitsByValue(cited)
  let out = text
  for (const m of [...text.matchAll(PAIR)].reverse()) {
    const key = unitKey(m[2]!)
    const keys = source.get(pairValue(m[1]!))
    if (!key || !keys || keys.has(key) || keys.has(null)) continue
    const alternatives = [...source.entries()].filter(([, ks]) => ks.has(key)).map(([value]) => value)
    const start = m.index
    const end = start + m[0].length
    if (alternatives.length === 1) {
      out = `${out.slice(0, start)}${alternatives[0]} ${m[2]}${out.slice(end)}`
      continue
    }
    const tail = QUALIFIER.exec(out.slice(end))
    out = `${out.slice(0, start)}${out.slice(end + (tail ? tail[0].length : 0))}`
  }
  return out.replace(/\s{2,}/gu, ' ').trim()
}

const DATE_DM = /(?<![\d:])(\d{1,2})[./](\d{1,2})(?![\d:])/u
const DAY_PREP_NUM = /\b(do|na|przed|od|po)\s+(\d{1,2})(?![\d:])/giu

// A 'D.M' due needs its month in the source; a bare ordinal day ('do dwudziestego piątego') is rendered
// as 'do 25' instead of the invented '20.5'.
export const repairDueDate = (due: string, cited: string): string | null => {
  const m = DATE_DM.exec(due)
  if (!m) return due
  const day = Number(m[1])
  const month = Number(m[2])
  const text = digitize(cited)
  const hasMonthWord = groupHits(lettersOnly(cited), MONTH_GROUPS).size > 0
  const written = new RegExp(String.raw`(?<![\d:])${day}[./]${month}(?![\d:])`, 'u').test(text)
  if (written || (hasMonthWord && sourceNumbers(cited).has(day))) return due
  const candidates = [...text.matchAll(DAY_PREP_NUM)].filter((c) => Number(c[2]) >= 1 && Number(c[2]) <= 31)
  const pick = candidates.find((c) => [day + month, Number(`${day}${month}`)].includes(Number(c[2]))) ?? candidates[0]
  return pick ? `${pick[1]!.toLowerCase()} ${Number(pick[2])}` : null
}

const KNOWN_GLITCH_VERBS: Readonly<Record<string, string>> = { idć: 'iść', biorć: 'brać' }
const BAD_INFINITIVE = /[^aeiouyąęóśź]ć$/u
const PAYMENT_VERB =/^(?:zapłac|wpłac|opłac|przela|przelew)/u
const MONEY_CUE = rx(String.raw`(?:€|\b(?:zł|złot\w*|euro|płac\w*|płat\w*|opłat\w*|przelew\w*|rachun\w*|czynsz\w*|składk\w*|abonament\w*|mandat\w*|podat\w*|zaliczk\w*|wpłat\w*|zapłat\w*|subskrypcj\w*|karnet\w*|rat[aęy]|kosztuj\w*|kwot\w*|faktur\w*|cen[aęy])\b)`, 'i')
const DOSE_CUE = /(?:\b(?:ml|mg)\b|mililitr|miligram|tabletk|krople|razy dziennie|co \d+ godzin)/iu

// 'Zapłacić amoksycylinę' where the sentence only gives a dose: a payment verb with no money anywhere near
// the cited sentences is swapped for a neutral one when a dose is stated, otherwise the task is dropped.
export const groundVerb = (t: TaskDraft, neighbourhood: string): TaskDraft | null => {
  const first = t.title.split(/\s+/u)[0] ?? ''
  const verb = first.toLowerCase()
  if (verb.length < 3 || !verb.endsWith('ć')) return t
  const rest = t.title.slice(first.length)
  const glitch = KNOWN_GLITCH_VERBS[verb]
  const swap = (infinitive: string): TaskDraft => ({ ...t, title: infinitive.charAt(0).toUpperCase() + infinitive.slice(1) + rest })
  if (glitch) return swap(glitch)
  // A consonant before 'ć' ('odbierć') is a broken infinitive: take the closest infinitive of the source.
  if (BAD_INFINITIVE.test(verb)) {
    const near = [...new Set(lettersOnly(neighbourhood).filter((w) => w.length >= 5 && w.endsWith('ć') && !BAD_INFINITIVE.test(w)))]
      .map((w) => ({ w, d: editDistance(verb, w) }))
      .filter((x) => x.d <= 4)
      .sort((a, b) => a.d - b.d)[0]
    if (near) return swap(near.w)
  }
  if (!PAYMENT_VERB.test(verb) || MONEY_CUE.test(neighbourhood)) return t
  if (DOSE_CUE.test(t.title) || DOSE_CUE.test(neighbourhood)) return { ...t, title: `Stosować${rest}` }
  return null
}

const MEETING_NOUN = new Set(['spotkanie', 'zebranie', 'narada', 'telekonferencja'])
const SPEAKER_ACTION = rx(
  String.raw`\b(?:tam|wtedy|na nim|podczas)\b[^.;]*?\bmam\s+(?!to\b|go\b|je\b|ją\b)(?:\w+\s+){0,2}?(\w+(?:ć|c))\b([^,.;]*)`,
  'i',
)

// 'Spotkanie we wtorek o 10:00 ... tam mam zreferować stan listy' is an event; the author's task is the
// action named in the sentence, due when the meeting is.
export const meetingToAction = (t: TaskDraft, units: readonly Unit[]): TaskDraft => {
  const [head, ...others] = t.title.split(/\s+/u)
  if (!MEETING_NOUN.has((head ?? '').toLowerCase())) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  for (const id of t.sourceIds) {
    const m = SPEAKER_ACTION.exec(byId.get(id) ?? '')
    if (!m) continue
    const action = `${m[1]!}${m[2]!}`.trim()
    return { ...t, title: action.charAt(0).toUpperCase() + action.slice(1), due: t.due ?? (others.join(' ') || null) }
  }
  return t
}

const LEADING_CONDITION = rx(String.raw`^(?:\p{L}+,?\s+)?(?:jeśli|jeżeli)\s+([^,]+),\s*(?:to\s+)?`, 'i')
const UNSETTLED = rx(String.raw`\b(jeszcze nic nie|nie rezerwujemy|zobaczymy|nie wiadomo|jeszcze nie wiem)\b`, 'i')

// 'Jeśli zdam analizę, to jadę na narty, ale jeszcze nic nie rezerwujemy' is an open plan, not a task;
// a plain conditional keeps its condition in the title.
export const keepCondition = (t: TaskDraft, units: readonly Unit[]): TaskDraft | null => {
  if (/jeśli|jeżeli/iu.test(t.title)) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  for (const id of t.modelIds.length ? t.modelIds : t.sourceIds) {
    const sentence = byId.get(id) ?? ''
    const m = LEADING_CONDITION.exec(sentence)
    if (!m) continue
    if (UNSETTLED.test(sentence)) return null
    const condition = wordsToDigits(m[1]!.trim())
    if (condition.split(/\s+/u).length <= 8) return { ...t, title: `${t.title}, jeśli ${condition}` }
  }
  return t
}

// Foreign letters, unsupported numbers/units/dates and invented verbs, checked against the cited sentences
// (widened by validateTasks) and their neighbours.
export const groundTasks = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    const cited = t.sourceIds.map((i) => byId.get(i) ?? '').join(' ')
    const near = sortedUnique(t.sourceIds.flatMap((i) => [i - 1, i, i + 1]))
      .map((i) => byId.get(i) ?? '')
      .join(' ')
    const title0 = foldScripts(t.title)
    const due0 = t.due === null ? null : foldScripts(t.due)
    if (title0 === null) {
      rejected.push({ title: t.title, due: t.due, reason: 'foreign script' })
      continue
    }
    let task: TaskDraft = { ...t, title: title0, due: t.due === null || due0 === null ? null : due0 }
    task = { ...task, title: repairNumberUnits(task.title, cited) }
    if (task.due) {
      const dueFixed = repairNumberUnits(task.due, cited)
      const dated = dueFixed ? repairDueDate(dueFixed, cited) : null
      task = { ...task, due: dated }
    }
    const verbFixed = groundVerb(task, near)
    if (!verbFixed) {
      rejected.push({ title: t.title, due: t.due, reason: 'verb not in source' })
      continue
    }
    const conditional = keepCondition(meetingToAction(verbFixed, units), units)
    if (conditional) kept.push(conditional)
    else rejected.push({ title: t.title, due: t.due, reason: 'open plan' })
  }
  return { kept, rejected }
}

// 'wzywam serwisanta' -> 'Wzywać serwisanta': a one-off task reads as a perfective infinitive.
const PERFECTIVE: Readonly<Record<string, string>> = {
  wzywać: 'wezwać', przelewać: 'przelać', pisać: 'napisać', jechać: 'pojechać', wysyłać: 'wysłać',
  dzwonić: 'zadzwonić', płacić: 'zapłacić', kupować: 'kupić', oddawać: 'oddać', robić: 'zrobić',
  sprawdzać: 'sprawdzić', poprawiać: 'poprawić', odbierać: 'odebrać', wymieniać: 'wymienić',
  przygotowywać: 'przygotować', zamawiać: 'zamówić', wpadać: 'wpaść', kończyć: 'skończyć',
  dokańczać: 'dokończyć', zabierać: 'zabrać', wpłacać: 'wpłacić', zapisywać: 'zapisać', dopisywać: 'dopisać',
  umawiać: 'umówić', rezerwować: 'zarezerwować', kopiować: 'skopiować', drukować: 'wydrukować',
  przeglądać: 'przejrzeć', odkładać: 'odłożyć', usuwać: 'usunąć', pokazywać: 'pokazać', wypychać: 'wypchnąć',
  zgłaszać: 'zgłosić', rejestrować: 'zarejestrować', wracać: 'wrócić', czytać: 'przeczytać', nagrywać: 'nagrać',
  wypełniać: 'wypełnić', składać: 'złożyć', przesyłać: 'przesłać', pożyczać: 'pożyczyć', przypominać: 'przypomnieć',
  sprzątać: 'posprzątać', przywozić: 'przywieźć', zawozić: 'zawieźć', odnawiać: 'odnowić', przedłużać: 'przedłużyć',
}
const HABITUAL = rx(String.raw`\b(codziennie|co\s+(?:dzień|tydzień|rano|wieczór|miesiąc|tydzien)|regularnie|każd\w+|zawsze|stale|na\s+bieżąco|częściej|codzienn\w+|systematycznie)\b`, 'i')

export const perfective = (t: TaskDraft): TaskDraft => {
  const [first = '', ...rest] = t.title.split(' ')
  const verb = PERFECTIVE[first.toLowerCase()]
  if (!verb || HABITUAL.test(t.title) || (t.due && HABITUAL.test(t.due))) return t
  return { ...t, title: [verb.charAt(0).toUpperCase() + verb.slice(1), ...rest].join(' ') }
}

// 'Oddać Kuba książkę' -> 'Oddać Kubie książkę': these verbs take the recipient in the dative.
const DATIVE_VERBS = new Set([
  'oddać', 'wysłać', 'pokazać', 'przypomnieć', 'powiedzieć', 'pomóc', 'przekazać', 'przesłać', 'odpisać',
  'podziękować', 'pożyczyć', 'dać', 'przynieść', 'zwrócić', 'odesłać', 'podesłać', 'wysyłać', 'oddawać',
])
const DATIVE_SUFFIX: readonly (readonly [RegExp, string])[] = [
  [/([szcn])ia$/u, '$1i'], [/ia$/u, 'ii'], [/ja$/u, 'i'], [/la$/u, 'li'], [/(?:cz|sz|rz|dż|c)a$/u, '$&'],
  [/ka$/u, 'ce'], [/ga$/u, 'dze'], [/cha$/u, 'sze'], [/sta$/u, 'ście'], [/ta$/u, 'cie'], [/da$/u, 'dzie'],
  [/ra$/u, 'rze'], [/([bpmwfnsz])a$/u, '$1ie'],
]
export const dativeOf = (name: string): string | null => {
  for (const [pattern, replacement] of DATIVE_SUFFIX) {
    if (!pattern.test(name)) continue
    // 'Natasza' -> 'Nataszy', 'Monika' -> 'Monice'
    return replacement === '$&' ? `${name.slice(0, -1)}y` : name.replace(pattern, replacement)
  }
  return null
}

const NAME_PREPOSITIONS = new Set(['do', 'od', 'z', 'ze', 'u', 'dla', 'przez', 'na', 'w', 'we', 'o', 'po', 'przy', 'za', 'i'])
export const dativeName = (t: TaskDraft): TaskDraft => {
  const parts = t.title.split(' ')
  if (parts.length < 2 || !DATIVE_VERBS.has(parts[0]!.toLowerCase())) return t
  // 'Oddać Kuba książkę' or 'Oddać książkę Kuba'
  for (let index = 1; index <= Math.min(3, parts.length - 1); index += 1) {
    const name = parts[index]!.replace(/[,;]$/u, '')
    if (!/^\p{Lu}\p{Ll}+a$/u.test(name) || NAME_PREPOSITIONS.has(parts[index - 1]!.toLowerCase())) continue
    const dative = dativeOf(name)
    if (!dative) return t
    parts[index] = parts[index]!.replace(name, dative)
    return { ...t, title: parts.join(' ') }
  }
  return t
}

export const postprocessTaskLines = (raw: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const rejected: RejectedTask[] = []
  const take = (step: GuardResult): TaskDraft[] => {
    rejected.push(...step.rejected)
    return step.kept
  }
  let tasks = raw.map((t) => ({ ...tidyTask(t), modelIds: [...t.sourceIds] }))
  tasks = tasks.flatMap((t) => {
    const fixed = repairReminder(t, units)
    if (fixed) return [fixed]
    rejected.push({ title: t.title, due: t.due, reason: 'malformed reminder' })
    return []
  })
  tasks = take(finalizeTasks(tasks.flatMap(splitCompound))).map((t) => applyCorrections(t, units))
  tasks = take(validateTasks(tasks, units))
  tasks = take(groundTasks(tasks, units))
  tasks = take(ownerFilter(tasks, units))
  tasks = take(supersededFilter(tasks, units)).map((t) => applyNextSentenceFix(dueFromOwnSentence(t, units), units))
  tasks = take(cancelledFilter(tasks, units))
  tasks = tasks.map((t) => dativeName(perfective(recoverAmount(repairVerb(dropClosingDue(t, units), units), units))))
  return { kept: dedupeTasks(mergeVague(tasks)), rejected }
}

// ---------------------------------------------------------------- candidate pre-filter
const MODAL = String.raw`\b(muszę|musze|musimy|trzeba|mam\s+(?:\w+\s+){0,3}?\w+(?:ć|c)\b|mamy\s+\w+ć|powinien|powinnam|warto|lepiej\s+\w+ć|należy|nie zapomn|pamiętać|żeby nie zapomnieć|postanaw|postanowi|zamierzam|chcę\s+\w+ć|pamiętaj|przypomnij|przypomnieć|przypominaj|po\s+(?:pierwsze|drugie|trzecie|czwarte|piąte),?\s+\w+)`
const INF = String.raw`(?:^|[,.;:]\s*|\b(?:i|a|no i|aha i|to)\s+)(\w+(?:ć|c))\b`
const DATE = String.raw`\b(jutr\w*|dziś|dzisiaj|pojutrze|weekend\w*|poniedział\w*|wtor\w*|środ\w*|czwart\w*|piąt(?:ek|ku)|sobot\w*|niedziel\w*|do końca|najpóźniej|przed\s+\w+|tygodni\w*|stycz\w*|luty|lutego|lutym|marz\w*|marca|marcu|kwietni\w*|maj(?:a|u|em)?|czerw\w*|lip(?:iec|ca|cu)|sierp\w*|wrze\w*|paździer\w*|listopad\w*|grud\w*|o\s+\w+(?:ej|ą)\b)`
const APPT = String.raw`\b(spotkani|wizyt|kontrol|dentyst|lekar|wymian|termin|rezerwac|umówi|szczepien)\w*`
const SHOP = String.raw`\b(kupi\w*|lista|zakup\w*|potrzeb\w*)`
const FIRST_PERSON_FUT = String.raw`\b(pokazuję|prezentuję|oddaję|składam|zgłaszam|odbieram|zadzwonię|napiszę|zrobię|oddam|pójdę|przyjadę|przedłużę|wyślę|kupię|zapłacę|wpłacę|sprawdzę|zapytam|anuluję|wpłacam|zamawiam|przelewam|porównuję|wysyłam|dzwonię|piszę|biorę|odkładam|ustawiam|wpiszę|załatwię|zorganizuję|odbiorę|zmieniam|eskaluję)\b`
const HEUR_COND = String.raw`\b(jeśli|jeżeli|jak będzie|gdyby|do tego|tylko jak)\b`
const NO_TASK = rx(String.raw`^\s*(dobra|okej|ok|no|aha|matko|kurczę|chyba)\b[^.]{0,25}[.!?]?\s*$`)
const CANDIDATE_PATTERNS = [MODAL, FIRST_PERSON_FUT, INF, APPT, SHOP, DATE, HEUR_COND].map((source) => rx(source))

// Cheap pre-filter: only sentences that can contain a task go to the model.
export const isTaskCandidate = (text: string): boolean => {
  const t = text.toLowerCase()
  if (NO_TASK.test(t)) return false
  return CANDIDATE_PATTERNS.some((pattern) => pattern.test(t))
}

// Narration of the past ('Zapłaciłem...', 'Promotor powiedział...') carries no task unless it also looks
// forward (obligation, plan, request, an appointment change).
const PAST = rx(
  String.raw`\b(?:\w+(?:łem|łam|łeś|łaś|liśmy|łyśmy)|\w{2,}(?:ał|ił|ył|ął|eł)[aoi]?|przyszło|było|był|była|byli|były)\b`,
  'i',
)
const FORWARD = [MODAL, FIRST_PERSON_FUT, INF, HEUR_COND, String.raw`\b(żebym|żebyśmy|jednak|czekaj|poprawk\w*|zamiast|przesunęli|przełożyli|przesunięt\w*|przełożon\w*)\b`].map((source) => rx(source))
// 'Druga sprawa: prezentacja na poniedziałek.' - a heading the speaker reads out, not a task.
const HEADING = rx(String.raw`^(?:\p{L}+\s+)?(?:sprawa|sekcja|część|punkt)(?:\s+\p{L}+)?\s*:`, 'i')
export const isHeading = (text: string): boolean => HEADING.test(text.trim()) && text.trim().split(/\s+/u).length <= 9
const LABEL_LEAD = /^\s*\p{L}+\s*:/u
const NO_CHANGE = rx(String.raw`\bbez zmian\b`, 'i')
// Present-tense facts ('Kontrola jest we wtorek') and appointments stay candidates even with a past clause,
// except a past meeting ('miałem spotkanie').
const PRESENT = rx(String.raw`\b(jest|są|będzie|będą|mam|mamy|ma|mają|najpóźniej|dziennie|co\s+\w+\s+(?:godzin|dni))\b`)
const APPT_RX = rx(APPT)
const PAST_EVENT = rx(String.raw`\b(?:miał\w*|byłe[mś]|byłam|byliśmy|spotkałe[mś]|spotkałam|rozmawiał\w*)\b`)
export const isPastNarration = (text: string): boolean => {
  // A past verb in a trailing reason ('..., bo mama kupiła ostatnio') does not make the sentence narration.
  const t = text.toLowerCase().replace(REASON_TAIL, '')
  if (!PAST.test(t) || FORWARD.some((pattern) => pattern.test(t)) || PRESENT.test(t)) return false
  return !(APPT_RX.test(t) && !PAST_EVENT.test(t))
}

// Obligation and plan sentences outrank bare date mentions when a long note has to be trimmed.
const STRONG = [MODAL, FIRST_PERSON_FUT, String.raw`\b(żebym|żebyśmy|muszą|musisz|musicie|powinny|powinna|powinni)\b`].map((source) => rx(source))
const MAM = rx(String.raw`\bmam\b`)
const DEADLINE = rx(String.raw`\b(do|przed|najpóźniej)\s+\p{L}+`)
const PLAN = rx(String.raw`\b(poprawiam|robię|kończę|jadę|wracam|odpoczywam|ćwiczę|idę|ograniczam|wzywam|ustawiam|wpadnę|wydrukuję|piszę|wysyłam|zaczynam|dokańczam|odbieram|składam|płacę|zamawiam)\b`)
const MEDIUM = [APPT, SHOP, INF].map((source) => rx(source))
const DATE_RX = rx(DATE)
const CHANGE = rx(String.raw`\b(poprawk\w*|jednak|czekaj|przesunęli|przełożyli|nowy termin|termin\w*|płatn\w*)\b`)
export const candidateScore = (text: string): number => {
  const t = text.toLowerCase()
  const date = DATE_RX.test(t)
  const lead = STRONG.some((p) => p.test(t)) ? 4 : PLAN.test(t) || (date && MAM.test(t)) ? 3 : 0
  const medium = MEDIUM.some((p) => p.test(t)) ? (lead > 0 || date ? 2 : 1) : 0
  return lead + medium + (date ? 1 : 0) + (DEADLINE.test(t) ? 1 : 0) + (MONEY_CUE.test(t) ? 2 : 0) + (CHANGE.test(t) ? 3 : 0)
}
// A long note gets a tighter budget: only its most binding sentences go to the model.
export const MAX_CANDIDATES = 40
export const MAX_CANDIDATES_LONG = 26
export const LONG_NOTE_WORDS = 1000
export const isLongNote = (units: readonly { text: string }[]): boolean =>
  units.reduce((total, unit) => total + unit.text.split(/\s+/u).length, 0) > LONG_NOTE_WORDS
export const candidateLimit = (units: readonly { text: string }[]): number => (isLongNote(units) ? MAX_CANDIDATES_LONG : MAX_CANDIDATES)
export const limitCandidates = <T extends { text: string }>(units: readonly T[], max = MAX_CANDIDATES): T[] => {
  if (units.length <= max) return [...units]
  const keep = new Set(
    units
      .map((unit, index) => ({ index, score: candidateScore(unit.text) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, max)
      .map((x) => x.index),
  )
  return units.filter((_unit, index) => keep.has(index))
}

// A nominal list ('ryż, szynka, mleko') carries items to buy only after a shopping cue nearby.
const LIST_CUE = rx(String.raw`\b(lista|listę|listy|liście|zakup\w*|kupi(?!ł)\w*|kupować|potrzeb\w*|brakuje|skończy\w*)\b`, 'i')
const LIST_MORE = rx(String.raw`^\s*(do tego|jeszcze|oraz|plus|i też|a także|i)\b`, 'i')
const LIST_LOOKBACK = 3
const isListFragment = (text: string): boolean => {
  const words = text.trim().split(/\s+/u).length
  return words <= 16 && (/,/u.test(text) || /\s(?:i|oraz)\s/u.test(text) || LIST_MORE.test(text))
}

// Pre-filter plus context: nominal list sentences right after a shopping cue are candidates too.
export const selectCandidates = <T extends { text: string }>(units: readonly T[]): T[] =>
  units.filter((unit, index) => {
    if (isTaskCandidate(unit.text)) return !isPastNarration(unit.text) && !isHeading(unit.text) && !(isOtherOwned(unit.text) && !LABEL_LEAD.test(unit.text)) && !NO_CHANGE.test(unit.text)
    if (!isListFragment(unit.text) || NO_TASK.test(unit.text.toLowerCase())) return false
    return units.slice(Math.max(0, index - LIST_LOOKBACK), index).some((prev) => LIST_CUE.test(prev.text))
  })

// A verbless list right after a shopping cue ('ryż, szynka, ser') needs no model: it becomes 'Kupić: ...'.
const NOMINAL_STOP = rx(String.raw`\b(nie|jest|są|było|były|będzie|mam|ma|mamy|mają|trzeba|muszę|chcę|może|bo|że|ale|żeby|czy|jak|gdy|tak|chyba|tyle|idę|jadę|wracam|okej|dobra|chce)\b|\w+(?:łem|łam|liśmy|ałem|ałam)\b`, 'i')
// A past verb in the list itself ('kosztował', 'prosiła') means narration; one in a trailing reason ('bo został') does not.
const NOMINAL_PAST = rx(String.raw`\w{2,}(?:ał|ił|ył|ął|eł)[aoy]?\b|\bprzyszło\b|\bżebym\b`, 'i')
const REASON_TAIL = rx(String.raw`,?\s+(?:bo|ponieważ|więc)\s+.*$`, 'i')
const LEAD_FILLER = rx(String.raw`^(?:(?:aha|no|dobra|i|też|do tego|jeszcze|plus|oraz)\b[,\s]*)+`, 'i')
const isNominalList = (text: string): boolean => {
  const body = text.replace(LEAD_FILLER, '')
  const parts = body.split(/,|\s(?:i|oraz)\s/u).filter((part) => part.trim())
  const additive = LEAD_FILLER.test(text) && parts.length >= 1
  return (
    body.trim().split(/\s+/u).length <= 20 &&
    !NOMINAL_STOP.test(body) &&
    !NOMINAL_PAST.test(body.replace(REASON_TAIL, '')) &&
    parts.every((part) => part.trim().split(/\s+/u).length <= 6) &&
    (parts.length >= 3 || additive)
  )
}

export const nominalListTasks = (units: readonly Unit[]): TaskDraft[] => {
  const out: TaskDraft[] = []
  let last: TaskDraft | null = null
  units.forEach((unit, index) => {
    const cued = units.slice(Math.max(0, index - LIST_LOOKBACK), index).some((prev) => LIST_CUE.test(prev.text))
    const chained = last !== null && last.sourceIds[last.sourceIds.length - 1] === unit.id - 1
    if (isTaskCandidate(unit.text.replace(LEAD_FILLER, '')) || !(cued || chained) || !isNominalList(unit.text)) {
      last = null
      return
    }
    const raw = wordsToDigits(stripChars(unit.text.replace(LEAD_FILLER, '').trim(), '.!?, '))
    const items = raw.charAt(0).toLowerCase() + raw.slice(1)
    if (last) {
      last.title = `${last.title}, ${items}`
      last.sourceIds.push(unit.id)
    } else {
      last = { title: `Kupić: ${items}`, due: null, sourceIds: [unit.id], modelIds: [unit.id] }
      out.push(last)
    }
  })
  return out
}

// ---------------------------------------------------------------- prompt
export const TASK_LINES_PROMPT = `ZADANIE: oceń zdania notatki i wypisz zadania autora.
Zadanie = coś, co AUTOR notatki (ja) ma zrobić w przyszłości: czynność, zalecenie do stosowania (np. brać lek o 8:00) albo umówione spotkanie lub wizyta.
To NIE jest zadanie autora:
- czynność innej osoby ("Ewa przygotuje", "Bartek go odbierze", "Marek ma przysłać"),
- coś, co już się stało ("było spotkanie", "kupiłam", "odwołałem", "już mam", "załatwione"),
- plan odwołany lub porzucony ("nie kupuję", "odpada", "rezygnuję", "jednak nie"),
- fakt, opinia, wspomnienie, porada ogólna, treść wykładu, luźny pomysł, "może / zobaczymy".
Przy poprawce ("nie, czekaj", "jednak", "przesunęli na") obowiązuje późniejsza wersja; sprawdzaj resztę notatki.

Dla każdego zdania z listy napisz jedną linię, w tej samej kolejności i z tym samym numerem:
- gdy zdanie nie zawiera zadania autora: numer i myślnik, np. [5] -
- gdy zawiera: numer, czynność, a po " — " termin, np. [6] Zapłacić za internet 60 zł — do piątku
Nie twórz zadań z opisu przeszłości, z liczb, cen i godzin podanych jako informacja ani z ogólnych planów typu "pokażę trzy rzeczy".
Czynność: 2–8 słów, zawsze bezokolicznik z czasownikiem ze zdania (Kupić…, Zadzwonić do…, Wysłać…; nie "zadzwonię"), dla wizyty/spotkania rzeczownik (Wizyta u…, Spotkanie z…). Bez "muszę/trzeba" i bez uzasadnień. Kwoty, liczby (cyframi), miejsca i warunek ("jeśli…") wpisz w czynność, np. Kupić 12 jajek.
Lista rzeczy do kupienia (same rzeczowniki po "lista zakupów", "potrzebuję", "kupić") to jedno zadanie, także bez czasownika: "Kupić: " i wszystkie pozycje po przecinku, z ilościami.
Po " — " wpisz tylko termin: dzień, datę, godzinę albo "do…/przed…/jutro", i tylko jeśli padł W TYM SAMYM zdaniu (nie bierz terminu z sąsiedniego zdania); liczby i godziny cyframi; nie dodawaj miesięcy ani dat. Bez terminu nie pisz " — ".
Dwa zadania w jednym zdaniu rozdziel znakiem |; nie łącz różnych wydarzeń w jedno zadanie.

Przykład (inna notatka):
ZDANIA:
[1] Dobra, w środę muszę oddać projekt, nie, czekaj, w czwartek.
[2] Zosia zajmie się zakupami, to jej sprawa.
[3] Wczoraj byłem na siłowni, było ciężko.
[4] Fryzjer był na jedenastą, ale zadzwonili, że jednak na trzynastą.
[5] Kiedyś może nauczę się grać na gitarze.
[6] Rachunek za wodę, osiemdziesiąt złotych, trzeba zapłacić do piętnastego.
[7] Jak Igor nie przyśle umowy do jutra, to piszę do niego maila.
[8] Na basen w tym tygodniu nie idę, odpuszczam.
[9] Krople do oczu mam zakraplać trzy razy dziennie.
[10] Hania prosiła, żebym jej oddał książkę w sobotę.
[11] Lista zakupów na jutro.
[12] Ryż, szynka w plastrach, dwa opakowania ręczników papierowych.
[13] Muszę poprawić ekran logowania.
[14] Kasia sprawdzi tekst do środy.
ODPOWIEDŹ:
[1] Oddać projekt — czwartek
[2] -
[3] -
[4] Wizyta u fryzjera — 13:00
[5] -
[6] Zapłacić rachunek za wodę 80 zł — do 15
[7] Napisać maila do Igora, jeśli nie przyśle umowy — jutro
[8] -
[9] Zakraplać krople do oczu 3 razy dziennie
[10] Oddać Hani książkę — sobota
[11] -
[12] Kupić: ryż, szynkę w plastrach, 2 opakowania ręczników papierowych
[13] Poprawić ekran logowania
[14] -`

const BATCH_SIZES = [64, 24, 12, 6, 3, 1]
const OUTPUT_BASE_TOKENS = 40
const OUTPUT_TOKENS_PER_SENTENCE = 18
// A whole note's answer stays near this size (decode is the slow part on a phone).
const MAX_OUTPUT_TOKENS = 560
const MAX_OUTPUT_TOKENS_LONG = 360
// Continuations of cut answers may spend at most this much more in total.
const CONTINUATION_TOKENS = 320
const CONTEXT_MARGIN = 24
// The same answer line three times in a row means the model started looping.
export const isDegenerate = (text: string): boolean => {
  const bodies = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\[\d+\]\s*/u, '').trim())
    .filter((b) => b.length > 3)
  return bodies.some((b, i) => i >= 2 && b === bodies[i - 1] && b === bodies[i - 2])
}
export const cutAnswer = (text: string, cut: boolean): string =>
  cut && !/\n\s*$/u.test(text) ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text
// Number of batch sentences a (cut) answer got through, by its last "[id]" line.
export const answeredCount = (answer: string, batch: readonly { id: number }[]): number => {
  const ids = [...answer.matchAll(/^\s*\[(\d+)\]/gmu)].map((m) => Number(m[1]))
  return ids.length ? batch.findIndex((unit) => unit.id === ids[ids.length - 1]) + 1 : 0
}
const emptyResult = (): TaskLinesResult => ({ tasks: [], rendered: [], warnings: [] })
const renderTask = (t: TaskLine): string => (t.due ? `${t.title} — ${t.due}` : t.title)

export const extractTaskLines = async (
  units: readonly { id: number; text: string }[],
  language: Language,
  execution?: ProcessingExecutionContext,
): Promise<TaskLinesResult> => {
  if (language !== 'pl') return emptyResult()
  const nominal = nominalListTasks(units)
  const nominalIds = new Set(nominal.flatMap((t) => t.sourceIds))
  const candidates = limitCandidates(selectCandidates(units.filter((unit) => !nominalIds.has(unit.id))), candidateLimit(units))
  if (!candidates.length && !nominal.length) return emptyResult()
  const system = noteSourceSystem(language)
  const numbered = units.map((unit) => `[${unit.id}] ${unit.text}`).join('\n')
  const head = `${TASK_LINES_PROMPT}\n\nTeraz zdania tej notatki.\nZDANIA:\n`
  const promptFor = (batch: readonly Unit[]): string =>
    sourceFirstPrompt(numbered, `${head}${batch.map((unit) => `[${unit.id}] ${unit.text}`).join('\n')}\nODPOWIEDŹ:\n`)
  const maxOutput = isLongNote(units) ? MAX_OUTPUT_TOKENS_LONG : MAX_OUTPUT_TOKENS
  const warnings: string[] = []
  const raw: TaskDraft[] = []
  let cut = false
  let rest = candidates
  let maxBatch = Infinity
  let continuation = CONTINUATION_TOKENS
  let continuing = false
  while (rest.length) {
    throwIfProcessingAborted(execution)
    // Largest batch whose prompt plus answer fits the context window.
    let batch: Unit[] | null = null
    let prompt = ''
    let nPredict = 0
    const tried = new Set<number>()
    for (const size of BATCH_SIZES.filter((n) => n <= maxBatch)) {
      const candidate = rest.slice(0, size)
      if (tried.has(candidate.length)) continue
      tried.add(candidate.length)
      const text = promptFor(candidate)
      const tokens = await measureFormattedPromptTokens({ systemPrompt: system, userPrompt: text })
      const free = getContextWindowSize() - tokens - CONTEXT_MARGIN
      const wanted = Math.min(maxOutput, OUTPUT_BASE_TOKENS + OUTPUT_TOKENS_PER_SENTENCE * candidate.length)
      if (free >= wanted || (candidate.length === 1 && free >= OUTPUT_BASE_TOKENS)) {
        batch = candidate
        prompt = text
        nPredict = Math.min(wanted, free)
        break
      }
    }
    if (!batch) {
      warnings.push('Notatka jest zbyt długa, aby wyodrębnić zadania z jej dalszej części.')
      break
    }
    if (continuing) {
      nPredict = Math.min(nPredict, continuation)
      continuation -= nPredict
    }
    const result = await generate(prompt, () => undefined, {
      system,
      nPredict,
      temperature: 0.1,
      topP: 0.8,
      topK: 20,
      minP: 0,
      ...(execution?.signal ? { signal: execution.signal } : {}),
    })
    recordGeneration('task-lines', prompt.length, result, numbered.length)
    throwIfProcessingAborted(execution)
    if (result.completion?.interrupted) throw new Error('Generation interrupted')
    const stopped = !!(result.completion?.truncated || result.completion?.stoppedLimit)
    if (isDegenerate(result.text) && batch.length > 3) {
      maxBatch = Math.max(3, Math.floor(batch.length / 2))
      continue
    }
    // A cut answer ends in a half-written line; drop it.
    const answer = cutAnswer(result.text, stopped)
    raw.push(...parseTaskLines(answer, new Set(batch.map((unit) => unit.id))))
    if (!stopped) {
      rest = rest.slice(batch.length)
      continue
    }
    // Cut off: the unanswered sentences go to a follow-up call with the same
    // source prefix (cheap prefill) while the continuation budget lasts.
    const done = answeredCount(answer, batch)
    if (done === 0 || continuation < OUTPUT_BASE_TOKENS) {
      cut = true
      rest = rest.slice(batch.length)
      continue
    }
    continuing = true
    rest = rest.slice(done)
  }
  if (cut) warnings.push('Odpowiedź modelu została ucięta; część zadań mogła zostać pominięta.')
  const kept = dedupeTasks(mergeSimilar(mergeVague([...postprocessTaskLines(raw, units).kept, ...nominal]))).sort((a, b) => a.sourceIds[0]! - b.sourceIds[0]!)
  const tasks = kept.map((t): TaskLine => ({ title: t.title, due: t.due, sourceIds: [...t.sourceIds] }))
  return { tasks, rendered: tasks.map(renderTask), warnings }
}
