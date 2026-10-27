import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { answerTaskQuestion, taskScope } from './askTasks'
import { isTaskQuestion, questionDays } from './askRetrieval'
import { askNotes } from './askService'

jest.mock('../ai/llm', () => ({ generate: jest.fn() }))
jest.mock('../ai/modelReady', () => ({ ensureModelReady: jest.fn() }))
jest.mock('./embeddingModel', () => ({ isEmbeddingModelDownloaded: jest.fn().mockResolvedValue(false) }))

// Wednesday 14 October 2026, noon. The week ends on Sunday the 18th.
const now = new Date(2026, 9, 14, 12)
const at = (day: number, hour = 9): number => new Date(2026, 9, day, hour).getTime()

const note = (id: string, title: string, createdAt: number): Note => ({
  id, title, content: '', summary: null, tags: [], audioUri: null, durationMs: null, createdAt, updatedAt: createdAt,
})
const notes = [
  note('today', 'Dzisiejsze', at(14)),
  // Recorded on Sunday: its "jutro" is Monday the 12th, already behind us.
  note('old', 'Sprzed trzech dni', at(11)),
  note('week', 'Plany tygodnia', at(14)),
]
let counter = 0
const task = (noteId: string, text: string, done = false): Task => ({ id: `t${counter++}`, noteId, text, done, createdAt: 0 })
const tasks = [
  task('today', 'Zadzwonić do banku — dziś 15:00'),
  task('today', 'Kupić mleko — jutro'),
  task('today', 'Oddać książki'),
  task('today', 'Zrobione już — dziś', true),
  task('old', 'Wysłać paczkę — jutro'),
  task('week', 'Dentysta — piątek 16:30'),
  task('week', 'Urodziny Ani — sobota'),
  task('week', 'Konferencja — poniedziałek'),
  task('week', 'Festiwal — 30 października'),
]
const texts = (answer: { items?: { text: string }[] }): string[] => (answer.items ?? []).map((item) => item.text)

test('today: only open tasks due today, overdue in their own short group', () => {
  const scope = taskScope('Co mam dzisiaj?', now)!
  const answer = answerTaskQuestion(scope, { notes, tasks }, 'pl', now)
  expect(answer.deterministic).toBe(true)
  expect(texts(answer)).toEqual(['Zadzwonić do banku', 'Wysłać paczkę'])
  const [bank, parcel] = answer.items!
  expect(bank).toMatchObject({ due: '15:00', group: 'Dziś' })
  expect(bank?.overdue).toBeUndefined()
  expect(parcel).toMatchObject({ overdue: true, group: 'Zaległe', noteId: 'old' })
  expect(answer.intro).toBe('Na dziś masz 1 zadanie:')
  expect(answer.cited.map((source) => source.noteId)).toEqual(['today', 'old'])
  expect(answer.followUps).toEqual(['A jutro?', 'Co zaległe?'])
})

test('a note from three days ago saying "jutro" is overdue, not today', () => {
  const answer = answerTaskQuestion(taskScope('Co mam dzisiaj?', now)!, { notes, tasks: [task('old', 'Wysłać paczkę — jutro')] }, 'pl', now)
  expect(answer.intro).toBe('Na dziś nie masz zadań. Masz jednak 1 zaległe zadanie:')
  expect(answer.items).toEqual([expect.objectContaining({ text: 'Wysłać paczkę', overdue: true })])
})

test('overdue tasks after today are capped at five', () => {
  const many = Array.from({ length: 8 }, (_, number) => task('old', `Stare ${number} — jutro`))
  const answer = answerTaskQuestion(taskScope('Co mam dzisiaj?', now)!, { notes, tasks: many }, 'pl', now)
  expect(answer.items).toHaveLength(5)
})

test('tomorrow shows tomorrow only, with no overdue block', () => {
  const answer = answerTaskQuestion(taskScope('co mam jutro?', now)!, { notes, tasks }, 'pl', now)
  expect(texts(answer)).toEqual(['Kupić mleko'])
  expect(answer.intro).toBe('Na jutro masz 1 zadanie:')
})

test('this week runs to Sunday and skips done, undated, later and next week', () => {
  const answer = answerTaskQuestion(taskScope('Co mam w tym tygodniu?', now)!, { notes, tasks }, 'pl', now)
  expect(texts(answer)).toEqual(['Zadzwonić do banku', 'Kupić mleko', 'Dentysta', 'Urodziny Ani'])
  expect(answer.items?.find((item) => item.text === 'Dentysta')?.due).toContain('16:30')
})

test('next week is Monday to Sunday', () => {
  const answer = answerTaskQuestion(taskScope('Co mam w przyszłym tygodniu?', now)!, { notes, tasks }, 'pl', now)
  expect(texts(answer)).toEqual(['Konferencja'])
})

test('weekend is Saturday and Sunday', () => {
  const answer = answerTaskQuestion(taskScope('Co mam w weekend?', now)!, { notes, tasks }, 'pl', now)
  expect(texts(answer)).toEqual(['Urodziny Ani'])
})

