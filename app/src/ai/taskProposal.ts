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

// Keep uncertainty beside the proposals so restoring a durable result cannot
// turn an unresolved cancellation into an apparently verified task list.
export const createTaskProposal = async (
  source: string,
  onStatus: (status: string) => void,
  language: Language,
  execution?: ProcessingExecutionContext,
): Promise<TaskProposal> => {
  const warnings = new Set<string>()
  const tasks = await extractTasks(source, onStatus, language, {
    ...execution,
    onWarning: (message) => {
      warnings.add(message)
      execution?.onWarning?.(message)
    },
  })
  return { tasks: tasks.filter((task) => !isNoteMetaTask(task)), warnings: [...warnings] }
}
