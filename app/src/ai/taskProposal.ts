import type { Language } from '../i18n/language'
import type { ProcessingExecutionContext } from './processingContext'
import { extractTasks } from './taskExtraction'

export interface TaskProposal {
  tasks: string[]
  warnings: string[]
}

// A statement about the recording itself ("Test nowej notatki ...") is never a
// task, even when the model marks it active.
const isNoteMetaTask = (task: string): boolean =>
  /^\s*(?:test|testuj|sprawdzam|sprawdzenie)[^.]*(?:notatk|nagrani|transkrypcj|aplikacj)/.test(task.toLowerCase())

const capitalize = (text: string): string => text.charAt(0).toLocaleUpperCase('pl') + text.slice(1)

// Source statements often start with a joining "i"; a task reads better without it.
const tidyTask = (task: string): string =>
  capitalize(task.trim().replace(/^(?:i|oraz|a)\s+/iu, '').replace(/[\s,;]+$/u, ''))

// "muszę omówić X i pokazać Y": the second infinitive shares the obligation but
// the model often leaves it out. Add it when the source continues that way.
const continuedAction = (task: string, source: string): string | null => {
  if (!/(?:muszę|musimy|trzeba|powinienem|powinnam|mam)\s/iu.test(task)) return null
  const at = source.toLowerCase().indexOf(task.trim().toLowerCase())
  if (at < 0) return null
  const rest = source.slice(at + task.trim().length)
  const match = /^[\s,]*(?:i|oraz)\s+(\p{L}+(?:ć|c))(\s[^.!?\r\n]*)?/iu.exec(rest)
  if (!match) return null
  const words = `${match[1]}${match[2] ?? ''}`.trim().split(/\s+/u)
  return capitalize((words.length > 6 ? words.slice(0, 4) : words).join(' '))
}

// Keep uncertainty beside the proposals so restoring a durable result cannot
// turn an unresolved cancellation into an apparently verified task list.
export const createTaskProposal = async (
  source: string,
  onStatus: (status: string) => void,
  language: Language,
  execution?: ProcessingExecutionContext,
  recoverUnresolved = false,
): Promise<TaskProposal> => {
  const warnings = new Set<string>()
  const tasks = await extractTasks(source, onStatus, language, {
    ...execution,
    ...(recoverUnresolved ? { recoverUnresolvedTasks: true } : {}),
    onWarning: (message) => {
      warnings.add(message)
      execution?.onWarning?.(message)
    },
  })
  const kept = tasks.filter((task) => !isNoteMetaTask(task))
  const result: string[] = []
  const seen = new Set<string>()
  const add = (task: string | null): void => {
    if (!task || seen.has(task.toLowerCase())) return
    seen.add(task.toLowerCase())
    result.push(task)
  }
  for (const task of kept) {
    add(tidyTask(task))
    add(continuedAction(task, source))
  }
  return { tasks: result, warnings: [...warnings] }
}
