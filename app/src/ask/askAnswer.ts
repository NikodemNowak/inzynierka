import { generate } from '../ai/llm'
import { promptView, wordsToDigits } from '../ai/polishNumbers'
import { englishWordsToDigits } from './englishNumbers'
import type { Language } from '../i18n/language'
import { localeForLanguage } from '../i18n/language'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { resolveDue, splitTaskText } from '../tasks/taskDue'
import { plain } from './askText'
import { asksForTasks, isTaskQuestion, questionDays } from './askRetrieval'
import type { AskChunk, AskIndex, AskNote } from './askIndex'
import type { RetrievedNote } from './askRetrieval'

// The answer is written by the on-device model from the retrieved passages only.
// Notes are numbered [1], [2] in the prompt; the model cites those numbers and
// the screen turns them into links to the notes.

export interface AskSource {
  number: number
  noteId: string
  title: string
}

// One row of a list answer built in code: it opens its note.
export interface AskItem {
  text: string
  noteId: string
  // Deadline label ("16:30", "pt. 17 paź · 9:00"); absent when there is nothing to show.
  due?: string
  overdue?: boolean
  // Heading of the group the row sits under ("Zaległe").
  group?: string
}

export interface AskAnswer {
  text: string
  sources: AskSource[]
  // Answer computed in code from the tasks, without the model.
  deterministic?: boolean
  // Lead-in line above the rows of a deterministic list.
  intro?: string
  items?: AskItem[]
  // Questions offered after the answer.
  followUps?: string[]
  // The notes the answer cites, in citation order.
  cited: AskSource[]
  // The first answer was "not found" and a second look at the best note answered.
  retried?: boolean
  // Model calls behind this answer, for the measurement suite.
  generations?: AskGeneration[]
}

export interface AskGeneration {
  promptTokens: number
  predictedTokens: number
  promptMs: number
  predictedMs: number
}

const YES_NO_QUESTION = /^(?:czy|should|do|does|did|is|are|can|will|must|have)\b/iu
const NOT_FOUND =/nie znalaz(?:łem|łam)|nie ma (?:tego|informacji)|couldn't find|could not find|no information/iu

const formatDay = (ms: number, language: Language): string =>
  new Date(ms).toLocaleDateString(localeForLanguage(language), { weekday: 'long', day: 'numeric', month: 'long' })

const formatMoment = (date: Date, allDay: boolean, language: Language): string =>
  allDay ? formatDay(date.getTime(), language) : `${formatDay(date.getTime(), language)}, ${date.toLocaleTimeString(localeForLanguage(language), { hour: '2-digit', minute: '2-digit' })}`

const DAY = 86400000
const DAY_PHRASE = /(?<![\p{L}])(?:(?:w\s+|we\s+|na\s+|on\s+|next\s+|this\s+)?(?:przysz\p{L}+\s+|ten\s+|t[eę]\s+)?)(?:dzi[sś]|dzisiaj|jutr\p{L}*|pojutrze|poniedzia\p{L}*|wtor\p{L}*|[sś]rod(?:a|ę|e|y|zie|ą)|czwart(?:ek|ku|kiem)|pi[aą]t(?:ek|ku|kiem)|sobot\p{L}*|niedziel\p{L}*|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![\p{L}])/giu
// "do czwartku piątego" already names its day of the month: the next Thursday would contradict it.
const DATE_FOLLOWS = /^[,\s]*(?:the\s+)?\d|^[,\s]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*\s+\d|^[,\s]*(?:pierwsz|drugi|trzeci|czwart|piąt|szóst|siódm|ósm|dziewiąt|dziesiąt|jedenast|dwunast|trzynast|czternast|piętnast|szesnast|siedemnast|osiemnast|dziewiętnast|dwudziest|trzydziest)(?:ego|ej)(?![\p{L}])/iu