test('overdue question lists every overdue open task', () => {
  const answer = answerTaskQuestion(taskScope('Co zaległe?', now)!, { notes, tasks }, 'pl', now)
  expect(texts(answer)).toEqual(['Wysłać paczkę'])
  expect(answer.items?.every((item) => item.overdue)).toBe(true)
})

test('all open tasks come grouped by when they are due', () => {
  const answer = answerTaskQuestion(taskScope('Co mam do zrobienia?', now)!, { notes, tasks }, 'pl', now)
  expect(answer.items?.map((item) => [item.group, item.text])).toEqual([
    ['Zaległe', 'Wysłać paczkę'],
    ['Dziś', 'Zadzwonić do banku'],
    ['Ten tydzień', 'Kupić mleko'],
    ['Ten tydzień', 'Dentysta'],
    ['Ten tydzień', 'Urodziny Ani'],
    ['Później', 'Konferencja'],
    ['Później', 'Festiwal'],
    ['Bez terminu', 'Oddać książki'],
  ])
})

test('English answer', () => {
  const answer = answerTaskQuestion(taskScope('What do I have to do today?', now)!, { notes, tasks: tasks.slice(0, 1) }, 'en', now)
  expect(answer.intro).toBe('You have 1 task for today:')
  expect(answer.text).toContain('- Zadzwonić do banku — 15:00')
})

test('an empty day says so', () => {
  const answer = answerTaskQuestion(taskScope('co mam w niedzielę?', now)!, { notes, tasks }, 'pl', now)
  expect(answer.text).toContain('nie masz zadań.')
  expect(answer.items).toEqual([])
})

test('which questions are task questions', () => {
  expect(isTaskQuestion('co mam w lodówce', now)).toBe(false)
  expect(isTaskQuestion('co mam dzisiaj?', now)).toBe(true)
  expect(isTaskQuestion('Co mam zrobić jutro?', now)).toBe(true)
  expect(isTaskQuestion('What do I have in the fridge?', now)).toBe(false)
  expect(isTaskQuestion('what do I have today', now)).toBe(true)
  expect(taskScope('co mam w lodówce', now)).toBeNull()
  expect(taskScope('Co mam do zrobienia w sprawie urodzin taty?', now)).toBeNull()
  expect(taskScope('Kiedy mam dentystę?', now)).toBeNull()
  expect(taskScope('Co mam wczoraj?', now)).toBeNull()
})

test('a short follow-up keeps asking about tasks', () => {
  expect(taskScope('A jutro?', now)).toBeNull()
  expect(taskScope('A jutro?', now, 'Co mam dzisiaj?')?.kind).toBe('tomorrow')
  expect(taskScope('And tomorrow?', now, 'What do I have today?')?.kind).toBe('tomorrow')
  expect(taskScope('A jutro?', now, 'Kiedy mam dentystę?')).toBeNull()
})

describe('question days', () => {
  const day = (ms: number): number => new Date(ms).getDate()
  const range = (question: string, date = now): [number, number] | null => {
    const found = questionDays(question, date)
    return found && [day(found.from), day(found.to)]
  }
  test('week, next week, weekend', () => {
    expect(range('Co mam w tym tygodniu?')).toEqual([14, 18])
    expect(range('Co mam w przyszłym tygodniu?')).toEqual([19, 25])
    expect(range('Co mam w weekend?')).toEqual([17, 18])
    expect(range('Co mam w następny weekend?')).toEqual([24, 25])
    // On Saturday the weekend starts today; on Sunday it is just today.
    expect(range('co mam w weekend', new Date(2026, 9, 17, 10))).toEqual([17, 18])
    expect(range('co mam w weekend', new Date(2026, 9, 18, 10))).toEqual([18, 18])
  })
  test('single days', () => {
    expect(range('co mam jutro')).toEqual([15, 15])
    expect(range('co mam pojutrze')).toEqual([16, 16])
    expect(range('co mam w poniedziałek')).toEqual([19, 19])
    expect(range('co mam w środę')).toEqual([14, 14])
  })
  test('overdue reaches back without limit', () => {
    const found = questionDays('Co zaległe?', now)!
    expect(found.from).toBe(Number.NEGATIVE_INFINITY)
    expect(day(found.to)).toBe(13)
    expect(questionDays('show overdue tasks', now)?.from).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('askNotes', () => {
  const callbacks = { onStage: jest.fn(), onToken: jest.fn(), signal: new AbortController().signal }
  test('answers a today question without the model', async () => {
    const { generate } = jest.requireMock('../ai/llm') as { generate: jest.Mock }
    const answer = await askNotes('Co mam dzisiaj?', { notes, tasks, history: [], appLanguage: 'pl' }, callbacks, now)
    expect(answer.deterministic).toBe(true)
    expect(generate).not.toHaveBeenCalled()
  })
})
