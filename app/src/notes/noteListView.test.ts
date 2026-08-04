import type { Note } from '../domain/note'
import { normalizeForSearch, selectVisibleNotes, type NoteListView } from './noteListView'

const note = (overrides: Partial<Note> & Pick<Note, 'id'>): Note => ({
  title: '',
  content: '',
  summary: null,
  tags: [],
  audioUri: null,
  durationMs: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const view = (overrides: Partial<NoteListView> = {}): NoteListView => ({
  query: '',
  category: null,
  sortMode: 'updated',
  ...overrides,
})

describe('normalizeForSearch', () => {
  it('folds Polish case and diacritics, which SQLite cannot do without ICU', () => {
    expect(normalizeForSearch('KSIĘGOWOŚĆ')).toBe('ksiegowosc')
    expect(normalizeForSearch('Podróż Służbowa')).toBe('podroz sluzbowa')
    expect(normalizeForSearch('ZAŻÓŁĆ GĘŚLĄ JAŹŃ')).toBe('zazolc gesla jazn')
  })
})

describe('selectVisibleNotes', () => {
  const meeting = note({
    id: 'a',
    title: 'Zadania na tydzień',
    content: 'Aneks do umowy najmu magazynu.',
    summary: 'Należy wysłać mail do księgowości.',
    tags: ['Praca', 'Finanse'],
    createdAt: 300,
    updatedAt: 100,
  })
  const shopping = note({
    id: 'b',
    title: 'Zakupy',
    content: 'Mleko, chleb, masło.',
    tags: ['Zakupy'],
    createdAt: 200,
    updatedAt: 200,
  })
  const idea = note({
    id: 'c',
    title: 'Pomysł na aplikację',
    content: 'Notatki głosowe bez chmury.',
    createdAt: 100,
    updatedAt: 300,
  })
  const notes = [meeting, shopping, idea]

  it('returns everything when nothing is filtered', () => {
    expect(selectVisibleNotes(notes, view()).map((n) => n.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts by modification date by default and by creation date on request', () => {
    expect(selectVisibleNotes(notes, view({ sortMode: 'updated' })).map((n) => n.id)).toEqual([
      'c',
      'b',
      'a',
    ])
    expect(selectVisibleNotes(notes, view({ sortMode: 'created' })).map((n) => n.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('matches a query typed without Polish diacritics', () => {
    // "księgowości" appears only in the summary, and only with diacritics.
    expect(selectVisibleNotes(notes, view({ query: 'ksiegowosc' })).map((n) => n.id)).toEqual(['a'])
  })

  it('matches inside a word, which is what carries Polish inflection', () => {
    // "najm" finds "najmu" — the reason a prefix-only FTS index was rejected.
    expect(selectVisibleNotes(notes, view({ query: 'najm' })).map((n) => n.id)).toEqual(['a'])
  })

  it('requires every word of the query, in any order', () => {
    expect(selectVisibleNotes(notes, view({ query: 'aneks magazynu' })).map((n) => n.id)).toEqual([
      'a',
    ])
    expect(selectVisibleNotes(notes, view({ query: 'magazynu aneks' })).map((n) => n.id)).toEqual([
      'a',
    ])
    expect(selectVisibleNotes(notes, view({ query: 'aneks mleko' }))).toEqual([])
  })

  it('searches the title as well as the content', () => {
    expect(selectVisibleNotes(notes, view({ query: 'tydzien' })).map((n) => n.id)).toEqual(['a'])
  })

  it('ignores surrounding and repeated whitespace in the query', () => {
    expect(selectVisibleNotes(notes, view({ query: '  aneks   magazynu ' })).map((n) => n.id)).toEqual(
      ['a'],
    )
  })

  it('combines the category filter with the query', () => {
    expect(selectVisibleNotes(notes, view({ category: 'Praca' })).map((n) => n.id)).toEqual(['a'])
    expect(selectVisibleNotes(notes, view({ category: 'Praca', query: 'mleko' }))).toEqual([])
  })

  it('does not mutate the array it was given', () => {
    const original = [...notes]
    selectVisibleNotes(notes, view({ sortMode: 'created' }))
    expect(notes).toEqual(original)
  })
})