// The model reads "jutro o szesnastej" badly and cannot count days: numbers
// become digits and every relative day gets its calendar day, counted from the
// recording ("w czwartek [15 października]").
const PL_MONTHS = ['stycz', 'lut', 'mar', 'kwie', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'paźdz', 'listop', 'grud']
const STATED_DATE = /(?<!\d)(\d{1,2})\s+(stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|paźdz|listop|grud)\p{L}*/giu
const WEEKDAY_INDEX: readonly (readonly [RegExp, number])[] = [
  [/^niedziel/iu, 0], [/^poniedzia/iu, 1], [/^wtor/iu, 2], [/^[sś]rod/iu, 3], [/^czwart/iu, 4], [/^pi[aą]t/iu, 5], [/^sobot/iu, 6],
]
// "urodziny 7 listopada to jest sobota": the weekday names the date just said.
const DATE_BEFORE = /(?<!\d)\d{1,2}\s+(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|paźdz|listop|grud)\p{L}*[\s,]+(?:\p{L}+\s+){0,3}$/iu
// Dates the note states outright, from the recording on: "na sobotę" in a note that
// says "urodziny 7 listopada, sobota" is that Saturday, not the nearest one.
const statedDays = (content: string, recorded: Date): number[] => {
  const start = new Date(recorded.getFullYear(), recorded.getMonth(), recorded.getDate()).getTime()
  return [...wordsToDigits(content).matchAll(STATED_DATE)].flatMap((match) => {
    const month = PL_MONTHS.findIndex((stem) => match[2]!.toLowerCase().startsWith(stem))
    const day = new Date(recorded.getFullYear(), month, Number(match[1])).getTime()
    const next = day < start ? new Date(recorded.getFullYear() + 1, month, Number(match[1])).getTime() : day
    return next - start <= 31 * DAY ? [next] : []
  })
}

const withDays = (text: string, note: AskNote, now: Date, language: Language): string => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const stated = language === 'pl' ? statedDays(note.content, new Date(note.createdAt)) : []
  return text.replace(DAY_PHRASE, (phrase: string, offset: number) => {
    if (DATE_FOLLOWS.test(text.slice(offset + phrase.length, offset + phrase.length + 16))) return phrase
    if (DATE_BEFORE.test(text.slice(Math.max(0, offset - 40), offset))) return phrase
    const resolved = resolveDue(phrase, new Date(note.createdAt))
    if (!resolved) return phrase
    const weekday = phrase.split(/\s+/u).map((word) => WEEKDAY_INDEX.find(([pattern]) => pattern.test(word))?.[1]).find((value) => value !== undefined)
    const named = weekday === undefined ? undefined : stated.find((day) => new Date(day).getDay() === weekday)
    const day = named ?? new Date(resolved.date.getFullYear(), resolved.date.getMonth(), resolved.date.getDate()).getTime()
    const shift = Math.round((day - today) / DAY)
    const relative = language === 'pl'
      ? shift === 0 ? ', dziś' : shift === 1 ? ', jutro' : shift === -1 ? ', wczoraj' : ''
      : shift === 0 ? ', today' : shift === 1 ? ', tomorrow' : shift === -1 ? ', yesterday' : ''
    const date = new Date(day).toLocaleDateString(localeForLanguage(language), { day: 'numeric', month: 'long' })
    // "jutro" would be repeated as is; the date replaces it. A weekday keeps its name.
    const lead = /^(?:w|we|na|on|next|this)\s/iu.exec(phrase)?.[0] ?? ''
    if (/(?:dzi[sś]|dzisiaj|jutr\p{L}*|pojutrze|today|tonight|tomorrow)$/iu.test(phrase)) {
      const of = language === 'pl' ? '' : 'on '
      return `${lead ? lead : of}${date} (${relative.replace(/^, /u, '') || (language === 'pl' ? 'data' : 'date')})`.replace(/ \((?:data|date)\)$/u, '')
    }
    return `${phrase} ${date}${relative ? ` (${relative.replace(/^, /u, '')})` : ''}`
  })
}

const readable = (text: string, note: AskNote | undefined): string =>
  (note?.language ?? (/[ąćęłńóśźż]/iu.test(text) ? 'pl' : 'en')) === 'pl' ? wordsToDigits(promptView(text)) : englishWordsToDigits(text)

