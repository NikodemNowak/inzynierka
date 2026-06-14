import { getDatabase } from '../db/database'
import type { Task } from '../domain/task'

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

export const createTasks = async (noteId: string, texts: string[]): Promise<Task[]> => {
  const db = await getDatabase()
  const now = Date.now()
  const created: Task[] = []
  for (const text of texts) {
    const task: Task = { id: generateId(), noteId, text, done: false, createdAt: now }
    await db.runAsync(
      'INSERT INTO tasks (id, noteId, text, done, createdAt) VALUES (?, ?, ?, ?, ?)',
      [task.id, task.noteId, task.text, 0, task.createdAt],
    )
    created.push(task)
  }
  return created
}

export const setTaskDone = async (id: string, done: boolean): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('UPDATE tasks SET done = ? WHERE id = ?', [done ? 1 : 0, id])
}

export const deleteTask = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [id])
}

export const deleteTasksForNote = async (noteId: string): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM tasks WHERE noteId = ?', [noteId])
}
