import { generate } from '../ai/llm'
import { promptView, wordsToDigits } from '../ai/polishNumbers'
import { englishWordsToDigits } from './englishNumbers'
import type { Language } from '../i18n/language'
import { localeForLanguage } from '../i18n/language'
import { resolveDue, splitTaskText } from '../tasks/taskDue'
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

export interface AskAnswer {
  text: string
  sources: AskSource[]
  // The notes the answer cites, in citation order.
  cited: AskSource[]
}

const formatDay = (ms: number, language: Language): string =>
  new Date(ms).toLocaleDateString(localeForLanguage(language), { weekday: 'long', day: 'numeric', month: 'long' })

const formatMoment = (date: Date, allDay: boolean, language: Language): string =>
  allDay ? formatDay(date.getTime(), language) : `${formatDay(date.getTime(), language)}, ${date.toLocaleTimeString(localeForLanguage(language), { hour: '2-digit', minute: '2-digit' })}`

const DAY = 86400000
const DAY_PHRASE = /(?<![\p{L}])(?:(?:w\s+|we\s+|na\s+|on\s+|next\s+|this\s+)?(?:przysz\p{L}+\s+|ten\s+|t[eę]\s+)?)(?:dzi[sś]|dzisiaj|jutr\p{L}*|pojutrze|poniedzia\p{L}*|wtor\p{L}*|[sś]rod\p{L}*|czwart\p{L}*|pi[aą]t\p{L}*|sobot\p{L}*|niedziel\p{L}*|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![\p{L}])/giu
const DATE_FOLLOWS = /^[,\s]*(?:the\s+)?\d|^[,\s]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*\s+\d/iu

// The model reads "jutro o szesnastej" badly and cannot count days: numbers
// become digits and every relative day gets its calendar day, counted from the
// recording ("w czwartek [15 października]").
const withDays = (text: string, note: AskNote, now: Date, language: Language): string => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return text.replace(DAY_PHRASE, (phrase: string, offset: number) => {
    if (DATE_FOLLOWS.test(text.slice(offset + phrase.length, offset + phrase.length + 16))) return phrase
    const resolved = resolveDue(phrase, new Date(note.createdAt))
    if (!resolved) return phrase
    const day = new Date(resolved.date.getFullYear(), resolved.date.getMonth(), resolved.date.getDate()).getTime()
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

const passageLine = (chunk: AskChunk, index: AskIndex, language: Language, now: Date): string => {
  const note = index.notes.get(chunk.noteId)
  if (chunk.kind !== 'task') return note ? withDays(readable(chunk.text, note), note, now, language) : chunk.text
  const { title, due } = splitTaskText(chunk.text)
  const resolved = due && note ? resolveDue(due, new Date(note.createdAt)) : null
  const when = resolved ? ` (${formatMoment(resolved.date, resolved.allDay, language)})` : due ? ` (${due})` : ''
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
  return [...context, ...others]
}

export const buildAskContext = (retrieved: readonly RetrievedNote[], index: AskIndex, language: Language, now: Date): { context: string; sources: AskSource[] } => {
  const sources: AskSource[] = []
  const blocks = retrieved.map((note, position) => {
    const info = index.notes.get(note.noteId)
    const number = position + 1
    const title = info?.title.trim() || (language === 'pl' ? 'Bez tytułu' : 'Untitled')
    sources.push({ number, noteId: note.noteId, title })
    const recorded = info ? formatDay(info.createdAt, language) : ''
    const header = language === 'pl' ? `[${number}] Notatka „${title}”, nagrana ${recorded}:` : `[${number}] Note "${title}", recorded ${recorded}:`
    const lines = withNeighbours(note, index).map((chunk) => `- ${passageLine(chunk, index, language, now)}`)
    return [header, ...lines].join('\n')
  })
  return { context: blocks.join('\n\n'), sources }
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
        '4. Gdy notatka się poprawia („nie, czekaj”, „jednak”, „przesunięte na”), obowiązuje późniejsza wersja.',
        '5. Zachowaj zaprzeczenia i warunki („nie kupować”, „tylko jeśli”).',
        '6. Gdy odpowiedzi nie ma we fragmentach, napisz: „Nie znalazłem tego w notatkach.”',
        '7. Liczby i godziny pisz cyframi.',
        '8. Gdy pytanie dotyczy rzeczy do zrobienia, wypisz każdą z fragmentów jako listę z myślnikami. W innym wypadku najwyżej 3 zdania.',
      ].join('\n')
    : [
        `Today is ${today}.`,
        'Rules:',
        '1. Answer only from the excerpts. Do not add anything they do not say.',
        '2. After each piece of information write the note number in square brackets, e.g. [1].',
        '3. Dates in the notes are already turned into calendar days ("October 20 (today)"). Give them as they appear in the excerpts.',
        '4. When a note corrects itself ("no, wait", "actually", "moved to"), the later version counts.',
        '5. Keep negations and conditions ("don\'t buy", "only if").',
        '6. If the excerpts do not contain the answer, write: "I couldn\'t find that in your notes."',
        '7. Write numbers and times with digits.',
        '8. When the question is about things to do, list every one from the excerpts with dashes. Otherwise at most 3 sentences.',
        'The notes may be in Polish; answer in English anyway.',
      ].join('\n')

export const askPrompt = (question: string, context: string, history: readonly { question: string; answer: string }[], language: Language, now: Date): string => {
  const today = formatDay(now.getTime(), language)
  const earlier = history.slice(-2).map((turn) => (language === 'pl' ? `Pytanie: ${turn.question}\nOdpowiedź: ${turn.answer}` : `Question: ${turn.question}\nAnswer: ${turn.answer}`)).join('\n\n')
  const parts = language === 'pl'
    ? [rules(language, today), `FRAGMENTY NOTATEK:\n${context || '(brak pasujących fragmentów)'}`, earlier ? `WCZEŚNIEJ W ROZMOWIE:\n${earlier}` : '', `PYTANIE: ${question}`, 'ODPOWIEDŹ:']
    : [rules(language, today), `NOTE EXCERPTS:\n${context || '(no matching excerpts)'}`, earlier ? `EARLIER IN THE CONVERSATION:\n${earlier}` : '', `QUESTION: ${question}`, 'ANSWER:']
  return parts.filter(Boolean).join('\n\n')
}

export const askSystem = (language: Language): string => (language === 'pl' ? SYSTEM_PL : SYSTEM_EN)

export const parseAnswer = (raw: string, sources: readonly AskSource[]): AskAnswer => {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<\/?think>/gu, '').trim()
  const cited: AskSource[] = []
  for (const match of text.matchAll(/\[(\d+)\]/gu)) {
    const source = sources.find((item) => item.number === Number(match[1]))
    if (source && !cited.includes(source)) cited.push(source)
  }
  return { text, sources: [...sources], cited }
}

export const ASK_OUTPUT_TOKENS = 260

export const answerQuestion = async (
  question: string,
  retrieved: readonly RetrievedNote[],
  index: AskIndex,
  language: Language,
  options: { now: Date; history?: readonly { question: string; answer: string }[]; onToken?: (token: string) => void; signal?: AbortSignal },
): Promise<AskAnswer> => {
  const { context, sources } = buildAskContext(retrieved, index, language, options.now)
  const prompt = askPrompt(question, context, options.history ?? [], language, options.now)
  const result = await generate(prompt, options.onToken ?? (() => undefined), {
    system: askSystem(language),
    nPredict: ASK_OUTPUT_TOKENS,
    temperature: 0.2,
    topP: 0.8,
    topK: 20,
    minP: 0,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return parseAnswer(result.text, sources)
}
