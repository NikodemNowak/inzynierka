import type * as SQLite from 'expo-sqlite'
import { getDatabase } from '../db/database'
import { createNote, getNote, updateNote } from './notesRepository'
import type { SummaryDocument } from '../domain/summary'

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }))
const db = {
  getFirstAsync: jest.fn(),
  runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
}
const row = {
  id: 'one',
  title: 'A call',
  content: 'Call Alice',
  summary: null,
  summaryDocument: null,
  tags: '[]',
  audioUri: null,
  durationMs: null,
  createdAt: 1,
  updatedAt: 2,
}
const input = {
  title: 'A call',
  content: 'Call Alice',
  summary: null,
  tags: [],
  audioUri: null,
  durationMs: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(getDatabase)
    .mockResolvedValue(db as unknown as SQLite.SQLiteDatabase)
})

test.each([undefined, null, 'de', 'en'])(
  'normalizes stored note language %s without changing the text',
  async (language) => {
    db.getFirstAsync.mockResolvedValue({ ...row, language })
    const note = await getNote('one')
    expect(note?.language).toBe(language === 'en' ? 'en' : 'pl')
    expect(note?.content).toBe('Call Alice')
  },
)

test('persists English note language on creation and update', async () => {
  const note = await createNote({ ...input, language: 'en' })
  expect(note.language).toBe('en')
  expect(db.runAsync).toHaveBeenCalledWith(
    expect.stringContaining('language'),
    expect.arrayContaining(['en']),
  )
  db.getFirstAsync.mockResolvedValue({ ...row, language: 'en' })
  await updateNote('one', { ...input, language: 'en' })
  expect(db.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining('language = ?'),
    expect.arrayContaining(['en']),
  )
})

test('reuses the first saved capture without overwriting user edits during crash recovery', async () => {
  db.runAsync.mockResolvedValueOnce({ changes: 0, lastInsertRowId: 0 })
  db.getFirstAsync.mockResolvedValueOnce({
    ...row,
    id: 'capture-session',
    title: 'User edited title',
    language: 'en',
  })
  const saved = await createNote(
    { ...input, title: 'Recovered title' },
    'capture-session',
  )
  expect(saved.title).toBe('User edited title')
  expect(saved.id).toBe('capture-session')
  expect(db.runAsync).toHaveBeenCalledWith(
    expect.stringContaining('INSERT OR IGNORE'),
    expect.arrayContaining(['capture-session']),
  )
})

test('loads a historical capture from the current Documents directory without changing the note source', async () => {
  db.getFirstAsync.mockResolvedValue({
    ...row,
    audioUri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/recordings/captures/capture-old-42//000000.wav',
  })
  const saved = await getNote('one')
  expect(saved?.audioUri).toBe('file:///documents/recordings/captures/capture-old-42/000000.wav')
  expect(saved?.content).toBe(row.content)
  expect(saved?.updatedAt).toBe(row.updatedAt)
  expect(db.runAsync).not.toHaveBeenCalled()
})

test('keeps createNote and getNote audio identity equal for a newly materialized capture with a redundant separator', async () => {
  const raw = 'file:///documents/recordings/captures/capture-new-42//000000.wav'
  const created = await createNote({ ...input, audioUri: raw, durationMs: 48587 })
  expect(db.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining('INSERT'),
    expect.arrayContaining(['recordings/captures/capture-new-42/000000.wav']),
  )
  db.getFirstAsync.mockResolvedValue({ ...row, audioUri: 'recordings/captures/capture-new-42/000000.wav', durationMs: 48587 })
  const loaded = await getNote(created.id)
  expect(created.audioUri).toBe(loaded?.audioUri)
  expect(created.audioUri).toBe('file:///documents/recordings/captures/capture-new-42/000000.wav')
  expect(created.content).toBe(input.content)
  expect(created.durationMs).toBe(48587)
})

test('persists an updated capture as the same relative path while preserving transcript and duration', async () => {
  db.getFirstAsync.mockResolvedValue({ ...row, audioUri: 'recordings/captures/capture-update-42/full.wav', durationMs: 120000 })
  const saved = await updateNote('one', { ...input, audioUri: 'file:///documents/recordings/captures/capture-update-42//full.wav', durationMs: 120000 })
  expect(db.runAsync).toHaveBeenLastCalledWith(
    expect.stringContaining('UPDATE notes'),
    expect.arrayContaining(['recordings/captures/capture-update-42/full.wav', input.content, 120000]),
  )
  expect(saved.audioUri).toBe('file:///documents/recordings/captures/capture-update-42/full.wav')
})

const summaryDocument: SummaryDocument = {
  version: 1,
  source: 'Call Alice',
  format: 'bullets',
  points: [{ text: 'Call Alice', sources: [{ start: 0, end: 10 }] }],
}

test('normalizes serialized metadata without leaking raw or unknown document fields', async () => {
  db.getFirstAsync.mockResolvedValue({
    ...row,
    summary: '• Call Alice',
    summaryDocument: JSON.stringify({ ...summaryDocument, unknownField: 'discard' }),
  })
  const saved = await getNote('one')
  expect(saved?.summaryDocument).toEqual(summaryDocument)
  expect(saved?.summary).toBe('• Call Alice')
  expect(saved?.content).toBe('Call Alice')
})

test.each([undefined, null, '{broken', JSON.stringify({ ...summaryDocument, version: 2 })])(
  'preserves legacy summary text when serialized metadata is %s', async (serialized) => {
    db.getFirstAsync.mockResolvedValue({ ...row, summary: 'Plain summary', summaryDocument: serialized })
    const saved = await getNote('one')
    expect(saved?.summaryDocument).toBeNull()
    expect(saved?.summary).toBe('Plain summary')
    expect(saved?.content).toBe('Call Alice')
    expect(saved?.createdAt).toBe(1)
    expect(saved?.updatedAt).toBe(2)
  },
)

test('returns a validated document on create and null for a source mismatch', async () => {
  const created = await createNote({ ...input, summary: '• Call Alice', summaryDocument })
  expect(created.summaryDocument).toEqual(summaryDocument)
  const mismatched = await createNote({ ...input, summary: '• Call Alice', summaryDocument: {
    ...summaryDocument, source: 'Different source',
  } })
  expect(mismatched.summaryDocument).toBeNull()
  expect(mismatched.summary).toBe('• Call Alice')
})
