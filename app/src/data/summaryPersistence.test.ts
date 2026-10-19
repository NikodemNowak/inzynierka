import type * as SQLite from 'expo-sqlite'
import type { NoteInput } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'

type SqlValue = string | number | null
interface SyncDatabase {
  exec(sql: string): void
  close(): void
  prepare(sql: string): {
    run(...values: SqlValue[]): {
      changes: number | bigint
      lastInsertRowid: number | bigint
    }
    get(...values: SqlValue[]): unknown
    all(...values: SqlValue[]): unknown[]
  }
}
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SyncDatabase
}
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}
const { tmpdir } = require('node:os') as { tmpdir(): string }
const { join } = require('node:path') as { join(...paths: string[]): string }

const source = 'Alice sends the report.\r\nBob is unavailable. 😀'
const summary = '• Alice sends the report.\n• Bob is unavailable.'
const document: SummaryDocument = {
  version: 1,
  source,
  format: 'bullets',
  points: [
    { text: 'Alice sends the report.', sources: [{ start: 0, end: 23 }] },
    { text: 'Bob is unavailable.', sources: [{ start: 25, end: 44 }] },
  ],
}
const input: NoteInput = {
  title: 'Synthetic meeting',
  content: source,
  summary,
  summaryDocument: document,
  tags: ['meeting'],
  audioUri: 'file:///documents/recordings/synthetic.wav',
  durationMs: 21000,
  language: 'en',
  transcriptionIncomplete: true,
}

const adapterFor = (connection: SyncDatabase) => ({
  execAsync: async (sql: string) => connection.exec(sql),
  runAsync: async (sql: string, ...args: (SqlValue | SqlValue[])[]) => {
    const result = connection.prepare(sql).run(...args.flat())
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    }
  },
  getAllAsync: async (sql: string, ...args: (SqlValue | SqlValue[])[]) =>
    connection.prepare(sql).all(...args.flat()),
  getFirstAsync: async (sql: string, ...args: (SqlValue | SqlValue[])[]) =>
    connection.prepare(sql).get(...args.flat()) ?? null,
})

const loadModules = (connection: SyncDatabase) => {
  jest.resetModules()
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: jest.fn(async () =>
      adapterFor(connection) as unknown as SQLite.SQLiteDatabase),
  }))
  jest.doMock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///documents/',
  }))
  return {
    database: require('../db/database') as typeof import('../db/database'),
    repository: require('./notesRepository') as typeof import('./notesRepository'),
    queue: require('../db/writeQueue') as typeof import('../db/writeQueue'),
  }
}

let connection: SyncDatabase
let modules: ReturnType<typeof loadModules>
beforeEach(() => {
  connection = new DatabaseSync(':memory:')
  modules = loadModules(connection)
})
afterEach(() => connection.close())

const storedSummary = (id: string) => connection.prepare(
  'SELECT summary, summaryDocument FROM notes WHERE id = ?',
).get(id)

test('migrates an old database without changing notes, audio paths or tasks', async () => {
  connection.exec(`CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
    summary TEXT, tags TEXT, audioUri TEXT, durationMs INTEGER,
    language TEXT NOT NULL DEFAULT 'pl', transcriptionIncomplete INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, noteId TEXT, text TEXT, done INTEGER, createdAt INTEGER);
    INSERT INTO notes VALUES ('old','Old','Original','Old summary','["old"]','recordings/a.wav',21000,'pl',0,1,2);
    INSERT INTO tasks VALUES ('task-old','old','Existing task',0,1);`)
  const notesBefore = connection.prepare('SELECT * FROM notes').all()
  const tasksBefore = connection.prepare('SELECT * FROM tasks').all()
  await modules.database.getDatabase()
  const after = connection.prepare('SELECT * FROM notes').all() as Record<string, unknown>[]
  expect(after.map(({ summaryDocument, audioTimeline, ...row }) => row)).toEqual(notesBefore)
  expect(after[0].summaryDocument).toBeNull()
  expect(after[0].audioTimeline).toBeNull()
  expect(connection.prepare('SELECT * FROM tasks').all()).toEqual(tasksBefore)
  expect(connection.prepare('PRAGMA table_info(notes)').all()).toContainEqual(
    expect.objectContaining({ name: 'summaryDocument', type: 'TEXT', notnull: 0, dflt_value: null }),
  )
  expect(await modules.repository.getNote('old')).toEqual({
    id: 'old', title: 'Old', content: 'Original', summary: 'Old summary',
    summaryDocument: null, tags: ['old'], audioUri: 'file:///documents/recordings/a.wav',
    durationMs: 21000, audioTimeline: null, language: 'pl', transcriptionIncomplete: false, createdAt: 1, updatedAt: 2,
  })
  expect(await modules.repository.listNotes()).toEqual([await modules.repository.getNote('old')])
  // Reinitializing after module reload must also tolerate an already migrated DB.
  modules = loadModules(connection)
  await modules.database.getDatabase()
  expect(connection.prepare('SELECT * FROM notes').all()).toEqual(after)
})

