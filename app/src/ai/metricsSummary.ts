import type { GenerationMetric } from '../data/metricsRepository'

export interface PhaseSummary {
  phase: string
  model: string
  execution: string
  backend: string
  status: string
  speculative: boolean | null
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
export const summarizeByPhase = (
  metrics: readonly GenerationMetric[],
): PhaseSummary[] => {
  const byPhase = new Map<string, GenerationMetric[]>()
  for (const metric of metrics) {
    const key = JSON.stringify([
      metric.phase,
      metric.model,
      metric.metadata?.revision ?? null,
      metric.metadata?.execution ?? 'unknown',
      metric.metadata?.devices ?? [],
      metric.metadata?.speculative ?? null,
      metric.metadata?.status ?? 'unknown',
    ])
    const bucket = byPhase.get(key)
    if (bucket) bucket.push(metric)
    else byPhase.set(key, [metric])
  }

  return Array.from(byPhase.entries())
    .map(([, runs]) => ({
      phase: runs[0]!.phase,
      model: runs[0]!.model,
      execution: runs[0]!.metadata?.execution ?? 'unknown',
      backend: runs[0]!.metadata?.devices?.join(', ') || 'unknown',
      status: runs[0]!.metadata?.status ?? 'unknown',
      speculative: runs[0]!.metadata?.speculative ?? null,
      runs: runs.length,
      medianTtftMs: Math.round(median(runs.map((r) => r.ttftMs))),
      medianTokensPerSecond: Number(
        median(runs.map((r) => r.tokensPerSecond)).toFixed(2),
      ),
      worstTtftMs: Math.max(...runs.map((r) => r.ttftMs)),
      worstTokensPerSecond: Number(
        Math.min(...runs.map((r) => r.tokensPerSecond)).toFixed(2),
      ),
    }))
    .sort((a, b) => a.phase.localeCompare(b.phase))
}
