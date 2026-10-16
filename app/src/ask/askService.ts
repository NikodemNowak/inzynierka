import { enqueueLlm } from '../ai/llmQueue'
import { ensureModelReady } from '../ai/modelReady'
import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import type { Language } from '../i18n/language'
import { answerQuestion, type AskAnswer } from './askAnswer'
import { expandQuestion } from './askExpand'
import { buildAskIndex, type AskIndex } from './askIndex'
import { retrieve } from './askRetrieval'
import { questionLanguage } from './askText'

export type AskStage = 'loading' | 'searching' | 'answering'

export interface AskTurn {
  question: string
  answer: string
}

// The index is rebuilt only when the notes or tasks arrays change.
let cached: { notes: readonly Note[]; tasks: readonly Task[]; index: AskIndex } | null = null
const indexFor = (notes: readonly Note[], tasks: readonly Task[]): AskIndex => {
  if (cached && cached.notes === notes && cached.tasks === tasks) return cached.index
  const index = buildAskIndex(
    notes.map((note) => ({ id: note.id, title: note.title, content: note.content, summary: note.summary, createdAt: note.createdAt, ...(note.language ? { language: note.language } : {}) })),
    tasks.map((task) => ({ noteId: task.noteId, text: task.text, done: task.done })),
  )
  cached = { notes, tasks, index }
  return index
}

const notFound = (language: Language): string => (language === 'pl' ? 'Nie znalazłem tego w notatkach.' : "I couldn't find that in your notes.")

export const askNotes = (
  question: string,
  input: { notes: readonly Note[]; tasks: readonly Task[]; history: readonly AskTurn[]; appLanguage: Language },
  callbacks: { onStage: (stage: AskStage) => void; onToken: (token: string) => void; signal: AbortSignal },
): Promise<AskAnswer> =>
  enqueueLlm(async () => {
    const language = questionLanguage(question, input.appLanguage)
    const now = new Date()
    await ensureModelReady(() => callbacks.onStage('loading'), undefined, { signal: callbacks.signal })
    callbacks.onStage('searching')
    const previous = input.history.at(-1)?.question
    const index = indexFor(input.notes, input.tasks)
    // Expansion only widens the search; a failed call still leaves word matching.
    const expansion = await expandQuestion(question, previous, callbacks.signal).catch((error: unknown) => {
      if (callbacks.signal.aborted) throw error
      return []
    })
    const retrieved = retrieve(question, index, { now, history: previous ? [previous] : [], expansion })
    if (!retrieved.length) return { text: notFound(language), sources: [], cited: [] }
    callbacks.onStage('answering')
    return answerQuestion(question, retrieved, index, language, { now, history: input.history, onToken: callbacks.onToken, signal: callbacks.signal })
  })
