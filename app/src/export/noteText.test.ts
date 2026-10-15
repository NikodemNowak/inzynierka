import type { Note } from '../domain/note'
import { parseSummaryDocument, renderSummaryDocument, type SummaryDocument } from '../domain/summary'
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

const linkedSummary = (
  source: string,
  format: SummaryDocument['format'],
  points: SummaryDocument['points'],
): { summary: string; document: SummaryDocument } => {
  const document: SummaryDocument = { version: 1, source, format, points }
  const summary = renderSummaryDocument(document)
  expect(parseSummaryDocument(document, source, summary)).toEqual(document)
  return { summary, document }
}

describe('formatNoteAsText', () => {
  it('translates English export labels while retaining the original content', () => {
    const source = note({
      title: '',
      summary: 'Polskie podsumowanie.',
      tags: ['Praca', 'Finanse'],
      language: 'pl',
    })
    const text = formatNoteAsText(source, [task('Wysłać mail', false)], 'en')
    expect(text).toContain('(untitled)')
    expect(text).toContain('Categories: Work, Finance')
    expect(text).toContain('— Transcript —')
    expect(text).toContain('— Tasks —')
    expect(text).toContain(source.summary)
    expect(text).toContain(source.content)
    expect(text).toContain('☐ Wysłać mail')
    expect(source.tags).toEqual(['Praca', 'Finanse'])
    expect(source.language).toBe('pl')
  })

  it('starts with the title and the recording date', () => {
    const lines = formatNoteAsText(note(), []).split('\n\n')
    expect(lines[0]).toBe('Zadania na tydzień')
    expect(lines[1]).toContain('04.08.2026')
  })

  it('falls back to a placeholder when the note has no title', () => {
    expect(formatNoteAsText(note({ title: '   ' }), [])).toContain(
      '(bez tytułu)',
    )
  })

  it('labels the transcript only when a summary precedes it', () => {
    const withSummary = formatNoteAsText(
      note({ summary: 'Aneks do 15 czerwca.' }),
      [],
    )
    expect(withSummary).toContain('— Transkrypcja —')

    const withoutSummary = formatNoteAsText(note(), [])
    expect(withoutSummary).not.toContain('— Transkrypcja —')
    expect(withoutSummary).toContain('Aneks do umowy najmu')
  })

  it('lists categories, skipping tags outside the fixed set', () => {
    const text = formatNoteAsText(
      note({ tags: ['Praca', 'wynajem magazynu', 'Finanse'] }),
      [],
    )
    expect(text).toContain('Kategorie: Praca, Finanse')
    expect(text).not.toContain('wynajem magazynu')
  })

  it('marks done and pending tasks differently', () => {
    const text = formatNoteAsText(note(), [
      task('Wysłać mail', true),
      task('Sprawdzić termin', false),
    ])
    expect(text).toContain('☑ Wysłać mail')
    expect(text).toContain('☐ Sprawdzić termin')
  })

  it('omits the task section when there are none', () => {
    expect(formatNoteAsText(note(), [])).not.toContain('— Zadania —')
  })

  it.each([
    {
      name: 'canonical bullets',
      ...linkedSummary('W piątek nie mam zajęć.', 'bullets', [
        { text: 'Piątek: brak zajęć.', sources: [{ start: 0, end: 'W piątek nie mam zajęć.'.length }] },
      ]),
    },
    {
      name: 'canonical grouped summary',
      ...linkedSummary('Spotkanie w poniedziałek. Budżet wynosi 20 zł.', 'grouped', [
        { text: 'Poniedziałek: spotkanie.', group: 'Termin', sources: [{ start: 0, end: 'Spotkanie w poniedziałek.'.length }] },
        { text: 'Budżet: 20 zł.', group: 'Koszt', sources: [{ start: 'Spotkanie w poniedziałek. '.length, end: 'Spotkanie w poniedziałek. Budżet wynosi 20 zł.'.length }] },
      ]),
    },
    {
      name: 'canonical paragraph',
      ...linkedSummary('Lubię spokojne poranki.', 'paragraph', [
        { text: 'Preferuję spokojne poranki.', sources: [{ start: 0, end: 'Lubię spokojne poranki.'.length }] },
      ]),
    },
  ])('exports $name as ordinary summary text without document metadata', ({ summary, document }) => {
    const sourceNote = note({ content: document.source, summary, summaryDocument: document })
    const exported = formatNoteAsText(sourceNote, [])

    expect(exported).toContain(summary)
    expect(exported).toBe(formatNoteAsText({ ...sourceNote, summaryDocument: undefined }, []))
    expect(exported).not.toContain('sourceIds')
    expect(exported).not.toContain('summaryDocument')
    expect(exported).not.toContain('"start":')
    expect(exported).not.toContain('"end":')
  })

  it('keeps legacy plaintext summaries unchanged when no document is present', () => {
    const legacySummary = 'Stare podsumowanie bez odnośników.'
    const legacyNote = note({ summary: legacySummary })

    expect(formatNoteAsText(legacyNote, [])).toContain(legacySummary)
    expect(formatNoteAsText(legacyNote, [])).toBe(formatNoteAsText({ ...legacyNote, summaryDocument: null }, []))
  })
})
