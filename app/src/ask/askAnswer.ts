import { generate } from '../ai/llm'
import { promptView, wordsToDigits } from '../ai/polishNumbers'
import { englishWordsToDigits } from './englishNumbers'
import type { Language } from '../i18n/language'
import { localeForLanguage } from '../i18n/language'
import { resolveDue, splitTaskText } from '../tasks/taskDue'
import { plain } from './askText'
import { isTaskQuestion } from './askRetrieval'
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
  // The first answer was "not found" and a second look at the best note answered.
  retried?: boolean
}

const YES_NO_QUESTION = /^(?:czy|should|do|does|did|is|are|can|will|must|have)\b/iu
const NOT_FOUND =/nie znalaz(?:łem|łam)|nie ma (?:tego|informacji)|couldn't find|could not find|no information/iu

const formatDay = (ms: number, language: Language): string =>
  new Date(ms).toLocaleDateString(localeForLanguage(language), { weekday: 'long', day: 'numeric', month: 'long' })

const formatMoment = (date: Date, allDay: boolean, language: Language): string =>
  allDay ? formatDay(date.getTime(), language) : `${formatDay(date.getTime(), language)}, ${date.toLocaleTimeString(localeForLanguage(language), { hour: '2-digit', minute: '2-digit' })}`

const DAY = 86400000
const DAY_PHRASE = /(?<![\p{L}])(?:(?:w\s+|we\s+|na\s+|on\s+|next\s+|this\s+)?(?:przysz\p{L}+\s+|ten\s+|t[eę]\s+)?)(?:dzi[sś]|dzisiaj|jutr\p{L}*|pojutrze|poniedzia\p{L}*|wtor\p{L}*|[sś]rod(?:a|ę|e|y|zie|ą)|czwart(?:ek|ku|kiem)|pi[aą]t(?:ek|ku|kiem)|sobot\p{L}*|niedziel\p{L}*|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![\p{L}])/giu
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
        '5. Zachowaj zaprzeczenia i warunki („nie kupować”, „tylko jeśli”). Linie „Zadanie:” są skrótem notatki; gdy zdanie notatki mówi co innego, obowiązuje zdanie.',
        '6. Notatki to zapis mowy, więc słowa bywają przekręcone („pen” zamiast „pendrive”, „Krakoff” zamiast „Kraków”). Gdy fragment mówi o tej samej sprawie, nawet innymi słowami albo bez jakiegoś szczegółu z pytania (np. nazwy miasta), odpowiedz na jego podstawie i dopisz krótko, czego notatka nie mówi. Gdy żaden fragment nie mówi o tej sprawie, napisz: „Nie znalazłem tego w notatkach.”',
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
        '4. When a note corrects itself ("no, wait", "actually", "moved to"), the later version counts.',
        '5. Keep negations and conditions ("don\'t buy", "only if"). "Task:" lines are shorthand; when a sentence of the note says otherwise, the sentence counts.',
        '6. The notes are transcribed speech, so words can be garbled ("pen" for "pendrive", "Krakoff" for "Krakow"). When an excerpt talks about the same matter, even in other words or without some detail of the question (e.g. the city name), answer from it and briefly say what the note does not say. When no excerpt talks about it, write: "I couldn\'t find that in your notes."',
        '7. Write numbers and times with digits.',
        '8. When the question is about things to do, list every one from the excerpts with dashes. Otherwise at most 3 sentences.',
        '9. For a yes/no question start with "Yes" or "No" as the excerpt says ("I won\'t buy bread" means "No"), then in the same sentence say what the note says. Do not copy fillers like "no, wait".',
        '10. When the answer is in several notes, include all of them. When notes disagree (e.g. one says "buy milk", another "don\'t buy milk"), give both with their recording dates; the newer one usually counts.',
        'The notes may be in Polish; answer in English anyway.',
      ].join('\n')

