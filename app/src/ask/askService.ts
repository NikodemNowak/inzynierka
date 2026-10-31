import { enqueueLlm } from '../ai/llmQueue'
import { ensureModelReady } from '../ai/modelReady'
import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import type { Language } from '../i18n/language'
import { answerQuestion, type AskAnswer } from './askAnswer'
import { expandQuestion } from './askExpand'
import { buildAskIndex, type AskIndex } from './askIndex'
import { isConfidentMatch, retrieve } from './askRetrieval'
import { answerTaskQuestion, taskScope } from './askTasks'
import { questionLanguage } from './askText'
import { isEmbeddingModelDownloaded } from './embeddingModel'
import { semanticSimilarity } from './vectorStore'

export type AskStage = 'loading' | 'searching' | 'answering'

export interface AskTurn {
  question: string
  answer: string
}

// The index is rebuilt only when the notes or tasks arrays change, and even then
// the per-note work is cached (see askIndex).
let cached: { notes: readonly Note[]; tasks: readonly Task[]; index: AskIndex } | null = null
export const indexFor = (notes: readonly Note[], tasks: readonly Task[]): AskIndex => {
  if (cached && cached.notes === notes && cached.tasks === tasks) return cached.index
  const index = buildAskIndex(
    notes.map((note) => ({ id: note.id, title: note.title, content: note.content, summary: note.summary, createdAt: note.createdAt, ...(note.language ? { language: note.language } : {}), ...(note.summaryDocument?.corrections ? { corrections: note.summaryDocument.corrections } : {}) })),
    tasks.map((task) => ({ noteId: task.noteId, text: task.text, done: task.done })),
  )
  cached = { notes, tasks, index }
  return index
}

const notFound = (language: Language): string => (language === 'pl' ? 'Nie znalazłem tego w notatkach.' : "I couldn't find that in your notes.")

export const askNotes = async (
  question: string,
  input: { notes: readonly Note[]; tasks: readonly Task[]; history: readonly AskTurn[]; appLanguage: Language },
  callbacks: { onStage: (stage: AskStage) => void; onToken: (token: string) => void; signal: AbortSignal },
  now: Date = new Date(),
): Promise<AskAnswer> => {
  const language = questionLanguage(question, input.appLanguage)
  const previous = input.history.at(-1)?.question
  // Questions about what is due are answered from the tasks themselves: no model, no waiting.
  const scope = taskScope(question, now, previous)
  if (scope) return answerTaskQuestion(scope, input, language, now)
  return enqueueLlm(async () => {
    await ensureModelReady(() => callbacks.onStage('loading'), undefined, { signal: callbacks.signal })
    callbacks.onStage('searching')
    const index = indexFor(input.notes, input.tasks)
    const history = previous ? [previous] : []
    // Vectors are optional: without the search model, word matching alone still works.
    const semantic = (await isEmbeddingModelDownloaded())
      ? await semanticSimilarity(previous && question.split(/\s+/u).length <= 4 ? `${previous} ${question}` : question, index).catch(() => undefined)
      : undefined
    const options = { now, history, ...(semantic?.size ? { semantic } : {}) }
    let retrieved = retrieve(question, index, options)
    // Synonym expansion costs a model call: skipped when the words of the question already sit in the best note.
    if (!isConfidentMatch(question, retrieved)) {
      // Expansion only widens the search; a failed call still leaves word matching.
      const expansion = await expandQuestion(question, previous, callbacks.signal).catch((error: unknown) => {
        if (callbacks.signal.aborted) throw error
        return []
      })
      if (expansion.length) retrieved = retrieve(question, index, { ...options, expansion })
    }
    if (!retrieved.length) return { text: notFound(language), sources: [], cited: [] }
    callbacks.onStage('answering')
    return answerQuestion(question, retrieved, index, language, { now, history: input.history, onToken: callbacks.onToken, signal: callbacks.signal })
  })
}