test('creates and reloads a typed document with its canonical summary and relative audio path', async () => {
  const created = await modules.repository.createNote(input)
  expect(created.summaryDocument).toEqual(document)
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: JSON.stringify(document) })
  expect(connection.prepare('SELECT audioUri FROM notes WHERE id = ?').get(created.id))
    .toEqual({ audioUri: 'recordings/synthetic.wav' })
  expect(await modules.repository.getNote(created.id)).toEqual(created)
  expect(await modules.repository.listNotes()).toEqual([created])
})

test.each([undefined, null])('creates a plain legacy summary with metadata %s as SQL null', async (summaryDocument) => {
  const created = await modules.repository.createNote({ ...input, summaryDocument })
  expect(created.summaryDocument).toBeNull()
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: null })
  expect((await modules.repository.getNote(created.id))?.summary).toBe(summary)
})

test('rejects an invalid incoming document without changing the supplied plain summary', async () => {
  const created = await modules.repository.createNote({
    ...input, summaryDocument: { ...document, source: source.replace('\r\n', '\n') },
  })
  expect(created.summaryDocument).toBeNull()
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: null })
})

test('retains valid metadata on a title/tag edit and preserves the incomplete flag when omitted', async () => {
  const created = await modules.repository.createNote(input)
  const updated = await modules.repository.updateNote(created.id, {
    ...input, title: 'Renamed', tags: ['edited'], summaryDocument: undefined,
    transcriptionIncomplete: undefined,
  })
  expect(updated).toEqual({ ...created, title: 'Renamed', tags: ['edited'], updatedAt: updated.updatedAt })
  expect(updated.summaryDocument).toEqual(document)
  expect(updated.transcriptionIncomplete).toBe(true)
  expect(updated.language).toBe('en')
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: JSON.stringify(document) })
})

test.each([
  ['source edit', { content: source.replace('\r\n', '\n') }],
  ['manual summary edit', { summary: 'Manually written summary' }],
  ['retranscription', { content: 'New synthetic transcript.', summary: null, transcriptionIncomplete: false }],
  ['explicit null', { summaryDocument: null }],
  ['invalid replacement', { summaryDocument: { ...document, points: [] } }],
] satisfies [string, Partial<NoteInput>][])('clears metadata after %s', async (_name, patch) => {
  const created = await modules.repository.createNote(input)
  const next = { ...input, summaryDocument: undefined, ...patch }
  const updated = await modules.repository.updateNote(created.id, next)
  expect(updated.summaryDocument).toBeNull()
  expect(updated.content).toBe(next.content)
  expect(updated.summary).toBe(next.summary)
  expect(storedSummary(created.id)).toEqual({ summary: next.summary, summaryDocument: null })
  expect(updated.audioUri).toBe(created.audioUri)
  expect(updated.durationMs).toBe(created.durationMs)
  expect(updated.transcriptionIncomplete).toBe(next.transcriptionIncomplete)
})

test('replaces metadata with a valid document and corresponding new summary in the same write', async () => {
  const created = await modules.repository.createNote(input)
  const replacement: SummaryDocument = { ...document, format: 'paragraph' }
  const nextSummary = 'Alice sends the report. Bob is unavailable.'
  const updated = await modules.repository.updateNote(created.id, {
    ...input, summary: nextSummary, summaryDocument: replacement,
  })
  expect(updated.summaryDocument).toEqual(replacement)
  expect(storedSummary(created.id)).toEqual({ summary: nextSummary, summaryDocument: JSON.stringify(replacement) })
})

test('SQL constraints reject separate text/document INSERT or UPDATE writes', async () => {
  await modules.database.getDatabase()
  connection.exec(`CREATE TRIGGER require_insert_document BEFORE INSERT ON notes
    WHEN NEW.summary = '• Alice sends the report.\n• Bob is unavailable.' AND NEW.summaryDocument IS NULL
    BEGIN SELECT RAISE(ABORT, 'document must be inserted with summary'); END;
    CREATE TRIGGER require_update_document BEFORE UPDATE ON notes
    WHEN NEW.summary = 'Alice sends the report. Bob is unavailable.' AND
      (NEW.summaryDocument IS NULL OR json_extract(NEW.summaryDocument, '$.format') <> 'paragraph')
    BEGIN SELECT RAISE(ABORT, 'document must be updated with summary'); END;`)
  const created = await modules.repository.createNote(input)
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: JSON.stringify(document) })
  const replacement: SummaryDocument = { ...document, format: 'paragraph' }
  const nextSummary = 'Alice sends the report. Bob is unavailable.'
  await modules.repository.updateNote(created.id, {
    ...input, summary: nextSummary, summaryDocument: replacement,
  })
  expect(storedSummary(created.id)).toEqual({ summary: nextSummary, summaryDocument: JSON.stringify(replacement) })
})

