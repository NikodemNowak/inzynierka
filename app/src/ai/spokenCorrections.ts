import type { SummaryCorrection } from '../domain/summary'
import type { Language } from '../i18n/language'
import { recordGeneration } from './generationMetrics'
import { generate } from './llm'
import { wordsToDigits } from './polishNumbers'
import { throwIfProcessingAborted, type ProcessingExecutionContext } from './processingContext'

// Speakers change their mind mid-note: "cztery, nie, sześć", "mówiliśmy o piętnastej,
// ale jednak o czternastej". The point, title and task calls keep the first value when
// left to notice this themselves, so one narrow model call lists every change first and
// the note text those calls read carries only the final values. The recorded transcript
// and the source ranges of the summary stay on the text as spoken.

export type SpokenCorrection = SummaryCorrection

const SYSTEM_PL = `Analizujesz transkrypcję mowy, często bez interpunkcji. Znajdź miejsca, w których mówiący zmienia zdanie: podaje wartość, a potem ją odwołuje i podaje inną, która od teraz obowiązuje.
Podaj starą i nową wartość dokładnie tymi słowami, którymi padły w tekście: tylko samą wartość, bez słów typu "nie czekaj". Stara wartość pada w tekście przed nową, czasem dużo wcześniej. W polu "zdanie" przepisz dosłownie kilka słów z miejsca, w którym pada nowa wartość.
Nie są zmianą zdania: zaprzeczenie, porównanie dwóch wariantów, wybór z kilku możliwości, powtórzenie tej samej wartości, wyjaśnienie, kolejne fakty. Gdy nie ma zmian, zwróć pustą listę.

Przykłady:
Tekst: piwo na sobotę cztery nie sześć bo Kuba przychodzi
{"zmiany":[{"stare":"cztery","nowe":"sześć","zdanie":"cztery nie sześć bo Kuba"}]}
Tekst: zapisać się do dermatologa znaczy nie do okulisty
{"zmiany":[{"stare":"dermatologa","nowe":"okulisty","zdanie":"znaczy nie do okulisty"}]}
Tekst: spotkanie mieliśmy w środę ale szef nie może więc przesuwamy na piątek na dziesiątą
{"zmiany":[{"stare":"w środę","nowe":"na piątek","zdanie":"więc przesuwamy na piątek"}]}
Tekst: wyjazd planujemy na sobotę rano pakujemy namiot i kuchenkę Ola bierze mapy a Piotrek załatwia auto od taty jeszcze trzeba kupić gaz i zapałki w sumie to Piotrek pisał że auto będzie dopiero w niedzielę więc jedziemy w niedzielę rano
{"zmiany":[{"stare":"na sobotę","nowe":"w niedzielę rano","zdanie":"więc jedziemy w niedzielę rano"}]}
Tekst: kolokwium jest w piątek o ósmej piętnaście na wykładzie w sali dwieście
{"zmiany":[]}
Tekst: obiad sto złotych nie czekaj sto to było bez deseru z deserem sto dwadzieścia
{"zmiany":[]}
Tekst: nie sorry nie dam rady jutro bo pracuję
{"zmiany":[]}
Tekst: w poniedziałek dentysta o dziewiątej we wtorek zajęcia o dziesiątej a w środę kino w Heliosie za trzydzieści złotych
{"zmiany":[]}`

// Listing changes is the weak step: a dense plan reads as a chain of changes to a 4B
// model. Each candidate goes back to the model as one yes/no question on its own
// passage, which it answers far more reliably than it finds changes.
const VERIFY_SYSTEM_PL = 'Oceniasz fragment transkrypcji mowy. Odpowiadasz tylko "tak" albo "nie".'

const verifyPrompt = (passage: string, correction: SpokenCorrection): string =>
  `Fragment:\n${passage}\n\nCzy mówiący (albo ktoś w rozmowie) najpierw podał "${correction.old}", a potem to odwołał lub zmienił, tak że teraz obowiązuje "${correction.new}" zamiast "${correction.old}"?\n` +
  'Odpowiedz "nie", gdy to dwie różne sprawy (np. różne dni dla różnych rzeczy), porównanie, wybór z kilku możliwości albo po prostu kolejne informacje.'

