import { includes, wordErrorRate } from './fullFlowSuite'
import { syntheticNotes } from './syntheticNotes'

jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }))
jest.mock('../ai/benchmarkAudio', () => ({ prepareBenchmarkAudio: jest.fn() }))
jest.mock('../stt/nativeCapture', () => ({ nativeCapture: null }))
jest.mock('../ai/llm', () => ({ generate: jest.fn(), GenerationCancelledError: class extends Error {} }))
jest.mock('llama.rn', () => ({ initLlama: jest.fn() }))

test('word error rate ignores case, diacritics and punctuation', () => {
  expect(wordErrorRate('Jutro o 16:30 mam dentystę.', 'jutro o 16 30 mam dentyste')).toBe(0)
  expect(wordErrorRate('Kupić mleko i chleb', 'kupić mleko i chleb')).toBe(0)
  expect(wordErrorRate('a b c d', 'a c d')).toBe(0.25)
})

test('expected words accept alternatives and grouped thousands', () => {
  expect(includes('No, the old ones are fine.', 'no|not|don')).toBe(true)
  expect(includes('Firma chce 19 500 zł', '19500')).toBe(true)
  expect(includes('W środę', 'śr')).toBe(true)
  expect(includes('Tak, kup chleb', 'nie')).toBe(false)
})

test('synthetic year is deterministic and dated before October', () => {
  const first = syntheticNotes(200)
  const second = syntheticNotes(200)
  expect(first.notes.map((note) => note.content)).toEqual(second.notes.map((note) => note.content))
  expect(first.notes).toHaveLength(200)
  expect(Math.max(...first.notes.map((note) => note.createdAt))).toBeLessThan(new Date(2026, 9, 1).getTime())
})
