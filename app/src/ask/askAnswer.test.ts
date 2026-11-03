import { generate } from '../ai/llm'
import { answerQuestion, buildAskContext } from './askAnswer'
import { buildAskIndex } from './askIndex'
import { retrieve } from './askRetrieval'

jest.mock('../ai/llm', () => ({ generate: jest.fn() }))

const now = new Date(2026, 9, 17, 12)
const index = buildAskIndex([{ id: 'trip', title: 'Hostel', content: 'I still need to book a hostel near the old town, the budget is about 40 euros per night.', summary: null, createdAt: now.getTime(), language: 'en' }], [])
const found = retrieve('Ile mogę wydać na hostel?', index, { now })
const reply = (text: string) => ({ text }) as Awaited<ReturnType<typeof generate>>

beforeEach(() => jest.mocked(generate).mockReset())

test('a refusal gets one second look at the best note', async () => {
  jest.mocked(generate).mockResolvedValueOnce(reply('Nie znalazłem tego w notatkach.')).mockResolvedValueOnce(reply('Około 40 euro za noc [1].'))
  const answer = await answerQuestion('Ile mogę wydać na hostel w Pradze?', found, index, 'pl', { now })
  expect(answer).toMatchObject({ text: 'Około 40 euro za noc [1].', retried: true })
  expect(jest.mocked(generate).mock.calls[1]?.[0]).toContain('Notatka [1] prawdopodobnie dotyczy tej sprawy')
})

test('a second refusal stays a refusal', async () => {
  jest.mocked(generate).mockResolvedValue(reply('Nie znalazłem tego w notatkach.'))
  const answer = await answerQuestion('Ile kosztuje bilet do Faro?', found, index, 'pl', { now })
  expect(answer.text).toBe('Nie znalazłem tego w notatkach.')
  expect(answer.retried).toBeUndefined()
})

test('an echoed question is asked again', async () => {
  jest.mocked(generate).mockResolvedValueOnce(reply('Ile mogę wydać na hostel? [1]')).mockResolvedValueOnce(reply('40 euro za noc [1].'))
  const answer = await answerQuestion('Ile mogę wydać na hostel?', found, index, 'pl', { now })
  expect(answer.text).toBe('40 euro za noc [1].')
})

test('a bare yes/no gets a second, fuller answer', async () => {
  jest.mocked(generate).mockResolvedValueOnce(reply('Nie, czekaj [1].')).mockResolvedValueOnce(reply('Nie, budżet to około 40 euro za noc, więcej nie wydawać [1].'))
  const answer = await answerQuestion('Czy mogę wydać 100 euro na hostel?', found, index, 'pl', { now })
  expect(answer.text).toBe('Nie, budżet to około 40 euro za noc, więcej nie wydawać [1].')
  expect(jest.mocked(generate).mock.calls[1]?.[0]).toContain('podaj, co dokładnie mówi notatka')
})

test('a weekday followed by its day of the month in words keeps that day', () => {
  const recorded = new Date(2026, 9, 30, 9)
  const notes = buildAskIndex([{ id: 'mama', title: 'Urodziny mamy', content: 'Prezent dla mamy muszę kupić do czwartku piątego.', summary: null, createdAt: recorded.getTime(), language: 'pl' }], [])
  const { context } = buildAskContext(retrieve('Do kiedy kupić prezent dla mamy?', notes, { now: recorded }), notes, 'pl', recorded)
  expect(context).toContain('do czwartku 5')
  expect(context).not.toContain('29 października')
})

test('a weekday is the date the note states for it, not the nearest one', () => {
  const recorded = new Date(2026, 9, 29, 20)
  const notes = buildAskIndex([{ id: 'mama', title: 'Urodziny mamy', content: 'Mama ma urodziny siódmego listopada to jest sobota. Prezent muszę kupić w czwartek piątego, bo później kurier nie dowiezie na sobotę.', summary: null, createdAt: recorded.getTime(), language: 'pl' }], [])
  const { context } = buildAskContext(retrieve('Kiedy są urodziny mamy?', notes, { now: recorded }), notes, 'pl', recorded)
  expect(context).toContain('7 listopada to jest sobota.')
  expect(context).toContain('na sobotę 7 listopada')
  expect(context).not.toContain('31 października')
})