const verifySchema = { type: 'object', properties: { odpowiedz: { type: 'string', enum: ['tak', 'nie'] } }, required: ['odpowiedz'] } as const

// Words of context on each side of the old and the new value.
const CONTEXT_WORDS = 20
const JOINED_SPAN_WORDS = 120

const MAX_PER_CALL = 6
// Words per call: a long note is read in parts, each with room for its changes.
const CHUNK_WORDS = 900
const MAX_VALUE_WORDS = 8

const schema = {
  type: 'object',
  properties: {
    zmiany: {
      type: 'array',
      maxItems: MAX_PER_CALL,
      items: { type: 'object', properties: { stare: { type: 'string' }, nowe: { type: 'string' }, zdanie: { type: 'string' } }, required: ['stare', 'nowe', 'zdanie'] },
    },
  },
  required: ['zmiany'],
} as const

const wordCount = (text: string): number => (text.match(/[\p{L}\d]+/gu) ?? []).length

const parse = (text: string): SpokenCorrection[] => {
  try {
    const value = JSON.parse(text) as { zmiany?: unknown }
    if (!Array.isArray(value.zmiany)) return []
    return value.zmiany.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { stare, nowe, zdanie } = item as { stare?: unknown; nowe?: unknown; zdanie?: unknown }
      if (typeof stare !== 'string' || typeof nowe !== 'string') return []
      return [{ old: stare, new: nowe, ...(typeof zdanie === 'string' && zdanie.trim() ? { context: zdanie.trim() } : {}) }]
    })
  } catch {
    return []
  }
}

// Consecutive parts of the note of about CHUNK_WORDS words, whole units each.
const partsOf = (texts: readonly string[]): string[] => {
  const parts: string[] = []
  let current: string[] = []
  let count = 0
  for (const text of texts) {
    const n = wordCount(text)
    if (current.length && count + n > CHUNK_WORDS) {
      parts.push(current.join(' '))
      current = []
      count = 0
    }
    current.push(text)
    count += n
  }
  if (current.length) parts.push(current.join(' '))
  return parts
}

const cache = new Map<string, Promise<SpokenCorrection[]>>()
const CACHE_SIZE = 8

const sampling = (execution?: ProcessingExecutionContext) =>
  ({ temperature: 0.1, topP: 0.8, topK: 20, minP: 0, ...(execution?.signal ? { signal: execution.signal } : {}) })

// The words around both values: one passage when they are close, two otherwise.
const passageFor = (part: string, correction: SpokenCorrection): string | null => {
  const at = locate(part, correction)
  if (!at) return null
  const words = [...part.matchAll(/\S+/gu)]
  const wordAt = (offset: number): number => Math.max(0, words.findIndex((word) => (word.index ?? 0) + word[0].length > offset))
  const oldWord = wordAt(at.olds[at.olds.length - 1].at)
  const newWord = wordAt(at.newAt)
  const span = (from: number, to: number): string => words.slice(Math.max(0, from), Math.min(words.length, to)).map((word) => word[0]).join(' ')
  if (newWord - oldWord <= JOINED_SPAN_WORDS) return span(oldWord - CONTEXT_WORDS, newWord + CONTEXT_WORDS)
  return `Wcześniej: ${span(oldWord - CONTEXT_WORDS, oldWord + CONTEXT_WORDS)}\nPóźniej: ${span(newWord - CONTEXT_WORDS, newWord + CONTEXT_WORDS)}`
}

