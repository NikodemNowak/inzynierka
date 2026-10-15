import type { BenchmarkGeneration } from './benchmarkTypes'

export interface GenerationPhaseTotal {
  phase: string
  calls: number
  wallMs: number
  promptMs: number
  predictedMs: number
  promptTokens: number
  predictedTokens: number
  sourceChars: number
}

// Per-phase totals for one benchmark run. Missing sourceChars (run files from
// before the field existed) counts as 0. Raw sums only, no rounding.
export const summarizeGenerationPhases = (
  generations: readonly BenchmarkGeneration[],
): GenerationPhaseTotal[] => {
  const totals = new Map<string, GenerationPhaseTotal>()
  for (const generation of generations) {
    const total = totals.get(generation.phase) ?? {
      phase: generation.phase,
      calls: 0,
      wallMs: 0,
      promptMs: 0,
      predictedMs: 0,
      promptTokens: 0,
      predictedTokens: 0,
      sourceChars: 0,
    }
    total.calls += 1
    total.wallMs += generation.wallMs
    total.promptMs += generation.promptMs
    total.predictedMs += generation.predictedMs
    total.promptTokens += generation.promptTokens
    total.predictedTokens += generation.predictedTokens
    total.sourceChars += generation.sourceChars ?? 0
    totals.set(generation.phase, total)
  }
  return [...totals.values()].sort((left, right) =>
    left.phase < right.phase ? -1 : left.phase > right.phase ? 1 : 0,
  )
}
