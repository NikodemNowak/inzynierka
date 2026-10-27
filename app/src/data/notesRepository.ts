import { withDatabaseWrite } from '../db/writeQueue'
import { getDatabase } from '../db/database'
import type { Note, NoteInput } from '../domain/note'
import { parseSummaryDocument, reconcileSummaryDocument } from '../domain/summary'
import { parseAudioTimeline } from '../domain/audioTimeline'
import * as FileSystem from 'expo-file-system/legacy'
import { resolveRecordingUri, toStoredRecordingPath } from '../audio/audioPath'
import { noteLanguageOrDefault } from '../i18n/language'
import { translate } from '../i18n/translate'

// Tags are stored as a JSON array string in the `tags` TEXT column.
type NoteRow = Omit<Note, 'tags' | 'language' | 'transcriptionIncomplete' | 'summaryDocument' | 'audioTimeline'> & {
  summaryDocument: string | null
  audioTimeline?: string | null
  tags: string | null
  language?: string | null
  transcriptionIncomplete?: number
}

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const parseTags = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((t): t is string => typeof t === 'string')
      : []
  } catch {
    return []
  }
}

// Heavy JSON columns are parsed on first access, so listing hundreds of notes
// at startup does not pay for timelines (up to 3000 levels) nobody reads.
const defineLazy = <T extends object, V>(
  target: T,
  key: keyof Note,
  compute: () => V,
): void => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get() {
      const value = compute()
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      })
      return value
    },
    set(value: V) {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      })
    },
  })
}

const toNote = (row: NoteRow): Note => {
  const { summaryDocument, audioTimeline, ...fields } = row
  const note = {
    ...fields,
    language: noteLanguageOrDefault(row.language),
    transcriptionIncomplete: row.transcriptionIncomplete === 1,
    tags: parseTags(row.tags),
    audioUri:
      row.audioUri && FileSystem.documentDirectory
        ? resolveRecordingUri(row.audioUri, FileSystem.documentDirectory)
        : row.audioUri,
  } as Note
  defineLazy(note, 'summaryDocument', () =>
    parseSummaryDocument(summaryDocument, row.content, row.summary),
  )
  defineLazy(note, 'audioTimeline', () =>
    row.audioUri && audioTimeline
      ? parseAudioTimeline(audioTimeline, row.content)
      : null,
  )
  return note
}

const storedAudioPath = (uri: string | null): string | null =>
  uri && FileSystem.documentDirectory
    ? toStoredRecordingPath(uri, FileSystem.documentDirectory)
    : uri

export const listNotes = async (): Promise<Note[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<NoteRow>(
    'SELECT * FROM notes ORDER BY updatedAt DESC',
  )
  return rows.map(toNote)
}

export const getNote = async (id: string): Promise<Note | null> => {
  const db = await getDatabase()
  const row = await db.getFirstAsync<NoteRow>(
    'SELECT * FROM notes WHERE id = ?',
    [id],
  )
  return row ? toNote(row) : null
}

export const createNote = async (
  input: NoteInput,
  recoveredSessionId?: string,
): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  const summaryDocument = reconcileSummaryDocument(
    input.content,
    input.summary,
    input.summaryDocument,
  )
  const audioTimeline = input.audioUri && input.audioTimeline
    ? parseAudioTimeline(input.audioTimeline, input.content)
    : null
  const note: Note = {
    id: recoveredSessionId ?? generateId(),
    title: input.title,
    content: input.content,
    summary: input.summary ?? null,
    summaryDocument,
    tags: input.tags,
    audioUri:
      input.audioUri && FileSystem.documentDirectory
        ? resolveRecordingUri(input.audioUri, FileSystem.documentDirectory)
        : input.audioUri,
    durationMs: input.durationMs,
    audioTimeline,
    language: noteLanguageOrDefault(input.language),
    transcriptionIncomplete: input.transcriptionIncomplete ?? false,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = await withDatabaseWrite(() =>
    db.runAsync(
      `${recoveredSessionId ? 'INSERT OR IGNORE' : 'INSERT'} INTO notes (id, title, content, summary, summaryDocument, tags, audioUri, durationMs, audioTimeline, createdAt, updatedAt, language, transcriptionIncomplete) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.title,
        note.content,
        note.summary,
        summaryDocument === null ? null : JSON.stringify(summaryDocument),
        JSON.stringify(note.tags),
        storedAudioPath(note.audioUri),
        note.durationMs,
        audioTimeline === null ? null : JSON.stringify(audioTimeline),
        note.createdAt,
        note.updatedAt,
        note.language ?? 'pl',
        note.transcriptionIncomplete ? 1 : 0,
      ],
    ),
  )
  if (recoveredSessionId && inserted.changes === 0) {
    const existing = await getNote(recoveredSessionId)
    if (!existing)
      throw new Error(
        translate(
          'Nie udało się odzyskać nagrania.',
          'The recording could not be recovered.',
        ),
      )
    return existing
  }
  return note
}

export const updateNote = async (
  id: string,
  input: NoteInput,
): Promise<Note> => {
  const db = await getDatabase()
  const now = Date.now()
  await withDatabaseWrite(async () => {
    const previous = await db.getFirstAsync<NoteRow>(
      'SELECT * FROM notes WHERE id = ?',
      [id],
    )
    const summaryDocument = reconcileSummaryDocument(
      input.content,
      input.summary,
      input.summaryDocument,
      previous ? toNote(previous).summaryDocument : null,
    )
    await db.runAsync(
      'UPDATE notes SET title = ?, content = ?, summary = ?, summaryDocument = ?, tags = ?, audioTimeline = CASE WHEN audioUri IS ? THEN audioTimeline ELSE NULL END, audioUri = ?, durationMs = ?, updatedAt = ?, language = ?, transcriptionIncomplete = COALESCE(?, transcriptionIncomplete) WHERE id = ?',
      [
        input.title,
        input.content,
        input.summary,
        summaryDocument === null ? null : JSON.stringify(summaryDocument),
        JSON.stringify(input.tags),
        // Levels describe one audio file; a replaced file loses them.
        storedAudioPath(input.audioUri),
        storedAudioPath(input.audioUri),
        input.durationMs,
        now,
        noteLanguageOrDefault(input.language),
        input.transcriptionIncomplete === undefined
          ? null
          : input.transcriptionIncomplete
            ? 1
            : 0,
        id,
      ],
    )
  })
  const updated = await getNote(id)
  if (!updated)
    throw new Error(
      translate('Notatka nie istnieje', 'The note does not exist'),
    )
  return updated
}

export const deleteNote = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync('DELETE FROM notes WHERE id = ?', [id]),
  )
}
