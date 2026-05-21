import { getDatabase } from '../db/database'
import type { Note, NoteInput } from '../domain/note'

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const listNotes = async (): Promise<Note[]> => {
  const db = await getDatabase()
  return db.getAllAsync<Note>('SELECT * FROM notes ORDER BY updatedAt DESC')
}

export const getNote = async (id: string): Promise<Note | null> => {
  const db = await getDatabase()
  return db.getFirstAsync<Note>('SELECT * FROM notes WHERE id = ?', [id])
}

export const createNote = async (input: NoteInput): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  const note: Note = {
    id: generateId(),
    title: input.title,
    content: input.content,
    createdAt: now,
    updatedAt: now,
  }
  await db.runAsync(
    'INSERT INTO notes (id, title, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    [note.id, note.title, note.content, note.createdAt, note.updatedAt],
  )
  return note
}

export const updateNote = async (id: string, input: NoteInput): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  await db.runAsync('UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ?', [
    input.title,
    input.content,
    now,
    id,
  ])
  const updated = await getNote(id)
  if (!updated) throw new Error('Notatka nie istnieje')
  return updated
}

export const deleteNote = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM notes WHERE id = ?', [id])
}
