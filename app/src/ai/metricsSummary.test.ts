import type { GenerationMetric } from '../data/metricsRepository'
import { summarizeByPhase } from './metricsSummary'

const metric = (
  phase: string,
  ttftMs: number,
  tokensPerSecond: number,
): GenerationMetric => ({
  id: `${phase}-${ttftMs}`,
  phase,
  model: 'Qwen3-1.7B (Q4_K_M)',
  inputChars: 300,
  ttftMs,
  tokensPerSecond,
  wallMs: null,
  promptMs: null,
  predictedMs: null,
  promptTokens: null,
  predictedTokens: null,
  createdAt: 0,
})

describe('summarizeByPhase', () => {
  it('keeps models, backends, MTP and incomplete generations out of each other medians', () => {
    const base = metric('summary', 100, 20)
    const summaries = summarizeByPhase([
      {
        ...base,
        metadata: {
          execution: 'foreground',
          devices: ['Metal'],
          speculative: false,
          status: 'complete',
        },
      },
      {
        ...base,
        ttftMs: 999,
        metadata: {
          execution: 'foreground',
          devices: ['Metal'],
          speculative: true,
          status: 'complete',
        },
      },
      {
        ...base,
        ttftMs: 888,
        metadata: {
          execution: 'background-cpu',
          devices: ['CPU'],
          speculative: false,
          status: 'complete',
        },
      },
      {
        ...base,
        ttftMs: 777,
        metadata: {
          execution: 'foreground',
          devices: ['Metal'],
          speculative: false,
          status: 'stopped_limit',
        },
      },
    ])
    expect(summaries).toHaveLength(4)
    expect(
      summaries.map((summary) => summary.medianTtftMs).sort((a, b) => a - b),
    ).toEqual([100, 777, 888, 999])
  })
  it('returns nothing when there are no measurements', () => {
    expect(summarizeByPhase([])).toEqual([])
  })

  it('groups by phase and counts the runs', () => {
    const summaries = summarizeByPhase([
      metric('title', 100, 12),
      metric('summary', 200, 8),
      metric('title', 300, 10),
    ])
    expect(summaries.map((s) => s.phase)).toEqual(['summary', 'title'])
    expect(summaries.find((s) => s.phase === 'title')?.runs).toBe(2)
  })

  it('uses the median, so a single slow first run does not distort the result', () => {
    // The run right after loading the weights is an order of magnitude slower;
    // a mean would report ~4100 ms where the user sees about 300 ms.
    const summary = summarizeByPhase([
      metric('title', 12000, 1),
      metric('title', 300, 14),
      metric('title', 320, 13),
    ])[0]
    expect(summary?.medianTtftMs).toBe(320)
    expect(summary?.medianTokensPerSecond).toBe(13)
  })

  it('averages the two middle values for an even number of runs', () => {
    const summary = summarizeByPhase([
      metric('tags', 100, 10),
      metric('tags', 200, 20),
    ])[0]
    expect(summary?.medianTtftMs).toBe(150)
    expect(summary?.medianTokensPerSecond).toBe(15)
  })

  it('reports the worst case separately instead of hiding it', () => {
    const summary = summarizeByPhase([
      metric('summary', 12000, 1),
      metric('summary', 300, 14),
      metric('summary', 320, 13),
    ])[0]
    expect(summary?.worstTtftMs).toBe(12000)
    expect(summary?.worstTokensPerSecond).toBe(1)
  })
})
