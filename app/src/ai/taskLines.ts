import type { Language } from '../i18n/language'
import { recordGeneration } from './generationMetrics'
import { generate, getContextWindowSize, measureFormattedPromptTokens } from './llm'
import { throwIfProcessingAborted, type ProcessingExecutionContext } from './processingContext'
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
  let title = fixGlued(t.title.replace(/[\s—–\-:,;]+$/u, '').trim())
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
      if ((inter / Math.min(ts.size, os.size) >= 0.67 && sameVerb) || isSubset(ts, os) || isSubset(os, ts)) {
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

export const finalizeTasks = (tasks: readonly TaskDraft[]): GuardResult => {
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    if (isActionish(t.title)) kept.push(t)
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

export const validateTasks = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  const join = (ids: readonly number[]): string => ids.map((i) => byId.get(i) ?? '').join(' ')
  const neighbours = (ids: readonly number[]): number[] =>
    sortedUnique(ids.flatMap((i) => [i - 1, i + 1]).filter((j) => byId.has(j) && !ids.includes(j)))
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
        reject(t, 'title value not in source')
        continue
      }
    }
    if (due) {
      const unanchored = (text: string, source: string): number =>
        numbersAnchored(text, source).length + dateWordsUnanchored(text, source).length + clockUnanchored(text, source).length
      if (unanchored(due, cited)) {
        const wider = join(sortedUnique([...ids, ...neighbours(ids)]))
        if (unanchored(due, wider) === 0) ids = sortedUnique([...ids, ...neighbours(ids)])
        else due = null
      }
    }
    kept.push({ title, due, sourceIds: ids, modelIds: t.modelIds.length ? t.modelIds : t.sourceIds })
  }
  return { kept, rejected }
}

const OTHER_SUBJ = rx(
  String.raw`(?:^|[,.:;]\s*|\b(?:a|i|ale|więc|że)\s+)(?:(?!Ja\b)[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+|mama|tata|szef\w*|ona|on|oni|one)` +
    String.raw`(?:\s+\w+){0,4}?\s+(?:(?:ma|mają)\s+(?:\w+\s+){0,2}?\w+(?:ć|c)\b|zrobi|przygotuje|odbierze|przejmuje|przywiezie|kupi|roześle|wpuści|zamówi|zadzwoni|zarezerwuje|podeśle|zajmuje się|zajmie się|zajmują się|bierze|biorą|załatwi|załatwia|ogarnia|ogarnie|pilnuje|przyniesie|zawiezie|pójdzie|przyjdzie)\b` +
    String.raw`|^(?:(?!Ja\b)[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+|Mama|Tata)\s*:`,
)
const FIRST_PERSON = rx(
  String.raw`(?<!nie )\b(?:muszę|mam\s+(?:\w+\s+){0,3}?\w+ć|ja\s+(?!się nie|nie)\w+|zrobię|zadzwonię|napiszę|piszę|wyślę|wysyłam|wpłacam|zamawiam|oddam|pójdę|przyjadę|kupię|sprawdzę|zapytam|dzwonię|trzeba)\b`,
  'i',
)
export const isOtherOwned = (sentence: string): boolean => OTHER_SUBJ.test(sentence) && !FIRST_PERSON.test(sentence)

// Ownership is judged on the sentence the model pointed at, not on widened ids.
export const ownerFilter = (tasks: readonly TaskDraft[], units: readonly Unit[]): GuardResult => {
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const kept: TaskDraft[] = []
  const rejected: RejectedTask[] = []
  for (const t of tasks) {
    const ids = (t.modelIds.length ? t.modelIds : t.sourceIds).filter((i) => byId.has(i))
    if (ids.length && ids.every((i) => isOtherOwned(byId.get(i)!)))
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
export const dropClosingDue = (t: TaskDraft, units: readonly Unit[]): TaskDraft => {
  if (!t.due) return t
  const byId = new Map(units.map((u) => [u.id, u.text]))
  const cited = (t.modelIds.length ? t.modelIds : t.sourceIds).map((i) => byId.get(i) ?? '').join(' ')
  if (CLOSING.test(cited) && dateWordsUnanchored(t.due, '').length === 0) return { ...t, due: null }
  return t
}

const CANCELLED = rx(
  String.raw`\bnie\s+(?:trzeba|muszę|potrzeb\w*|zapisuję|kupuję|biorę|idę|jadę|robię|zamawiam|będę)\b|\b(?:odpuszczam|rezygnuję|odpada|zrezygnowałem|zrezygnowałam)\b`,
  'i',
)

// 3-letter stems survive Polish declension ('kawę' / 'kawy').
const stems3 = (text: string): Set<string> =>
  new Set(lettersOnly(text).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)).map((w) => w.slice(0, 3)))

