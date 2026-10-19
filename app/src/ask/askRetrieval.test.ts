import { buildAskContext, parseAnswer } from './askAnswer'
import { buildAskIndex, type AskNote } from './askIndex'
import { questionDays, retrieve } from './askRetrieval'
import { questionLanguage, terms } from './askText'

// Wednesday 14 October 2026
const wednesday = new Date(2026, 9, 14, 10, 0).getTime()
const friday = new Date(2026, 9, 16, 12, 0)

const notes: AskNote[] = [
  { id: 'dentist', title: 'Dentysta i zakupy', content: 'jutro o 16:30 mam dentystę na Piotrkowskiej. muszę jeszcze kupić mleko i chleb', summary: '• Wizyta u dentysty jutro o 16:30', createdAt: wednesday },
  { id: 'car', title: 'Przegląd samochodu', content: 'samochód trzeba oddać na przegląd w poniedziałek rano. mechanik mówił że wymiana oleju kosztuje 300 zł', summary: null, createdAt: wednesday },
  { id: 'trip', title: 'Trip to Berlin', content: 'I am flying to Berlin next Friday. I need to book the hotel and pack the charger.', summary: null, createdAt: wednesday },
]
const tasks = [
  { noteId: 'dentist', text: 'Wizyta u dentysty — jutro 16:30', done: false },
  { noteId: 'dentist', text: 'Kupić mleko', done: true },
  { noteId: 'trip', text: 'Book the hotel', done: false },
]
const index = buildAskIndex(notes, tasks)

test('terms fold diacritics and inflection', () => {
  expect(terms('dentysty')).toEqual(terms('dentysta'))
  expect(terms('Łódź')).toEqual(['lodz'])
  expect(terms('o której mam spotkanie')).toEqual(['spotka'])
})

test('question language', () => {
  expect(questionLanguage('Kiedy mam dentystę?', 'en')).toBe('pl')
  expect(questionLanguage('When is my flight?', 'pl')).toBe('en')
  expect(questionLanguage('Berlin', 'pl')).toBe('pl')
})

test('question days', () => {
  const tomorrow = questionDays('co mam jutro?', friday)
  expect(tomorrow && new Date(tomorrow.from).getDate()).toBe(17)
  const thisWeek = questionDays('what do I have this week', friday)
  expect(thisWeek && [new Date(thisWeek.from).getDate(), new Date(thisWeek.to).getDate()]).toEqual([16, 18])
  expect(questionDays('ile kosztuje olej', friday)).toBeNull()
})

test('finds the note by inflected words', () => {
  const found = retrieve('Kiedy idę do dentysty?', index, { now: friday })
  expect(found[0]?.noteId).toBe('dentist')
})

test('finds the note by a date relative to the recording', () => {
  // "jutro" in the Wednesday note is Thursday 15 October.
  const found = retrieve('co miałem w czwartek 15 października?', index, { now: friday })
  expect(found[0]?.noteId).toBe('dentist')
})

test('a short follow-up borrows the previous question', () => {
  const found = retrieve('a ile to kosztuje?', index, { now: friday, history: ['kiedy oddaję samochód na przegląd?'] })
  expect(found[0]?.noteId).toBe('car')
})

test('english question over english note', () => {
  const found = retrieve('Which hotel do I need to book?', index, { now: friday })
  expect(found[0]?.noteId).toBe('trip')
})

test('nothing matches an unrelated question', () => {
  expect(retrieve('quantum chromodynamics', index, { now: friday })).toEqual([])
})

test('context numbers notes and resolves task dates', () => {
  const found = retrieve('Kiedy idę do dentysty?', index, { now: friday })
  const { context, sources } = buildAskContext(found, index, 'pl', friday)
  expect(sources[0]).toEqual({ number: 1, noteId: 'dentist', title: 'Dentysta i zakupy' })
  expect(context).toContain('[1] Notatka „Dentysta i zakupy”')
  expect(context).toMatch(/Zadanie: Wizyta u dentysty \(czwartek, 15 października, 16:30\)/u)
})

test('parses citations and strips thinking', () => {
  const sources = [{ number: 1, noteId: 'a', title: 'A' }, { number: 2, noteId: 'b', title: 'B' }]
  const answer = parseAnswer('<think>\n</think>\nDentysta jest w czwartek [2], a zakupy [2][1]. [7]', sources)
  expect(answer.text.startsWith('Dentysta')).toBe(true)
  expect(answer.cited.map((source) => source.noteId)).toEqual(['b', 'a'])
})
