import type { GenerationMetric } from '../data/metricsRepository'

export interface PhaseSummary {
  phase: string
  runs: number
  medianTtftMs: number
  medianTokensPerSecond: number
  worstTtftMs: number
  worstTokensPerSecond: number
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

// Median rather than mean: the first run after loading the weights is far slower
// than the rest, and one such outlier drags an average away from what the user
// actually experiences. The worst case is reported separately instead of hidden.
export const summarizeByPhase = (metrics: readonly GenerationMetric[]): PhaseSummary[] => {
  const byPhase = new Map<string, GenerationMetric[]>()
  for (const metric of metrics) {
    const bucket = byPhase.get(metric.phase)
    if (bucket) bucket.push(metric)
    else byPhase.set(metric.phase, [metric])
  }

  return Array.from(byPhase.entries())
    .map(([phase, runs]) => ({
      phase,
      runs: runs.length,
      medianTtftMs: Math.round(median(runs.map((r) => r.ttftMs))),
      medianTokensPerSecond: Number(median(runs.map((r) => r.tokensPerSecond)).toFixed(2)),
      worstTtftMs: Math.max(...runs.map((r) => r.ttftMs)),
      worstTokensPerSecond: Number(Math.min(...runs.map((r) => r.tokensPerSecond)).toFixed(2)),
    }))
    .sort((a, b) => a.phase.localeCompare(b.phase))
}