// "dziś", "jutro", "zaległe, 3 dni": where the deadline sits relative to now.
export const relativeMarker = (day: number, now: Date, language: Language): string => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const shift = Math.round((day - today) / DAY)
  if (shift === 0) return language === 'pl' ? 'dziś' : 'today'
  if (shift === 1) return language === 'pl' ? 'jutro' : 'tomorrow'
  if (shift > 1) return language === 'pl' ? `za ${shift} dni` : `in ${shift} days`
  const days = -shift
  return language === 'pl' ? `zaległe, ${days} ${days === 1 ? 'dzień' : 'dni'}` : `overdue, ${days} ${days === 1 ? 'day' : 'days'}`
}

const passageLine = (chunk: AskChunk, index: AskIndex, language: Language, now: Date): string => {
  const note = index.notes.get(chunk.noteId)
  const shorthand = chunk.kind === 'point' ? (language === 'pl' ? 'Skrót: ' : 'Summary: ') : ''
  if (chunk.kind !== 'task') return shorthand + (note ? withDays(readable(chunk.text, note), note, now, language) : chunk.text)
  const { title, due } = splitTaskText(chunk.text)
  const resolved = due && note ? resolveDue(due, new Date(note.createdAt)) : null
  const dayStart = resolved ? new Date(resolved.date.getFullYear(), resolved.date.getMonth(), resolved.date.getDate()).getTime() : 0
  const marker = resolved && !chunk.done ? `, ${relativeMarker(dayStart, now, language)}` : ''
  const unclear = language === 'pl' ? 'termin niejasny' : 'date unclear'
  const when = resolved ? ` (${formatMoment(resolved.date, resolved.allDay, language)}${marker})` : due ? ` (${unclear})` : ''
  const label = language === 'pl' ? (chunk.done ? 'Zadanie (zrobione)' : 'Zadanie') : chunk.done ? 'Task (done)' : 'Task'
  return `${label}: ${readable(title, note)}${when}`
}

// A sentence reads better with its neighbours ("…at six. It was moved from Wednesday.").
const withNeighbours = (note: RetrievedNote, index: AskIndex): AskChunk[] => {
  const sentences = index.chunks.filter((chunk) => chunk.noteId === note.noteId && chunk.kind === 'sentence')
  const wanted = new Set<number>()
  for (const passage of note.passages) {
    if (passage.kind !== 'sentence') continue
    for (const order of [passage.order - 1, passage.order, passage.order + 1]) wanted.add(order)
  }
  const context = sentences.filter((chunk) => wanted.has(chunk.order))
  const others = note.passages.filter((passage) => passage.kind !== 'sentence')
  // The shorthand first, the note's own sentences after it in recording order.
  return [...others, ...context]
}

// In a long note the chat must tell which of two values came later.
const PLACED_FROM = 12
const placeOf = (chunk: AskChunk, index: AskIndex, language: Language): string => {
  if (chunk.kind !== 'sentence') return ''
  const total = index.chunks.filter((other) => other.noteId === chunk.noteId && other.kind === 'sentence').length
  if (total < PLACED_FROM) return ''
  const third = Math.min(2, Math.floor((3 * chunk.order) / total))
  const pl = ['(początek nagrania) ', '(środek nagrania) ', '(koniec nagrania) ']
  const en = ['(start of recording) ', '(middle of recording) ', '(end of recording) ']
  return (language === 'pl' ? pl : en)[third]
}

// Rough token count for Polish/English text on a Qwen tokenizer.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5)

