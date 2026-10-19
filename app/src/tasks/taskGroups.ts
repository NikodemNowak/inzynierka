import { resolveDue, splitTaskText } from './taskDue'

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'undated'
export const TASK_GROUP_ORDER: readonly TaskGroup[] = ['overdue', 'today', 'week', 'later', 'undated']

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const DAY_MS = 24 * 60 * 60 * 1000

export interface DatedTask<T> { readonly task: T; readonly due: Date | null }

// A task's deadline is read relative to the note it came from, then sorted into
// buckets relative to today.
export const groupTasksByDue = <T extends { text: string; noteId: string }>(
  tasks: readonly T[],
  noteCreatedAt: ReadonlyMap<string, number | string | Date>,
  now: Date,
): Map<TaskGroup, DatedTask<T>[]> => {
  const today = startOfDay(now).getTime()
  const groups = new Map<TaskGroup, DatedTask<T>[]>(TASK_GROUP_ORDER.map((group) => [group, []]))
  for (const task of tasks) {
    const created = noteCreatedAt.get(task.noteId)
    const { due } = splitTaskText(task.text)
    const resolved = due && created !== undefined ? resolveDue(due, new Date(created)) : null
    const date = resolved?.date ?? null
    const day = date ? startOfDay(date).getTime() : null
    const group: TaskGroup = day === null ? 'undated'
      : day < today ? 'overdue'
        : day === today ? 'today'
          : day < today + 7 * DAY_MS ? 'week'
            : 'later'
    groups.get(group)!.push({ task, due: date })
  }
  for (const [group, list] of groups)
    if (group !== 'undated') list.sort((left, right) => (left.due?.getTime() ?? 0) - (right.due?.getTime() ?? 0))
  return groups
}