// Two passages far apart: the model judges whether the later one updates the earlier.
const FAR_SYSTEM_PL = [
  'Dostajesz dwa fragmenty tej samej notatki głosowej: wcześniejszy i późniejszy, oraz dwie wartości. Odpowiedz "tak", gdy późniejszy fragment zmienia ustalenie z wcześniejszego w tej samej sprawie, tak że stara wartość już nie obowiązuje. Odpowiedz "nie", gdy fragmenty dotyczą różnych spraw albo późniejszy tylko dodaje informacje.',
  '',
  'Przykłady:',
  'Wcześniej: egzamin z fizyki mamy we wtorek o dziewiątej w auli', 'Później: pani z dziekanatu napisała że egzamin z fizyki przenieśli na czwartek', 'Wartości: "we wtorek" -> "na czwartek"', '{"odpowiedz":"tak"}',
  'Wcześniej: na prezent dla Ani zbieramy po pięćdziesiąt złotych', 'Później: po rozmowie z grupą wyszło że jednak składamy się po siedemdziesiąt', 'Wartości: "pięćdziesiąt" -> "siedemdziesiąt"', '{"odpowiedz":"tak"}',
  'Wcześniej: w czwartek jadę do Poznania na szkolenie', 'Później: a w piątek o dziesiątej mam spotkanie online z oddziałem', 'Wartości: "w czwartek" -> "w piątek"', '{"odpowiedz":"nie"}',
  'Wcześniej: hotel w Lizbonie mamy w centrum przy rzece', 'Później: potem trzy noce w Lagos nad oceanem', 'Wartości: "w centrum" -> "nad oceanem"', '{"odpowiedz":"nie"}',
  'Wcześniej: za prąd w zeszłym miesiącu zapłaciłem sto osiemdziesiąt', 'Później: internet kosztuje mnie sześćdziesiąt miesięcznie', 'Wartości: "sto osiemdziesiąt" -> "sześćdziesiąt"', '{"odpowiedz":"nie"}',
].join('\n')

const confirmed = async (part: string, correction: SpokenCorrection, execution?: ProcessingExecutionContext): Promise<boolean> => {
  const passage = passageFor(part, correction)
  if (!passage) return false
  const far = passage.startsWith('Wcześniej: ')
  const prompt = far ? `${passage}\nWartości: "${correction.old}" -> "${correction.new}"` : verifyPrompt(passage, correction)
  const result = await generate(prompt, () => undefined, { system: far ? FAR_SYSTEM_PL : VERIFY_SYSTEM_PL, jsonSchema: verifySchema, nPredict: 12, ...sampling(execution) })
  recordGeneration('corrections-verify', prompt.length, result, passage.length)
  if (result.completion?.interrupted) return false
  try {
    return (JSON.parse(result.text) as { odpowiedz?: unknown }).odpowiedz === 'tak'
  } catch {
    return false
  }
}

const askModel = async (texts: readonly string[], execution?: ProcessingExecutionContext): Promise<SpokenCorrection[]> => {
  const found: SpokenCorrection[] = []
  for (const part of partsOf(texts)) {
    throwIfProcessingAborted(execution)
    const prompt = `Tekst:\n${part}`
    const result = await generate(prompt, () => undefined, { system: SYSTEM_PL, jsonSchema: schema, nPredict: 40 * MAX_PER_CALL, ...sampling(execution) })
    recordGeneration('corrections', prompt.length, result, part.length)
    throwIfProcessingAborted(execution)
    if (result.completion?.interrupted) continue
    for (const candidate of parse(result.text)) {
      const usable = cleaned(candidate, part)
      if (!usable || found.some((known) => lower(known.old) === lower(usable.old) && lower(known.new) === lower(usable.new))) continue
      if (await confirmed(part, usable, execution)) found.push(usable)
      throwIfProcessingAborted(execution)
    }
  }
  return found
}

// The summary and the task list read the same note in two separate actions; one
// model pass serves both.
export const findSpokenCorrections = (
  texts: readonly string[], language: Language, execution?: ProcessingExecutionContext,
): Promise<SpokenCorrection[]> => {
  if (language !== 'pl' || !texts.some((text) => text.trim())) return Promise.resolve([])
  const key = texts.join('\u0000')
  const known = cache.get(key)
  if (known) return known
  const pending = askModel(texts, execution)
  cache.set(key, pending)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  pending.catch(() => cache.delete(key))
  return pending
}