// A task whose own clause is cancelled ('kawy nie trzeba', 'odpuszczam') is not active.
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
    if (best && CANCELLED.test(best.clause)) rejected.push({ title: t.title, due: t.due, reason: 'cancelled' })
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
  return starts.map((from, k) => {
    const part = words.slice(from, starts[k + 1] ?? words.length).join(' ').replace(/[\s,]+$/u, '').replace(/\s+(?:i|oraz)$/iu, '')
    return { ...t, title: part.charAt(0).toUpperCase() + part.slice(1) }
  })
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
  tasks = take(ownerFilter(tasks, units))
  tasks = take(supersededFilter(tasks, units))
  tasks = take(cancelledFilter(tasks, units))
  tasks = tasks.map((t) => recoverAmount(repairVerb(dropClosingDue(t, units), units), units))
  return { kept: dedupeTasks(mergeVague(tasks)), rejected }
}

// ---------------------------------------------------------------- candidate pre-filter
const MODAL = String.raw`\b(muszę|musze|musimy|trzeba|mam\s+(?:\w+\s+){0,3}?\w+(?:ć|c)\b|mamy\s+\w+ć|powinien|powinnam|warto|lepiej\s+\w+ć|należy|nie zapomn|pamiętać|żeby nie zapomnieć|postanaw|postanowi|zamierzam|chcę\s+\w+ć|pamiętaj|przypomnij|przypomnieć|przypominaj|po\s+(?:pierwsze|drugie|trzecie|czwarte|piąte),?\s+\w+)`
const INF = String.raw`(?:^|[,.;:]\s*|\b(?:i|a|no i|aha i|to)\s+)(\w+(?:ć|c))\b`
const DATE = String.raw`\b(jutr\w*|dziś|dzisiaj|pojutrze|weekend\w*|poniedział\w*|wtor\w*|środ\w*|czwart\w*|piąt(?:ek|ku)|sobot\w*|niedziel\w*|do końca|najpóźniej|przed\s+\w+|tygodni\w*|stycz\w*|luty|lutego|lutym|marz\w*|marca|marcu|kwietni\w*|maj(?:a|u|em)?|czerw\w*|lip(?:iec|ca|cu)|sierp\w*|wrze\w*|paździer\w*|listopad\w*|grud\w*|o\s+\w+(?:ej|ą)\b)`
const APPT = String.raw`\b(spotkani|wizyt|kontrol|dentyst|lekar|wymian|termin|rezerwac|umówi|szczepien)\w*`
const SHOP = String.raw`\b(kupi\w*|lista|zakup\w*|potrzeb\w*)`
const FIRST_PERSON_FUT = String.raw`\b(zadzwonię|napiszę|zrobię|oddam|pójdę|przyjadę|przedłużę|wyślę|kupię|zapłacę|wpłacę|sprawdzę|zapytam|anuluję|wpłacam|zamawiam|przelewam|porównuję|wysyłam|dzwonię|piszę|biorę|odkładam|ustawiam|wpiszę|załatwię|zorganizuję|odbiorę|zmieniam|eskaluję)\b`
const HEUR_COND = String.raw`\b(jeśli|jeżeli|jak będzie|gdyby|do tego|tylko jak)\b`
const NO_TASK = rx(String.raw`^\s*(dobra|okej|ok|no|aha|matko|kurczę|chyba)\b[^.]{0,25}[.!?]?\s*$`)
const CANDIDATE_PATTERNS = [MODAL, FIRST_PERSON_FUT, INF, APPT, SHOP, DATE, HEUR_COND].map((source) => rx(source))

// Cheap pre-filter: only sentences that can contain a task go to the model.
export const isTaskCandidate = (text: string): boolean => {
  const t = text.toLowerCase()
  if (NO_TASK.test(t)) return false
  return CANDIDATE_PATTERNS.some((pattern) => pattern.test(t))
}

// A nominal list ('ryż, szynka, mleko') carries items to buy only after a shopping cue nearby.
const LIST_CUE = rx(String.raw`\b(lista|listę|listy|liście|zakup\w*|kupi\w*|kupować|potrzeb\w*|brakuje|skończy\w*)\b`, 'i')
const LIST_MORE = rx(String.raw`^\s*(do tego|jeszcze|oraz|plus|i też|a także|i)\b`, 'i')
const LIST_LOOKBACK = 3
const isListFragment = (text: string): boolean => {
  const words = text.trim().split(/\s+/u).length
  return words <= 16 && (/,/u.test(text) || /\s(?:i|oraz)\s/u.test(text) || LIST_MORE.test(text))
}

// Pre-filter plus context: nominal list sentences right after a shopping cue are candidates too.
export const selectCandidates = <T extends { text: string }>(units: readonly T[]): T[] =>
  units.filter((unit, index) => {
    if (isTaskCandidate(unit.text)) return true
    if (!isListFragment(unit.text) || NO_TASK.test(unit.text.toLowerCase())) return false
    return units.slice(Math.max(0, index - LIST_LOOKBACK), index).some((prev) => LIST_CUE.test(prev.text))
  })

