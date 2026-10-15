import { summarizeGenerationPhases } from './benchmarkPhaseTotals'
import type { BenchmarkGeneration } from './benchmarkTypes'

const generation = (
  phase: string,
  overrides: Partial<BenchmarkGeneration> = {},
): BenchmarkGeneration => ({
  phase,
  inputChars: 10,
  ttftMs: 1,
  wallMs: 2,
  promptMs: 3,
  predictedMs: 4,
  promptTokens: 5,
  predictedTokens: 6,
  formattedPromptTokens: null,
  draftTokens: null,
  draftTokensAccepted: null,
  completion: null,
  ...overrides,
})

test('aggregates call counts and exact per-phase sums', () => {
  const totals = summarizeGenerationPhases([
    generation('summary-draft', {
      wallMs: 10,
      promptMs: 2,
      predictedMs: 8,
      promptTokens: 100,
      predictedTokens: 20,
      sourceChars: 500,
    }),
    generation('summary-verify', {
      wallMs: 4,
      promptMs: 1,
      predictedMs: 3,
      promptTokens: 40,
      predictedTokens: 10,
      sourceChars: 500,
    }),
    generation('summary-draft', {
      wallMs: 20,
      promptMs: 5,
      predictedMs: 15,
      promptTokens: 200,
      predictedTokens: 30,
      sourceChars: 250,
    }),
  ])
  expect(totals).toEqual([
    {
      phase: 'summary-draft',
      calls: 2,
      wallMs: 30,
      promptMs: 7,
      predictedMs: 23,
      promptTokens: 300,
      predictedTokens: 50,
      sourceChars: 750,
    },
    {
      phase: 'summary-verify',
      calls: 1,
      wallMs: 4,
      promptMs: 1,
      predictedMs: 3,
      promptTokens: 40,
      predictedTokens: 10,
      sourceChars: 500,
    },
  ])
})

test('counts undefined and null sourceChars as zero', () => {
  const totals = summarizeGenerationPhases([
    generation('task-change'),
    generation('task-change', { sourceChars: null }),
    generation('task-change', { sourceChars: 42 }),
  ])
  expect(totals).toEqual([
    {
      phase: 'task-change',
      calls: 3,
      wallMs: 6,
      promptMs: 9,
      predictedMs: 12,
      promptTokens: 15,
      predictedTokens: 18,
      sourceChars: 42,
    },
  ])
})

test('orders phases by name regardless of input order', () => {
  const totals = summarizeGenerationPhases([
    generation('title'),
    generation('summary-verify'),
    generation('summary-draft'),
    generation('task-change'),
  ])
  expect(totals.map((total) => total.phase)).toEqual([
    'summary-draft',
    'summary-verify',
    'task-change',
    'title',
  ])
})

test('returns an empty list when no generation was recorded', () => {
  expect(summarizeGenerationPhases([])).toEqual([])
})

test('does not accumulate totals between calls', () => {
  const first = summarizeGenerationPhases([
    generation('summary-draft', { sourceChars: 10 }),
  ])
  const second = summarizeGenerationPhases([
    generation('summary-draft', { sourceChars: 5 }),
  ])
  expect(first[0].sourceChars).toBe(10)
  expect(second[0].sourceChars).toBe(5)
})