// ---------------------------------------------------------------- applying

const SEPARATOR = '\u0000'
const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\d]/u.test(char)
const lower = (text: string): string => text.toLocaleLowerCase('pl')
const tidyValue = (text: string): string => text.trim().replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/gu, '')

// Every start of `needle` in `haystack` that sits on word boundaries.
const occurrences = (haystack: string, needle: string): number[] => {
  const found: number[] = []
  // indexOf('', n) never runs past the end, so an empty value would loop forever.
  if (!needle) return found
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) found.push(at)
  }
  return found
}

// "na sobotę" -> "na dziesiątą" mixes a day with an hour: not one value changed.
const WEEKDAY = /(?<![\p{L}\d])(?:poniedzia[lł]\p{L}*|wtor(?:ek|ku|ki)|środ(?:a|ę|y|zie|ach)|czwart(?:ek|ku|ki)|piąt(?:ek|ku|ki)|sobot\p{L}*|niedziel\p{L}*)(?![\p{L}\d])/iu
const RELATIVE_DAY = /(?<![\p{L}\d])(?:jutr\p{L}*|pojutrze|dzi(?:ś|siaj)|tydzie\p{L}*|tygodni\p{L}*|weekend\p{L}*|\d{1,2}\.\d{1,2})(?![\p{L}\d])/iu
const namesDay = (value: string): boolean => WEEKDAY.test(value) || RELATIVE_DAY.test(value)

// The old value as the speaker said it: the model sometimes quotes the whole
// "do dermatologa znaczy nie do okulisty" as the old value.
const cleaned = (correction: SpokenCorrection, joined?: string): SpokenCorrection | null => {
  const next = joined ? asSpoken(tidyValue(correction.new), joined) : tidyValue(correction.new)
  let old = joined ? asSpoken(tidyValue(correction.old), joined) : tidyValue(correction.old)
  if (lower(old).endsWith(lower(next))) old = tidyValue(old.slice(0, old.length - next.length))
  if (!old || !next || wordCount(old) > MAX_VALUE_WORDS || wordCount(next) > MAX_VALUE_WORDS) return null
  if (lower(next).includes(lower(old)) || lower(old).includes(lower(next))) return null
  if (namesDay(old) !== namesDay(next)) return null
  return { old, new: next, ...(correction.context ? { context: correction.context } : {}) }
}

// A change whose new value comes right after the old one ("cztery, nie, sześć")
// drops the old value and the words in between; a later change ("release w czwartek
// … przesuwamy na wtorek") puts the new value in place of the old one.
const NEAR_WORDS = 4
// Only a cue sits between them. "Hydraulik miał przyjść w środę, ale dzwonił, że jednak
// w czwartek" already says what changed; dropping "ale dzwonił" would lose who changed it.
const CUE_WORDS = new Set(['nie', 'czekaj', 'znaczy', 'to', 'sorry', 'sory', 'przepraszam', 'tylko', 'jednak', 'raczej', 'właściwie', 'poprawka', 'albo', 'yyy', 'eee', 'yy', 'ee', 'no', 'ups', 'źle', 'do', 'w', 'we', 'na', 'o', 'za', 'z', 'ze', 'od', 'po'])
const onlyCue = (between: string): boolean => (lower(between).match(/[\p{L}\d]+/gu) ?? []).every((word) => CUE_WORDS.has(word))

// How many words of the quoted change sentence sit around a mention of the new value:
// in a long note the same "piątek" may come up for several matters.
const QUOTE_WINDOW = 12
const quoteOverlap = (text: string, at: number, quote: readonly string[]): number => {
  const around = new Set(text.slice(Math.max(0, at - QUOTE_WINDOW * 8), at + QUOTE_WINDOW * 8).match(/[\p{L}\d]+/gu) ?? [])
  return quote.filter((word) => around.has(word)).length
}

type Mention = { at: number; length: number }

