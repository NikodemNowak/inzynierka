import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import type { BenchmarkAudioRun, BenchmarkRun } from './benchmarkTypes'
import { translate } from '../i18n/translate'
import { listGpuDiagnosticReports } from '../processing/gpuDiagnostics'

const directory = (): string => `${FileSystem.documentDirectory}benchmarks/`
export type BenchmarkAssessmentKey = Exclude<keyof BenchmarkRun['assessment'], 'notes'>
export type BenchmarkRunSummary = Pick<BenchmarkRun,
  'id' | 'createdAt' | 'arm' | 'condition' | 'language' | 'wordCount' | 'inputMode' |
  'totalMs' | 'modelLoadMs' | 'processingMs' | 'sttMs' | 'llmMs' | 'prefillMs' |
  'decodeMs' | 'draftTokens' | 'draftTokensAccepted' | 'succeeded' | 'error'> & {
  environment: Pick<BenchmarkRun['environment'], 'deviceLabel' | 'deviceLabelSource' | 'gpu'>
  output: BenchmarkRun['output']
  assessment: BenchmarkRun['assessment']
  audio?: Pick<BenchmarkAudioRun, 'durationMs' | 'locale' | 'sttMs' | 'speechBackend'> & {
    recognizerFallback: boolean
  }
}

// Keep the result list independent of raw prompts, STT callbacks and diagnostics.
// Full evidence remains in its original durable file and is read on demand.
export const projectBenchmarkRun = (run: BenchmarkRun): BenchmarkRunSummary => ({
  id: run.id, createdAt: run.createdAt, arm: run.arm, condition: run.condition,
  language: run.language, wordCount: run.wordCount, inputMode: run.inputMode,
  totalMs: run.totalMs, modelLoadMs: run.modelLoadMs, processingMs: run.processingMs,
  sttMs: run.sttMs, llmMs: run.llmMs, prefillMs: run.prefillMs, decodeMs: run.decodeMs,
  draftTokens: run.draftTokens, draftTokensAccepted: run.draftTokensAccepted,
  succeeded: run.succeeded, error: run.error,
  environment: {
    deviceLabel: run.environment.deviceLabel,
    deviceLabelSource: run.environment.deviceLabelSource,
    gpu: run.environment.gpu,
  },
  output: run.output ? {
    title: run.output.title, summary: run.output.summary,
    tags: [...run.output.tags], tasks: [...run.output.tasks], warnings: [...run.output.warnings],
  } : null,
  assessment: {
    faithfulSummary: run.assessment.faithfulSummary,
    completeTasks: run.assessment.completeTasks,
    acceptableLanguage: run.assessment.acceptableLanguage,
    notes: run.assessment.notes,
  },
  ...(run.audio ? { audio: {
    durationMs: run.audio.durationMs, locale: run.audio.locale, sttMs: run.audio.sttMs,
    speechBackend: run.audio.speechBackend,
    recognizerFallback: run.audio.windows?.some((window) =>
      window.diagnostics?.backend === 'recognizer' || Boolean(window.diagnostics?.fallbackReason)) ?? false,
  } } : {}),
})

// Serialize read/parse/projection, including detail reads and annotation updates.
// A list never retains all raw files or reads the next file before projection.
let reads: Promise<unknown> = Promise.resolve()
const withBenchmarkRun = <T>(
  id: string, use: (run: BenchmarkRun) => T | Promise<T>,
): Promise<T> => {
  if (!/^run-[a-zA-Z0-9-]+$/.test(id)) return Promise.reject(new Error('Invalid benchmark run id'))
  const operation = reads.then(async () => {
    const value: unknown = JSON.parse(await FileSystem.readAsStringAsync(`${directory()}${id}.json`))
    if (typeof value !== 'object' || value === null || !('version' in value) ||
      value.version !== 1 || !('id' in value) || value.id !== id)
      throw new Error('Invalid benchmark run file')
    return use(value as BenchmarkRun)
  })
  reads = operation.then(() => undefined, () => undefined)
  return operation
}

export const loadBenchmarkRun = (id: string): Promise<BenchmarkRun> =>
  withBenchmarkRun(id, (run) => run)

export const listBenchmarkRunSummaries = async (limit = 30): Promise<BenchmarkRunSummary[]> => {
  if (!Number.isInteger(limit) || limit < 0 || limit > 30) throw new Error('Invalid benchmark summary limit')
  if (limit === 0 || !(await FileSystem.getInfoAsync(directory())).exists) return []
  const names = (await FileSystem.readDirectoryAsync(directory())).filter(
    (name) => /^run-[a-zA-Z0-9-]+\.json$/.test(name),
  )
  const results: BenchmarkRunSummary[] = []
  for (const name of names) {
    try {
      const summary = await withBenchmarkRun(name.slice(0, -5), (run) => {
        if (!Number.isFinite(run.createdAt)) throw new Error('Invalid benchmark creation time')
        return projectBenchmarkRun(run)
      })
      results.push(summary)
      results.sort((a, b) => b.createdAt - a.createdAt)
      if (results.length > limit) results.pop()
    } catch {
      /* A corrupt result does not hide other measurements. */
    }
  }
  return results
}

export const updateBenchmarkAssessment = (
  id: string, key: BenchmarkAssessmentKey, value: boolean | null,
): Promise<BenchmarkRunSummary> => withBenchmarkRun(id, async (run) => {
  const next = { ...run, assessment: { ...run.assessment, [key]: value } }
  // Save the complete original, including fields unknown to this JS version.
  await saveBenchmarkRun(next)
  return projectBenchmarkRun(next)
})

export const saveBenchmarkRun = async (run: BenchmarkRun): Promise<void> => {
  if (!/^run-[a-zA-Z0-9-]+$/.test(run.id))
    throw new Error('Invalid benchmark run id')
  await FileSystem.makeDirectoryAsync(directory(), { intermediates: true })
  const path = `${directory()}${run.id}.json`
  const temporary = `${path}.part`
  await FileSystem.writeAsStringAsync(temporary, JSON.stringify(run))
  await FileSystem.moveAsync({ from: temporary, to: path })
}
export const listBenchmarkRuns = async (): Promise<BenchmarkRun[]> => {
  if (!(await FileSystem.getInfoAsync(directory())).exists) return []
  const names = (await FileSystem.readDirectoryAsync(directory())).filter(
    (name) => /^run-[a-zA-Z0-9-]+\.json$/.test(name),
  )
  const results: BenchmarkRun[] = []
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(
        await FileSystem.readAsStringAsync(`${directory()}${name}`),
      )
      if (
        typeof value === 'object' &&
        value !== null &&
        'version' in value &&
        value.version === 1 &&
        'id' in value &&
        typeof value.id === 'string'
      )
        results.push(value as BenchmarkRun)
    } catch {
      /* An interrupted/corrupt result does not hide other measurements. */
    }
  }
  return results.sort((a, b) => b.createdAt - a.createdAt)
}
export const shareBenchmarkRuns = async (): Promise<void> => {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(
      translate('Udostępnianie jest niedostępne.', 'Sharing is unavailable.'),
    )
  const path = `${FileSystem.cacheDirectory}notatki-model-benchmark.json`
  await FileSystem.writeAsStringAsync(
    path,
    JSON.stringify(
      {
        version: 1, exportedAt: Date.now(), runs: await listBenchmarkRuns(),
        gpuDiagnostics: await listGpuDiagnosticReports(),
      },
      null,
      2,
    ),
  )
  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: translate('Eksport pomiarów', 'Export measurements'),
  })
}
