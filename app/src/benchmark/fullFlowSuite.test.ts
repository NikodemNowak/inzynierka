import type { GenerationMetric } from '../data/metricsRepository'
import { generationSpeed, includes, wordErrorRate } from './fullFlowSuite'
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

test('generation speed sums tokens over time, not per-call rates', () => {
  const call = (promptTokens: number, promptMs: number, predictedTokens: number, predictedMs: number): GenerationMetric => ({
    id: String(promptTokens), phase: 'summary', model: 'Qwen3.5-4B (Q4_K_M)', inputChars: 0, ttftMs: 0, tokensPerSecond: 0,
    wallMs: promptMs + predictedMs, promptMs, predictedMs, promptTokens, predictedTokens, createdAt: 0,
  })
  const speed = generationSpeed([call(1000, 2000, 100, 5000), call(3000, 6000, 300, 10000), call(10, 0, 0, 0)])
  expect(speed.calls).toBe(3)
  expect(speed.models).toEqual(['Qwen3.5-4B (Q4_K_M)'])
  expect(speed.prefillTokensPerSecond).toBe(500)
  expect(speed.decodeTokensPerSecond).toBe(26.7)
  expect(speed.decodePerCall).toEqual({ min: 20, median: 30, max: 30 })
  expect(generationSpeed([]).decodePerCall).toBeNull()
})

test('synthetic year is deterministic and dated before October', () => {
  const first = syntheticNotes(200)
  const second = syntheticNotes(200)
  expect(first.notes.map((note) => note.content)).toEqual(second.notes.map((note) => note.content))
  expect(first.notes).toHaveLength(200)
  expect(Math.max(...first.notes.map((note) => note.createdAt))).toBeLessThan(new Date(2026, 9, 1).getTime())
})
