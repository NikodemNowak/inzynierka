import type { Note } from '../domain/note'
import { localeForLanguage, type Language } from '../i18n/language'

export type NoteSortMode = 'updated' | 'created'

export interface NoteListView {
  query: string
  category: string | null
  sortMode: NoteSortMode
}

// Polish text is compared without case or diacritics, so typing "ksiegowosc"
// finds "księgowość". SQLite cannot do this without the ICU extension, which is
// why the list is filtered here rather than in a query.
export const normalizeForSearch = (text: string): string =>
  text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // Ł is a distinct letter, not L with a mark, so Unicode decomposition leaves
    // it alone. Without this, "sluzbowa" would never find "służbowa".
    .replace(/ł/g, 'l')

// Every word of the query has to appear somewhere, in any order: "aneks czerwca"
// finds a note mentioning both. Matching is on substrings, so inflected forms
// ("najmu" for "najm") are found too — Polish has no stemmer available here.
const matchesQuery = (note: Note, words: string[]): boolean => {
  if (words.length === 0) return true
  const haystack = normalizeForSearch(
    [note.title, note.content, note.summary ?? ''].join('\n'),
  )
  return words.every((word) => haystack.includes(word))
}

const compare =
  (mode: NoteSortMode) =>
  (a: Note, b: Note): number =>
    mode === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt

// The single place that turns "all notes" into "what the list shows". Pure, so
// the search and sort rules can be tested without a database or a renderer.
export const selectVisibleNotes = (
  notes: Note[],
  view: NoteListView,
): Note[] => {
  const words = normalizeForSearch(view.query).split(/\s+/).filter(Boolean)
  return notes
    .filter((note) =>
      view.category === null ? true : note.tags.includes(view.category),
    )
    .filter((note) => matchesQuery(note, words))
    .sort(compare(view.sortMode))
}

export const groupNotesByDate = (
  notes: Note[],
  mode: NoteSortMode,
  now = new Date(),
  language: Language = 'pl',
): Array<{ title: string; data: Note[] }> => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const groups = new Map<string, { title: string; data: Note[] }>()
  for (const note of notes) {
    const date = new Date(mode === 'created' ? note.createdAt : note.updatedAt)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const title =
      date >= today
        ? language === 'pl'
          ? 'Dzisiaj'
          : 'Today'
        : date >= yesterday
          ? language === 'pl'
            ? 'Wczoraj'
            : 'Yesterday'
          : date.toLocaleDateString(localeForLanguage(language), {
              day: 'numeric',
              month: 'long',
              ...(date.getFullYear() !== now.getFullYear()
                ? { year: 'numeric' }
                : {}),
            })
    if (!groups.has(key)) groups.set(key, { title, data: [] })
    groups.get(key)?.data.push(note)
  }
  return [...groups.values()]
}
