import { withDatabaseWrite } from '../db/writeQueue'
import { getDatabase } from '../db/database'
import type { Task } from '../domain/task'
import { translate } from '../i18n/translate'

interface TaskRow {
  id: string
  noteId: string
  text: string
  done: number
  createdAt: number
}

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  noteId: row.noteId,
  text: row.text,
  done: row.done === 1,
  createdAt: row.createdAt,
})

export const listTasks = async (): Promise<Task[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<TaskRow>(
    'SELECT * FROM tasks ORDER BY done ASC, createdAt DESC',
  )
  return rows.map(toTask)
}

export const createTasks = async (
  noteId: string,
  texts: string[],
): Promise<Task[]> => {
  const db = await getDatabase()
  const now = Date.now()
  const created: Task[] = []
  await withDatabaseWrite(() =>
    db.withExclusiveTransactionAsync(async (tx) => {
      const note = await tx.getFirstAsync<{ id: string }>(
        'SELECT id FROM notes WHERE id = ?',
        [noteId],
      )
      if (!note)
        throw new Error(
          translate(
            'Ta notatka już nie istnieje.',
            'This note no longer exists.',
          ),
        )
      const existing = await tx.getAllAsync<{ text: string }>(
        'SELECT text FROM tasks WHERE noteId = ?',
        [noteId],
      )
      const keyFor = (text: string) =>
        text.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
      const seen = new Set(existing.map((task) => keyFor(task.text)))
      for (const value of texts) {
        const text = value.trim()
        const key = keyFor(text)
        if (!key || seen.has(key)) continue
        const task: Task = {
          id: generateId(),
          noteId,
          text,
          done: false,
          createdAt: now,
        }
        await tx.runAsync(
          'INSERT INTO tasks (id, noteId, text, done, createdAt) VALUES (?, ?, ?, ?, ?)',
          [task.id, task.noteId, task.text, 0, task.createdAt],
        )
        seen.add(key)
        created.push(task)
      }
    }),
  )
  return created
}

export const setTaskDone = async (id: string, done: boolean): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync('UPDATE tasks SET done = ? WHERE id = ?', [done ? 1 : 0, id]),
  )
}

export const deleteTask = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync('DELETE FROM tasks WHERE id = ?', [id]),
  )
}

export const deleteTasksForNote = async (noteId: string): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync('DELETE FROM tasks WHERE noteId = ?', [noteId]),
  )
}
