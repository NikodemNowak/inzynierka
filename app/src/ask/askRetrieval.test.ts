import { buildAskContext, estimateTokens, parseAnswer } from './askAnswer'
import { buildAskIndex, type AskNote } from './askIndex'
import { isConfidentMatch, questionDays, retrieve } from './askRetrieval'
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
  expect(context).toMatch(/Zadanie: Wizyta u dentysty \(czwartek, 15 października, 16:30, zaległe, 1 dzień\)/u)
})

test('parses citations and strips thinking', () => {
  const sources = [{ number: 1, noteId: 'a', title: 'A' }, { number: 2, noteId: 'b', title: 'B' }]
  const answer = parseAnswer('<think>\n</think>\nDentysta jest w czwartek [2], a zakupy [2][1]. [7]', sources)
  expect(answer.text.startsWith('Dentysta')).toBe(true)
  expect(answer.cited.map((source) => source.noteId)).toEqual(['b', 'a'])
})

test('parseAnswer drops citations of notes that do not exist', () => {
  const sources = [{ number: 1, noteId: 'a', title: 'A' }]
  const answer = parseAnswer('Tak [1] i jeszcze [4].', sources)
  expect(answer.text).toBe('Tak [1] i jeszcze.')
  expect(answer.cited.map((source) => source.noteId)).toEqual(['a'])
})

test('an answer without numbers cites the best note, unless nothing was found', () => {
  const sources = [{ number: 1, noteId: 'a', title: 'A' }, { number: 2, noteId: 'b', title: 'B' }]
  expect(parseAnswer('W czwartek o 16:30.', sources).cited.map((source) => source.noteId)).toEqual(['a'])
  expect(parseAnswer('Nie znalazłem tego w notatkach.', sources).cited).toEqual([])
})

test('the context is trimmed from the lowest-ranked passages to fit the budget', () => {
  const long = (id: string) => ({ id, title: id, content: Array.from({ length: 20 }, (_, n) => `Zdanie numer ${n} o sprawie ${id} i dentyście.`).join(' '), summary: null, createdAt: wednesday })
  const big = buildAskIndex([long('a'), long('b')], [])
  const found = retrieve('dentyście sprawie', big, { now: friday, maxPassages: 12 })
  const full = buildAskContext(found, big, 'pl', friday)
  const trimmed = buildAskContext(found, big, 'pl', friday, true, 120)
  expect(estimateTokens(full.context)).toBeGreaterThan(120)
  expect(estimateTokens(trimmed.context)).toBeLessThanOrEqual(120)
  expect(trimmed.context).toContain('[1]')
  expect(trimmed.sources.length).toBeLessThanOrEqual(full.sources.length)
  expect(trimmed.sources[0]?.noteId).toBe(full.sources[0]?.noteId)
})

test('a task with an unreadable deadline says so', () => {
  const unclear = buildAskIndex([notes[0]!], [{ noteId: 'dentist', text: 'Zadzwonić — przed obroną', done: false }])
  const found = retrieve('zadzwonić', unclear, { now: friday })
  expect(buildAskContext(found, unclear, 'pl', friday).context).toContain('Zadanie: Zadzwonić (termin niejasny)')
})

test('a question that its best note fully covers skips synonym expansion', () => {
  const found = retrieve('kupić mleko i chleb', index, { now: friday })
  expect(isConfidentMatch('kupić mleko i chleb', found)).toBe(true)
  expect(isConfidentMatch('stomatolog', retrieve('stomatolog', index, { now: friday }))).toBe(false)
})

test('a day question only keeps tasks due that day and never done ones', () => {
  const day = buildAskIndex(notes, [
    { noteId: 'dentist', text: 'Wizyta u dentysty — jutro 16:30', done: false },
    { noteId: 'dentist', text: 'Kupić mleko — jutro', done: true },
    { noteId: 'car', text: 'Oddać auto — poniedziałek', done: false },
  ])
  const found = retrieve('co mam do zrobienia w czwartek?', day, { now: new Date(2026, 9, 15, 10) })
  const taskTexts = found.flatMap((note) => note.passages).filter((chunk) => chunk.kind === 'task').map((chunk) => chunk.text)
  expect(taskTexts).not.toContain('Oddać auto — poniedziałek')
  expect(taskTexts).not.toContain('Kupić mleko — jutro')
}) 

test('toggling one task does not rebuild the other notes', () => {
  const first = buildAskIndex(notes, tasks)
  const toggled = buildAskIndex(notes, tasks.map((task) => (task.text === 'Book the hotel' ? { ...task, done: true } : task)))
  // The same chunk objects are reused for untouched notes (identical terms arrays).
  const termsOf = (built: ReturnType<typeof buildAskIndex>, id: string) => built.chunks.find((chunk) => chunk.noteId === id && chunk.kind === 'sentence')?.terms
  expect(termsOf(toggled, 'dentist')).toBe(termsOf(first, 'dentist'))
  expect(toggled.chunks.find((chunk) => chunk.text === 'Book the hotel')?.done).toBe(true)
  const edited = buildAskIndex(notes.map((note) => (note.id === 'car' ? { ...note, content: 'zupełnie inny tekst' } : note)), tasks)
  expect(edited.chunks.some((chunk) => chunk.text.includes('zupełnie inny'))).toBe(true)
  expect(edited.chunks.some((chunk) => chunk.text.includes('przegląd'))).toBe(false)
})