// A verbless list right after a shopping cue ('ryż, szynka, ser') needs no model: it becomes 'Kupić: ...'.
const NOMINAL_STOP = rx(String.raw`\b(nie|jest|są|było|były|będzie|mam|ma|mamy|mają|trzeba|muszę|chcę|może|bo|że|ale|żeby|czy|jak|gdy|tak|chyba|tyle|idę|jadę|wracam|okej|dobra)\b|\w+(?:łem|łam|liśmy|ałem|ałam)\b`, 'i')
const LEAD_FILLER = rx(String.raw`^(?:(?:aha|no|dobra|i|też|do tego|jeszcze|plus|oraz)\b[,\s]*)+`, 'i')
const isNominalList = (text: string): boolean => {
  const body = text.replace(LEAD_FILLER, '')
  const parts = body.split(/,|\s(?:i|oraz)\s/u).filter((part) => part.trim())
  const additive = LEAD_FILLER.test(text) && parts.length >= 1
  return (
    body.trim().split(/\s+/u).length <= 20 &&
    !NOMINAL_STOP.test(body) &&
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
Czynność: 2–8 słów, zawsze bezokolicznik z czasownikiem ze zdania (Kupić…, Zadzwonić do…, Wysłać…; nie "zadzwonię"), dla wizyty/spotkania rzeczownik (Wizyta u…, Spotkanie z…). Bez "muszę/trzeba" i bez uzasadnień. Kwoty, liczby (cyframi), miejsca i warunek ("jeśli…") wpisz w czynność, np. Kupić 12 jajek.
Lista rzeczy do kupienia (same rzeczowniki po "lista zakupów", "potrzebuję", "kupić") to jedno zadanie, także bez czasownika: "Kupić: " i wszystkie pozycje po przecinku, z ilościami.
Po " — " wpisz tylko termin: dzień, datę, godzinę albo "do…/przed…/jutro", i tylko jeśli padł w notatce; liczby i godziny cyframi; nie dodawaj miesięcy ani dat. Bez terminu nie pisz " — ".
Dwa zadania w jednym zdaniu rozdziel znakiem |

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
[12] Kupić: ryż, szynkę w plastrach, 2 opakowania ręczników papierowych`

const BATCH_SIZES = [64, 24, 12, 6, 3, 1]
const OUTPUT_BASE_TOKENS = 40
const OUTPUT_TOKENS_PER_SENTENCE = 22
const CONTEXT_MARGIN = 24
// The same answer line three times in a row means the model started looping.
export const isDegenerate = (text: string): boolean => {
  const bodies = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\[\d+\]\s*/u, '').trim())
    .filter((b) => b.length > 3)
  return bodies.some((b, i) => i >= 2 && b === bodies[i - 1] && b === bodies[i - 2])
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
  const candidates = selectCandidates(units.filter((unit) => !nominalIds.has(unit.id)))
  if (!candidates.length && !nominal.length) return emptyResult()
  const system = noteSourceSystem(language)
  const numbered = units.map((unit) => `[${unit.id}] ${unit.text}`).join('\n')
  const head = `${TASK_LINES_PROMPT}\n\nTeraz zdania tej notatki.\nZDANIA:\n`
  const promptFor = (batch: readonly Unit[]): string =>
    sourceFirstPrompt(numbered, `${head}${batch.map((unit) => `[${unit.id}] ${unit.text}`).join('\n')}\nODPOWIEDŹ:\n`)
  const warnings: string[] = []
  const raw: TaskDraft[] = []
  let cut = false
  let rest = candidates
  let maxBatch = Infinity
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
      const wanted = OUTPUT_BASE_TOKENS + OUTPUT_TOKENS_PER_SENTENCE * candidate.length
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
    if (result.completion?.truncated || result.completion?.stoppedLimit) cut = true
    if (isDegenerate(result.text) && batch.length > 3) {
      maxBatch = Math.max(3, Math.floor(batch.length / 2))
      continue
    }
    raw.push(...parseTaskLines(result.text, new Set(batch.map((unit) => unit.id))))
    rest = rest.slice(batch.length)
  }
  if (cut) warnings.push('Odpowiedź modelu została ucięta; część zadań mogła zostać pominięta.')
  const kept = dedupeTasks(mergeSimilar(mergeVague([...postprocessTaskLines(raw, units).kept, ...nominal]))).sort((a, b) => a.sourceIds[0]! - b.sourceIds[0]!)
  const tasks = kept.map((t): TaskLine => ({ title: t.title, due: t.due, sourceIds: [...t.sourceIds] }))
  return { tasks, rendered: tasks.map(renderTask), warnings }
}
