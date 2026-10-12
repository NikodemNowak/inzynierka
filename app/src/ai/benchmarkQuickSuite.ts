import { runBenchmarkSuite } from './benchmarkService'
import type { BenchmarkRun } from './benchmarkTypes'
import { QUICK_SUITE_TEXTS } from './benchmarkQuickTexts'

export { QUICK_SUITE_TEXTS }

export interface QuickSuiteOptions {
  deviceLabel?: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onResult?: (run: BenchmarkRun) => void
}

// One cold run per text on the default Qwen3 arm; each run keeps the per-phase
// timings and the backend init log in its saved JSON.
export const runQuickSuite = async (
  options: QuickSuiteOptions,
): Promise<BenchmarkRun[]> => {
  const runs: BenchmarkRun[] = []
  for (const [index, text] of QUICK_SUITE_TEXTS.entries()) {
    const label = `${index + 1}/${QUICK_SUITE_TEXTS.length} · ${text.words}`
    runs.push(
      ...(await runBenchmarkSuite({
        arms: ['qwen3'],
        warmRepeats: 0,
        language: 'pl',
        source: text.source,
        inputMode: 'text',
        fixtureId: text.id,
        sourceProvenance: 'user-text',
        nominalMinutes: null,
        deviceLabel: options.deviceLabel,
        execution: 'foreground',
        signal: options.signal,
        onProgress: (message) => options.onProgress?.(`${label} · ${message}`),
        onResult: options.onResult,
      })),
    )
  }
  return runs
}