test.each([
  ['legacy null', null],
  ['invalid JSON', '{broken'],
  ['version mismatch', JSON.stringify({ ...document, version: 2 })],
  ['source mismatch', JSON.stringify({ ...document, source: `${source} ` })],
  ['render mismatch', JSON.stringify({ ...document, format: 'paragraph' })],
  ['invalid range', JSON.stringify({ ...document, points: [{ text: 'Alice', sources: [{ start: 0, end: 999 }] }] })],
])('reads %s metadata as null while preserving all other fields', async (_name, serialized) => {
  const created = await modules.repository.createNote(input)
  connection.prepare('UPDATE notes SET summaryDocument = ? WHERE id = ?').run(serialized, created.id)
  const expected = { ...created, summaryDocument: null }
  expect(await modules.repository.getNote(created.id)).toEqual(expected)
  expect(await modules.repository.listNotes()).toEqual([expected])
  await modules.repository.updateNote(created.id, { ...input, summaryDocument: undefined })
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: null })
})

test('an actual aborted UPDATE preserves both the old summary and serialized document', async () => {
  const created = await modules.repository.createNote(input)
  const before = storedSummary(created.id)
  connection.exec(`CREATE TRIGGER reject_summary_update BEFORE UPDATE ON notes
    BEGIN SELECT RAISE(ABORT, 'synthetic update failure'); END;`)
  await expect(modules.repository.updateNote(created.id, {
    ...input, summary: 'Replacement plain summary', summaryDocument: null,
  })).rejects.toThrow('synthetic update failure')
  expect(storedSummary(created.id)).toEqual(before)
  expect(await modules.repository.getNote(created.id)).toEqual(created)
  connection.exec('DROP TRIGGER reject_summary_update')
  const updated = await modules.repository.updateNote(created.id, {
    ...input, title: 'After failure', summaryDocument: undefined,
  })
  expect(updated.title).toBe('After failure')
  expect(updated.summaryDocument).toEqual(document)
})

test('reads the previous document after earlier queued writes, avoiding a stale replacement', async () => {
  const created = await modules.repository.createNote(input)
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const earlier = modules.queue.withDatabaseWrite(async () => {
    await gate
    connection.prepare('UPDATE notes SET summaryDocument = NULL WHERE id = ?').run(created.id)
  })
  const update = modules.repository.updateNote(created.id, { ...input, summaryDocument: undefined })
  await Promise.resolve()
  await Promise.resolve()
  release()
  await earlier
  expect((await update).summaryDocument).toBeNull()
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: null })
})

test('duplicate capture recovery retains the already saved document and user edits', async () => {
  const created = await modules.repository.createNote(input, 'synthetic-capture')
  const duplicate = await modules.repository.createNote({
    ...input, title: 'Recovered title', content: 'Different source', summary: null, summaryDocument: null,
  }, 'synthetic-capture')
  expect(duplicate).toEqual(created)
  expect(connection.prepare('SELECT * FROM notes').all()).toHaveLength(1)
  expect(storedSummary(created.id)).toEqual({ summary, summaryDocument: JSON.stringify(document) })
})

test('reopens a unique file-backed synthetic DB and retains exact source citations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'notatki-summary-synthetic-'))
  const path = join(directory, 'synthetic.db')
  let fileConnection = new DatabaseSync(path)
  try {
    const first = loadModules(fileConnection)
    const created = await first.repository.createNote(input)
    fileConnection.close()
    fileConnection = new DatabaseSync(path)
    const reopened = loadModules(fileConnection)
    const loaded = await reopened.repository.getNote(created.id)
    expect(loaded).toEqual(created)
    expect(loaded?.summaryDocument).toEqual(document)
    expect(loaded?.summaryDocument?.source).toBe('Alice sends the report.\r\nBob is unavailable. 😀')
    expect(loaded?.summaryDocument?.points.map(point =>
      point.sources.map(range => loaded.content.slice(range.start, range.end))))
      .toEqual([['Alice sends the report.'], ['Bob is unavailable.']])
  } finally {
    fileConnection.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

const timeline = {
  version: 1 as const, levelMs: 100, levels: [3, 60, 100, 20], source, timing: 'words' as const,
  spans: [{ start: 0, end: 23, startMs: 0, endMs: 900 }, { start: 25, end: 44, startMs: 1100, endMs: 2000 }],
}

test('stores the recording timeline once and keeps it across edits of the same audio', async () => {
  const created = await modules.repository.createNote({ ...input, audioTimeline: timeline })
  expect(created.audioTimeline).toEqual(timeline)
  expect(await modules.repository.getNote(created.id)).toEqual(created)
  const renamed = await modules.repository.updateNote(created.id, { ...input, title: 'Renamed' })
  expect(renamed.audioTimeline).toEqual(timeline)
  const edited = await modules.repository.updateNote(created.id, { ...input, content: 'Rewritten by hand.', summaryDocument: null })
  expect(edited.audioTimeline?.levels).toEqual(timeline.levels)
  expect(edited.audioTimeline?.spans).toEqual([])
})

test('drops the timeline when the audio file is replaced or missing', async () => {
  const created = await modules.repository.createNote({ ...input, audioTimeline: timeline })
  const replaced = await modules.repository.updateNote(created.id, {
    ...input, audioUri: 'file:///documents/recordings/other.wav',
  })
  expect(replaced.audioTimeline).toBeNull()
  const silent = await modules.repository.createNote({ ...input, audioUri: null, audioTimeline: timeline })
  expect(silent.audioTimeline).toBeNull()
})