// A day question picks its passages by date; their neighbours only lengthen the prompt.
// With maxTokens, the lowest-ranked passages (the last of the last notes) are dropped
// until the context fits, instead of overflowing the model window.
export const buildAskContext = (
  retrieved: readonly RetrievedNote[],
  index: AskIndex,
  language: Language,
  now: Date,
  neighbours = true,
  maxTokens = Number.POSITIVE_INFINITY,
): { context: string; sources: AskSource[] } => {
  const entries = retrieved.map((note) => {
    const info = index.notes.get(note.noteId)
    const title = info?.title.trim() || (language === 'pl' ? 'Bez tytułu' : 'Untitled')
    const recorded = info ? formatDay(info.createdAt, language) : ''
    const lines = (neighbours ? withNeighbours(note, index) : note.passages).map((chunk) => `- ${placeOf(chunk, index, language)}${passageLine(chunk, index, language, now)}`)
    return { noteId: note.noteId, title, recorded, lines }
  })
  const render = (): string =>
    entries.map((entry, position) => {
      const number = position + 1
      const header = language === 'pl' ? `[${number}] Notatka „${entry.title}”, nagrana ${entry.recorded}:` : `[${number}] Note "${entry.title}", recorded ${entry.recorded}:`
      return [header, ...entry.lines].join('\n')
    }).join('\n\n')
  let context = render()
  while (estimateTokens(context) > maxTokens) {
    const last = entries.at(-1)
    if (!last || (entries.length === 1 && last.lines.length <= 1)) break
    if (last.lines.length > 1) last.lines.pop()
    else entries.pop()
    context = render()
  }
  const sources = entries.map((entry, position): AskSource => ({ number: position + 1, noteId: entry.noteId, title: entry.title }))
  return { context, sources }
}

const SYSTEM_PL = 'Odpowiadasz na pytania użytkownika o jego własne notatki głosowe. Korzystasz wyłącznie z podanych fragmentów notatek. Odpowiadasz po polsku, krótko i konkretnie.'
const SYSTEM_EN = "You answer the user's questions about their own voice notes. You use only the note excerpts provided. You answer in English, briefly and to the point."

const rules = (language: Language, today: string): string =>
  language === 'pl'
    ? [
        `Dzisiaj jest ${today}.`,
        'Zasady:',
        '1. Odpowiedz tylko na podstawie fragmentów. Nie dodawaj niczego, czego w nich nie ma.',
        '2. Po każdej informacji wpisz numer notatki w nawiasie kwadratowym, np. [1].',
        '3. Daty w notatkach są już przeliczone na kalendarz („20 października (dziś)”). Podawaj je tak, jak są we fragmentach.',
        '4. Zdania jednej notatki są w kolejności nagrania. Gdy notatka się poprawia albo późniejsze zdanie podaje inną wartość w tej samej sprawie („nie, czekaj”, „jednak”, „przełożyli”, „zmiana planów”, „realnie wyjdzie”), obowiązuje późniejsze: podaj je jako odpowiedź.',
        '5. Zachowaj zaprzeczenia i warunki („nie kupować”, „tylko jeśli”). Linie „Skrót:” i „Zadanie:” to skrót notatki zrobiony wcześniej; gdy zdanie notatki mówi co innego, obowiązuje zdanie (a z kilku zdań późniejsze).',
        '6. Notatki to zapis mowy, więc słowa bywają przekręcone („pen” zamiast „pendrive”, „Krakoff” zamiast „Kraków”). Odpowiadaj tylko wtedy, gdy fragment wyraźnie mówi o tej sprawie. Gdy brakuje szczegółu z pytania, napisz krótko, czego notatka nie podaje. Gdy żaden fragment nie mówi o tej sprawie, napisz: „Nie znalazłem tego w notatkach.”',
        '7. Liczby i godziny pisz cyframi.',
        '8. Gdy pytanie dotyczy rzeczy do zrobienia, wypisz każdą z fragmentów jako listę z myślnikami. W innym wypadku najwyżej 3 zdania.',
        '9. Na pytanie „Czy…?” zacznij od „Tak” albo „Nie” według fragmentu („chleba nie kupuję” znaczy „Nie”), a potem w tym samym zdaniu podaj, co mówi notatka. Nie przepisuj wtrąceń typu „nie, czekaj”.',
        '10. Gdy odpowiedź jest w kilku notatkach, uwzględnij wszystkie. Gdy notatki mówią co innego (np. jedna „kupić mleko”, druga „mleka nie kupuj”), podaj obie wersje z datami nagrania; nowsza zwykle obowiązuje.',
        'Fragmenty mogą być po angielsku; odpowiedz wtedy po polsku na ich podstawie.',
      ].join('\n')
    : [
        `Today is ${today}.`,
        'Rules:',
        '1. Answer only from the excerpts. Do not add anything they do not say.',
        '2. After each piece of information write the note number in square brackets, e.g. [1].',
        '3. Dates in the notes are already turned into calendar days ("October 20 (today)"). Give them as they appear in the excerpts.',
        '4. The sentences of one note are in recording order. When a note corrects itself or a later sentence gives another value for the same matter ("no, wait", "actually", "moved to", "change of plans"), the later one counts: give it as the answer.',
        '5. Keep negations and conditions ("don\'t buy", "only if"). "Summary:" and "Task:" lines are shorthand made earlier; when a sentence of the note says otherwise, the sentence counts (and of several sentences, the later one).',
        '6. The notes are transcribed speech, so words can be garbled ("pen" for "pendrive", "Krakoff" for "Krakow"). Answer only when an excerpt clearly talks about the matter. When a detail of the question is missing, briefly say what the note does not give. When no excerpt talks about it, write: "I couldn\'t find that in your notes."',
        '7. Write numbers and times with digits.',
        '8. When the question is about things to do, list every one from the excerpts with dashes. Otherwise at most 3 sentences.',
        '9. For a yes/no question start with "Yes" or "No" as the excerpt says ("I won\'t buy bread" means "No"), then in the same sentence say what the note says. Do not copy fillers like "no, wait".',
        '10. When the answer is in several notes, include all of them. When notes disagree (e.g. one says "buy milk", another "don\'t buy milk"), give both with their recording dates; the newer one usually counts.',
        'The notes may be in Polish; answer in English anyway.',
      ].join('\n')

