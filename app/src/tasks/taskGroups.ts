import { resolveTaskDay } from './taskDue'

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'undated'
export const TASK_GROUP_ORDER: readonly TaskGroup[] = ['overdue', 'today', 'week', 'later', 'undated']

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export interface DatedTask<T> { readonly task: T; readonly due: Date | null; readonly allDay: boolean }

// A task's deadline is read relative to the note it came from, then sorted into
// buckets relative to today. "week" is the rest of the calendar week, up to
// Sunday: the same week the chat means by "w tym tygodniu".
export const groupTasksByDue = <T extends { text: string; noteId: string }>(
  tasks: readonly T[],
  noteCreatedAt: ReadonlyMap<string, number | string | Date>,
  now: Date,
): Map<TaskGroup, DatedTask<T>[]> => {
  const today = startOfDay(now)
  const todayMs = today.getTime()
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7)).getTime()
  const groups = new Map<TaskGroup, DatedTask<T>[]>(TASK_GROUP_ORDER.map((group) => [group, []]))
  for (const task of tasks) {
    const created = noteCreatedAt.get(task.noteId)
    const resolved = created !== undefined ? resolveTaskDay(task.text, created) : null
    const day = resolved?.day ?? null
    const group: TaskGroup = day === null ? 'undated'
      : day < todayMs ? 'overdue'
        : day === todayMs ? 'today'
          : day <= weekEnd ? 'week'
            : 'later'
    groups.get(group)!.push({ task, due: resolved?.date ?? null, allDay: resolved?.allDay ?? true })
  }
  for (const [group, list] of groups)
    if (group !== 'undated') list.sort((left, right) => (left.due?.getTime() ?? 0) - (right.due?.getTime() ?? 0))
  return groups
}
