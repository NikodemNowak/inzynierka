import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { formatNoteAsText } from './noteText'

const CREATED_AT = new Date(2026, 7, 4, 13, 38).getTime()

const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Zadania na tydzień',
  content: 'Aneks do umowy najmu trzeba przygotować do 15 czerwca.',
  summary: null,
  tags: [],
  audioUri: null,
  durationMs: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
})

const task = (text: string, done: boolean): Task => ({
  id: text,
  noteId: 'n1',
  text,
  done,
  createdAt: CREATED_AT,
})

describe('formatNoteAsText', () => {
  it('starts with the title and the recording date', () => {
    const lines = formatNoteAsText(note(), []).split('\n\n')
    expect(lines[0]).toBe('Zadania na tydzień')
    expect(lines[1]).toContain('04.08.2026')
  })

  it('falls back to a placeholder when the note has no title', () => {
    expect(formatNoteAsText(note({ title: '   ' }), [])).toContain('(bez tytułu)')
  })

  it('labels the transcript only when a summary precedes it', () => {
    const withSummary = formatNoteAsText(note({ summary: 'Aneks do 15 czerwca.' }), [])
    expect(withSummary).toContain('— Transkrypcja —')

    const withoutSummary = formatNoteAsText(note(), [])
    expect(withoutSummary).not.toContain('— Transkrypcja —')
    expect(withoutSummary).toContain('Aneks do umowy najmu')
  })

  it('lists categories, skipping tags outside the fixed set', () => {
    const text = formatNoteAsText(note({ tags: ['Praca', 'wynajem magazynu', 'Finanse'] }), [])
    expect(text).toContain('Kategorie: Praca, Finanse')
    expect(text).not.toContain('wynajem magazynu')
  })

  it('marks done and pending tasks differently', () => {
    const text = formatNoteAsText(note(), [task('Wysłać mail', true), task('Sprawdzić termin', false)])
    expect(text).toContain('☑ Wysłać mail')
    expect(text).toContain('☐ Sprawdzić termin')
  })

  it('omits the task section when there are none', () => {
    expect(formatNoteAsText(note(), [])).not.toContain('— Zadania —')
  })
})