export const askPrompt = (question: string, context: string, history: readonly { question: string; answer: string }[], language: Language, now: Date): string => {
  const today = formatDay(now.getTime(), language)
  // Earlier answers are not fed back: the small model copies their mistakes. Questions give the topic.
  const earlier = history.slice(-2).map((turn) => `- ${turn.question}`).join('\n')
  // A question about things to do gets a list; the model otherwise answers with one of them.
  const list = asksForTasks(question, now)
    ? language === 'pl'
      ? 'Wypisz każdą rzecz do zrobienia z fragmentów, których dotyczy pytanie, w osobnej linii z myślnikiem, z terminem w nawiasie.'
      : 'List every thing to do from the excerpts the question is about, one per line with a dash, with its date in brackets.'
    : ''
  const parts = language === 'pl'
    ? [rules(language, today), `FRAGMENTY NOTATEK:\n${context || '(brak pasujących fragmentów)'}`, earlier ? `WCZEŚNIEJSZE PYTANIA UŻYTKOWNIKA:\n${earlier}` : '', `PYTANIE: ${question}`, list, 'ODPOWIEDŹ:']
    : [rules(language, today), `NOTE EXCERPTS:\n${context || '(no matching excerpts)'}`, earlier ? `EARLIER QUESTIONS FROM THE USER:\n${earlier}` : '', `QUESTION: ${question}`, list, 'ANSWER:']
  return parts.filter(Boolean).join('\n\n')
}

export const askSystem = (language: Language): string => (language === 'pl' ? SYSTEM_PL : SYSTEM_EN)

export const parseAnswer = (raw: string, sources: readonly AskSource[]): AskAnswer => {
  const known = new Set(sources.map((source) => source.number))
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<\/?think>/gu, '')
    // Only [n] citations stay in brackets, and only those that point to a real note.
    .replace(/\s*\[(?!\d+\])[^\]\n]{1,40}\]/gu, '')
    .replace(/\s*\[(\d+)\]/gu, (match: string, number: string) => (known.has(Number(number)) ? match : ''))
    .trim()
  const cited: AskSource[] = []
  for (const match of text.matchAll(/\[(\d+)\]/gu)) {
    const source = sources.find((item) => item.number === Number(match[1]))
    if (source && !cited.includes(source)) cited.push(source)
  }
  // The model forgot the numbers: the best note is the likely origin, unless it found nothing.
  const first = sources[0]
  if (!cited.length && first && text && !NOT_FOUND.test(text)) cited.push(first)
  return { text, sources: [...sources], cited }
}

export const ASK_OUTPUT_TOKENS = 260

