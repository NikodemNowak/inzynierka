import { getDatabase } from '../db/database'
import type { Note, NoteInput } from '../domain/note'

// Tags are stored as a JSON array string in the `tags` TEXT column.
type NoteRow = Omit<Note, 'tags'> & { tags: string | null }

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const parseTags = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

const toNote = (row: NoteRow): Note => ({ ...row, tags: parseTags(row.tags) })

export const listNotes = async (): Promise<Note[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<NoteRow>('SELECT * FROM notes ORDER BY updatedAt DESC')
  return rows.map(toNote)
}

export const getNote = async (id: string): Promise<Note | null> => {
  const db = await getDatabase()
  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  return row ? toNote(row) : null
}

export const createNote = async (input: NoteInput): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  const note: Note = {
    id: generateId(),
    title: input.title,
    content: input.content,
    summary: input.summary ?? null,
    tags: input.tags,
    audioUri: input.audioUri,
    durationMs: input.durationMs,
    createdAt: now,
    updatedAt: now,
  }
  await db.runAsync(
    'INSERT INTO notes (id, title, content, summary, tags, audioUri, durationMs, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      note.id,
      note.title,
      note.content,
      note.summary,
      JSON.stringify(note.tags),
      note.audioUri,
      note.durationMs,
      note.createdAt,
      note.updatedAt,
    ],
  )
  return note
}

export const updateNote = async (id: string, input: NoteInput): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  await db.runAsync(
    'UPDATE notes SET title = ?, content = ?, summary = ?, tags = ?, audioUri = ?, durationMs = ?, updatedAt = ? WHERE id = ?',
    [
      input.title,
      input.content,
      input.summary,
      JSON.stringify(input.tags),
      input.audioUri,
      input.durationMs,
      now,
      id,
    ],
  )
  const updated = await getNote(id)
  if (!updated) throw new Error('Notatka nie istnieje')
  return updated
}

export const deleteNote = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM notes WHERE id = ?', [id])
}