// Every mention of the old value, also in the other spelling of a number: the
// speaker says "4000" first and "cztery tysiące" when explaining the change.
const mentionsOf = (text: string, value: string): Mention[] => {
  const forms = [...new Set([lower(value), lower(wordsToDigits(value))])]
  return forms.flatMap((form) => occurrences(text, form).map((at) => ({ at, length: form.length }))).sort((a, b) => a.at - b.at)
}

// The mention of the new value that the change is about, and the old mentions before it.
const locate = (joined: string, correction: SpokenCorrection): { newAt: number; olds: Mention[] } | null => {
  const text = lower(joined)
  const quote = correction.context ? lower(correction.context).match(/[\p{L}\d]+/gu) ?? [] : []
  const mentions = mentionsOf(text, correction.old)
  const found = occurrences(text, lower(correction.new)).flatMap((newAt) => {
    const olds = mentions.filter((old) => old.at + old.length <= newAt)
    return olds.length ? [{ newAt, olds, overlap: quote.length ? quoteOverlap(text, newAt, quote) : 0 }] : []
  })
  if (!found.length) return null
  const best = found.reduce((top, item) => (item.overlap > top.overlap ? item : top))
  return { newAt: best.newAt, olds: best.olds }
}

// The model sometimes writes a number in words that the transcript has in digits.
const asSpoken = (value: string, joined: string): string => {
  if (occurrences(lower(joined), lower(value)).length) return value
  const digits = wordsToDigits(value)
  return digits !== value && occurrences(lower(joined), lower(digits)).length ? digits : value
}

// "zapłaciłem 300 zł za druk … poprawka, nie 300, tylko 350": every mention of the
// old value this close to the new one is the same matter.
const SAME_MATTER_WORDS = 80

const applyOne = (joined: string, correction: SpokenCorrection): string => {
  const at = locate(joined, correction)
  if (!at) return joined
  const newValue = joined.slice(at.newAt, at.newAt + correction.new.length)
  const nearest = at.olds[at.olds.length - 1]
  const between = joined.slice(nearest.at + nearest.length, at.newAt)
  if (wordCount(between) <= NEAR_WORDS && onlyCue(between)) {
    // Unit boundaries inside the dropped words stay where they are.
    const kept = between.replace(/[^\u0000]/gu, '')
    let result = joined.slice(0, nearest.at) + kept + joined.slice(at.newAt)
    const newAt = nearest.at + kept.length
    const close = at.olds.slice(0, -1).filter((old) => wordCount(result.slice(old.at, newAt)) <= SAME_MATTER_WORDS)
    for (const old of [...close].reverse()) result = result.slice(0, old.at) + newValue + result.slice(old.at + old.length)
    return result
  }
  // A later change: the first mention set the value; later ones usually explain the
  // change ("wcześniej mówiłam cztery tysiące, ale realnie to będzie 5200") and stay.
  const first = at.olds[0]
  // "sto czterdzieści złotych, nie, czekaj, sto czterdzieści to było bez napojów, z
  // napojami sto sześćdziesiąt pięć": the speaker settles it in place; the text says it all.
  const second = at.olds[1]
  if (second && wordCount(joined.slice(first.at + first.length, second.at)) <= QUOTE_WINDOW) return joined
  return joined.slice(0, first.at) + newValue + joined.slice(first.at + first.length)
}

// Corrections applied to consecutive pieces of one note (its sentence units),
// returned piece by piece so each keeps its place in the recorded text.
export const applySpokenCorrections = (pieces: readonly string[], corrections: readonly SpokenCorrection[]): string[] => {
  if (!corrections.length || pieces.some((piece) => piece.includes(SEPARATOR))) return [...pieces]
  let joined = pieces.join(SEPARATOR)
  for (const correction of corrections) {
    const usable = cleaned(correction, joined)
    if (usable) joined = applyOne(joined, usable)
  }
  return joined.split(SEPARATOR).map((piece) => piece.replace(/\s{2,}/gu, ' '))
}

export const correctedText = (text: string, corrections: readonly SpokenCorrection[]): string =>
  applySpokenCorrections([text], corrections)[0]