export const answerQuestion = async (
  question: string,
  retrieved: readonly RetrievedNote[],
  index: AskIndex,
  language: Language,
  options: { now: Date; history?: readonly { question: string; answer: string }[]; onToken?: (token: string) => void; signal?: AbortSignal; contextTokens?: number },
): Promise<AskAnswer> => {
  const dayList = isTaskQuestion(question, options.now) && questionDays(question, options.now) !== null
  const history = options.history ?? []
  // The prompt must fit the model window with room for the answer: passages are trimmed, not the rules.
  const frame = askPrompt(question, '', history, language, options.now)
  const budget = (options.contextTokens ?? MODEL_CONFIG.nCtx) - ASK_OUTPUT_TOKENS - estimateTokens(frame + askSystem(language)) - 120
  const { context, sources } = buildAskContext(retrieved, index, language, options.now, !dayList, Math.max(200, budget))
  const prompt = askPrompt(question, context, history, language, options.now)
  const generations: AskGeneration[] = []
  const run = async (temperature: number, onToken: (token: string) => void, text = prompt) => {
    const result = await generate(text, onToken, {
      system: askSystem(language),
      nPredict: ASK_OUTPUT_TOKENS,
      temperature,
      topP: 0.8,
      topK: 20,
      minP: 0,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    generations.push({ promptTokens: result.promptTokens ?? 0, predictedTokens: result.predictedTokens ?? 0, promptMs: result.promptMs ?? 0, predictedMs: result.predictedMs ?? 0 })
    return result
  }
  const stats = (answer: AskAnswer): AskAnswer => ({ ...answer, generations })
  const first = parseAnswer((await run(0.2, options.onToken ?? (() => undefined))).text, sources)
  // The small model sometimes repeats the question instead of answering; one warmer retry fixes it.
  const bare = (text: string): string => plain(text.replace(/\[\d+\]/gu, '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (bare(first.text) === bare(question)) return stats(parseAnswer((await run(0.6, () => undefined)).text, sources))
  // "Nie, czekaj [1]." copies the speaker's filler; a bare "Nie." gives no reason.
  if (YES_NO_QUESTION.test(question.trim()) && sources.length && bare(first.text.replace(/^(nie|no)[,\s]+(?:czekaj|wait)\b/iu, '$1')).split(' ').filter(Boolean).length <= 3) {
    const hint = language === 'pl'
      ? '\n\nOdpowiedz „Tak” albo „Nie”, a potem w tym samym zdaniu podaj, co dokładnie mówi notatka i dlaczego.'
      : '\n\nAnswer "Yes" or "No", then in the same sentence say what exactly the note says and why.'
    const fuller = parseAnswer((await run(0.2, () => undefined, prompt.replace(/\n\n(?:ODPOWIEDŹ|ANSWER):$/u, `${hint}$&`))).text, sources)
    if (bare(fuller.text).split(' ').length > 3 && !NOT_FOUND.test(fuller.text)) return stats(fuller)
  }
  // A recognizer that dropped a word ("Prague") makes the model refuse a note
  // that does answer; one second look at the best note, told so, recovers it.
  if (sources.length && NOT_FOUND.test(first.text) && first.text.length < 120) {
    const hint = language === 'pl'
      ? `\n\nUWAGA: Notatka [1] prawdopodobnie dotyczy tej sprawy, choć zapis mowy mógł przekręcić lub pominąć niektóre słowa. Jeśli tak, odpowiedz na jej podstawie i dopisz, czego w niej brakuje. Jeśli naprawdę nie dotyczy, napisz: „Nie znalazłem tego w notatkach.”`
      : `\n\nNOTE: Note [1] is probably about this matter, though the transcript may have garbled or dropped some words. If so, answer from it and say what is missing. If it really is not about it, write: "I couldn't find that in your notes."`
    const second = parseAnswer((await run(0.2, () => undefined, prompt.replace(/\n\n(?:ODPOWIEDŹ|ANSWER):$/u, `${hint}$&`))).text, sources)
    if (!NOT_FOUND.test(second.text)) return stats({ ...second, retried: true })
  }
  return stats(first)
}