export const askPrompt = (question: string, context: string, history: readonly { question: string; answer: string }[], language: Language, now: Date): string => {
  const today = formatDay(now.getTime(), language)
  const earlier = history.slice(-2).map((turn) => (language === 'pl' ? `Pytanie: ${turn.question}\nOdpowiedź: ${turn.answer}` : `Question: ${turn.question}\nAnswer: ${turn.answer}`)).join('\n\n')
  // A question about things to do gets a list; the model otherwise answers with one of them.
  const list = isTaskQuestion(question)
    ? language === 'pl'
      ? 'Wypisz każdą rzecz do zrobienia z fragmentów, których dotyczy pytanie, w osobnej linii z myślnikiem, z terminem w nawiasie.'
      : 'List every thing to do from the excerpts the question is about, one per line with a dash, with its date in brackets.'
    : ''
  const parts = language === 'pl'
    ? [rules(language, today), `FRAGMENTY NOTATEK:\n${context || '(brak pasujących fragmentów)'}`, earlier ? `WCZEŚNIEJ W ROZMOWIE:\n${earlier}` : '', `PYTANIE: ${question}`, list, 'ODPOWIEDŹ:']
    : [rules(language, today), `NOTE EXCERPTS:\n${context || '(no matching excerpts)'}`, earlier ? `EARLIER IN THE CONVERSATION:\n${earlier}` : '', `QUESTION: ${question}`, list, 'ANSWER:']
  return parts.filter(Boolean).join('\n\n')
}

export const askSystem = (language: Language): string => (language === 'pl' ? SYSTEM_PL : SYSTEM_EN)

export const parseAnswer = (raw: string, sources: readonly AskSource[]): AskAnswer => {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<\/?think>/gu, '')
    // Only [n] citations stay in brackets.
    .replace(/\s*\[(?!\d+\])[^\]\n]{1,40}\]/gu, '')
    .trim()
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
  const run = (temperature: number, onToken: (token: string) => void, text = prompt) =>
    generate(text, onToken, {
      system: askSystem(language),
      nPredict: ASK_OUTPUT_TOKENS,
      temperature,
      topP: 0.8,
      topK: 20,
      minP: 0,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  const first = parseAnswer((await run(0.2, options.onToken ?? (() => undefined))).text, sources)
  // The small model sometimes repeats the question instead of answering; one warmer retry fixes it.
  const bare = (text: string): string => plain(text.replace(/\[\d+\]/gu, '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (bare(first.text) === bare(question)) return parseAnswer((await run(0.6, () => undefined)).text, sources)
  // "Nie, czekaj [1]." copies the speaker's filler; a bare "Nie." gives no reason.
  if (YES_NO_QUESTION.test(question.trim()) && sources.length && bare(first.text.replace(/^(nie|no)[,\s]+(?:czekaj|wait)\b/iu, '$1')).split(' ').filter(Boolean).length <= 3) {
    const hint = language === 'pl'
      ? '\n\nOdpowiedz „Tak” albo „Nie”, a potem w tym samym zdaniu podaj, co dokładnie mówi notatka i dlaczego.'
      : '\n\nAnswer "Yes" or "No", then in the same sentence say what exactly the note says and why.'
    const fuller = parseAnswer((await run(0.2, () => undefined, prompt.replace(/\n\n(?:ODPOWIEDŹ|ANSWER):$/u, `${hint}$&`))).text, sources)
    if (bare(fuller.text).split(' ').length > 3 && !NOT_FOUND.test(fuller.text)) return fuller
  }
  // A recognizer that dropped a word ("Prague") makes the model refuse a note
  // that does answer; one second look at the best note, told so, recovers it.
  if (sources.length && NOT_FOUND.test(first.text) && first.text.length < 120) {
    const hint = language === 'pl'
      ? `\n\nUWAGA: Notatka [1] prawdopodobnie dotyczy tej sprawy, choć zapis mowy mógł przekręcić lub pominąć niektóre słowa. Jeśli tak, odpowiedz na jej podstawie i dopisz, czego w niej brakuje. Jeśli naprawdę nie dotyczy, napisz: „Nie znalazłem tego w notatkach.”`
      : `\n\nNOTE: Note [1] is probably about this matter, though the transcript may have garbled or dropped some words. If so, answer from it and say what is missing. If it really is not about it, write: "I couldn't find that in your notes."`
    const second = parseAnswer((await run(0.2, () => undefined, prompt.replace(/\n\n(?:ODPOWIEDŹ|ANSWER):$/u, `${hint}$&`))).text, sources)
    if (!NOT_FOUND.test(second.text)) return { ...second, retried: true }
  }
  return first
}
