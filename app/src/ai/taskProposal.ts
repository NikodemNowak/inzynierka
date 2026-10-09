import type { Language } from '../i18n/language'
import type { ProcessingExecutionContext } from './processingContext'
import { extractTasks } from './taskExtraction'

export interface TaskProposal {
  tasks: string[]
  warnings: string[]
}

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
  return { tasks, warnings: [...warnings] }
}
