import { generate } from '../ai/llm'
import { terms } from './askText'

// Notes may be in Polish or English and speech uses everyday words ("dentysta"
// where the question says "stomatolog"). One short model call turns the question
// into search words in both languages, so word matching finds such notes.

const SYSTEM = 'You translate a question about personal notes into search keywords in Polish and in English.'

const EXAMPLES = [
  'Question: Ile zapłaciłem za nowe buty do biegania?',
  'PL: zapłacić, cena, kosztować, buty, biegać',
  'EN: pay, price, cost, shoes, running',
  '',
  'Question: When do I pick up the car from the mechanic?',
  'PL: odebrać, samochód, auto, mechanik, warsztat',
  'EN: pick up, car, mechanic, garage',
  '',
  'Question: Czy mam zarezerwować stolik?',
  'PL: zarezerwować, rezerwacja, stolik, restauracja',
  'EN: book, reservation, table, restaurant',
].join('\n')

export const expansionPrompt = (question: string, previous?: string): string =>
  [
    'List the important words of the question in base form, with close synonyms, in Polish (PL) and in English (EN).',
    'Skip question words (when, what, kiedy, co) and words about time. Two lines only, like in the examples.',
    '',
    EXAMPLES,
    '',
    ...(previous ? [`Earlier question: ${previous}`] : []),
    `Question: ${question}`,
  ].join('\n')

const LABEL = /^\s*(?:PL|EN)\s*:/iu

export const parseExpansion = (raw: string): string[] => {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<\/?think>/gu, '')
  const lines = text.split(/\r?\n/u).filter((line) => LABEL.test(line)).slice(0, 2)
  const words = lines.flatMap((line) => line.replace(LABEL, '').split(/[,;]/u))
  return [...new Set(words.map((word) => word.trim().replace(/^["'„]|["'”.]$/gu, '')).filter((word) => word.length > 1 && word.length < 40))].slice(0, 16)
}

export const expandQuestion = async (question: string, previous?: string, signal?: AbortSignal): Promise<string[]> => {
  // "A gdzie?" has nothing to translate on its own: expand it together with the question before.
  const asked = previous && terms(question).length <= 3 ? `${previous} ${question}` : question
  const result = await generate(expansionPrompt(asked, asked === question ? previous : undefined), () => undefined, {
    system: SYSTEM,
    nPredict: 72,
    temperature: 0,
    topP: 0.8,
    topK: 20,
    minP: 0,
    ...(signal ? { signal } : {}),
  })
  return parseExpansion(result.text)
}
