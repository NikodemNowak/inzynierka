import { GenerationCancelledError } from '../ai/llm'
import { askNotes } from './askService'
import { useAskStore } from './askStore'

jest.mock('../ai/llm', () => ({
  GenerationCancelledError: class GenerationCancelledError extends Error {},
}))
jest.mock('./askService', () => ({ askNotes: jest.fn() }))

const input = { notes: [], tasks: [], appLanguage: 'pl' as const }
const source = { number: 1, noteId: 'n1', title: 'Dentysta' }

beforeEach(() => {
  useAskStore.getState().clear()
  jest.mocked(askNotes).mockReset()
})

test('streams the answer, then keeps the cited notes', async () => {
  jest.mocked(askNotes).mockImplementation(async (_question, _input, callbacks) => {
    callbacks.onStage('answering')
    callbacks.onToken('<think>\n\n</think>\n\nW czwartek')
    expect(useAskStore.getState().messages[0]?.answer).toBe('W czwartek')
    return { text: 'W czwartek o 16:30 [1].', sources: [source], cited: [source] }
  })
  await useAskStore.getState().ask('Kiedy mam dentystę?', input)
  expect(useAskStore.getState().messages[0]).toMatchObject({ status: 'done', answer: 'W czwartek o 16:30 [1].', cited: [source] })
})

test('passes earlier turns as history', async () => {
  jest.mocked(askNotes).mockResolvedValue({ text: 'Odpowiedź', sources: [], cited: [] })
  await useAskStore.getState().ask('Kiedy oddaję auto?', input)
  await useAskStore.getState().ask('A ile to kosztuje?', input)
  expect(jest.mocked(askNotes).mock.calls[1]?.[1].history).toEqual([{ question: 'Kiedy oddaję auto?', answer: 'Odpowiedź' }])
})

test('a stopped answer is marked cancelled', async () => {
  jest.mocked(askNotes).mockRejectedValue(new GenerationCancelledError())
  await useAskStore.getState().ask('Co mam jutro?', input)
  expect(useAskStore.getState().messages[0]?.status).toBe('cancelled')
})

test('a half-written citation is hidden while streaming', async () => {
  jest.mocked(askNotes).mockImplementation(async (_question, _input, callbacks) => {
    callbacks.onToken('Czwartek [')
    expect(useAskStore.getState().messages[0]?.answer).toBe('Czwartek')
    return { text: 'Czwartek [1].', sources: [source], cited: [source] }
  })
  await useAskStore.getState().ask('Kiedy?', input)
})

test('streamed tokens are flushed at most every 50 ms', async () => {
  jest.useFakeTimers()
  try {
    jest.mocked(askNotes).mockImplementation(async (_question, _input, callbacks) => {
      callbacks.onToken('a')
      callbacks.onToken('b')
      callbacks.onToken('c')
      expect(useAskStore.getState().messages[0]?.answer).toBe('a')
      jest.advanceTimersByTime(60)
      expect(useAskStore.getState().messages[0]?.answer).toBe('abc')
      return { text: 'abc', sources: [], cited: [] }
    })
    await useAskStore.getState().ask('Test?', input)
  } finally {
    jest.useRealTimers()
  }
})

test('a deterministic list keeps its rows and follow-ups', async () => {
  const items = [{ text: 'Bank', noteId: 'n1', due: '15:00' }]
  jest.mocked(askNotes).mockResolvedValue({ text: 'x', sources: [source], cited: [source], intro: 'Na dziś masz 1 zadanie:', items, followUps: ['A jutro?'] })
  await useAskStore.getState().ask('Co mam dzisiaj?', input)
  expect(useAskStore.getState().messages[0]).toMatchObject({ intro: 'Na dziś masz 1 zadanie:', items, followUps: ['A jutro?'] })
})
