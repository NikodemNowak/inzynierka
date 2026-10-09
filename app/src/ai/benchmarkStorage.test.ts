import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import * as storage from './benchmarkStorage'
import type { BenchmarkRun } from './benchmarkTypes'

const mockFiles = new Map<string, string>()
let mockActiveReads = 0
let mockMaximumReads = 0
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => [...mockFiles.keys()]
    .filter((path) => path.startsWith('file:///documents/benchmarks/'))
    .map((path) => path.slice('file:///documents/benchmarks/'.length))),
  readAsStringAsync: jest.fn(async (path: string) => {
    mockMaximumReads = Math.max(mockMaximumReads, ++mockActiveReads)
    try {
      await Promise.resolve()
      await Promise.resolve()
      const text = mockFiles.get(path)
      if (text === undefined) throw new Error('File missing')
      return text
    } finally { mockActiveReads-- }
  }),
  writeAsStringAsync: jest.fn(async (path: string, text: string) => { mockFiles.set(path, text) }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const text = mockFiles.get(from)
    if (text === undefined) throw new Error('Temporary file missing')
    mockFiles.set(to, text)
    mockFiles.delete(from)
  }),
}))
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined),
}))
jest.mock('../processing/gpuDiagnostics', () => ({ listGpuDiagnosticReports: jest.fn(async () => []) }))
jest.mock('../i18n/translate', () => ({ translate: (_pl: string, en: string) => en }))

const pathFor = (id: string): string => `file:///documents/benchmarks/${id}.json`
const runFixture = (index = 1): BenchmarkRun => ({
  version: 1, pipelineVersion: 'synthetic-test', id: `run-synthetic-${index}`, suiteId: 'suite-synthetic',
  arm: 'qwen3', model: 'Controlled model', revision: 'pinned', modelSha256: 'a'.repeat(64),
  verification: { sha256: 'a'.repeat(64), sizeBytes: 1, architecture: 'qwen3', nextnPredictLayers: 0, verifiedAt: 1 },
  environment: { deviceLabel: 'Controlled device', deviceLabelSource: 'automatic', appMode: 'release', gpu: true },
  condition: 'warm', repeat: 1, language: 'en', source: 'Exact synthetic source.', fixtureId: 'controlled',
  sourceProvenance: 'synthetic-audio', inputMode: 'audio',
  audio: {
    uri: 'file:///audio/controlled.wav', locale: 'en-US', referenceTranscript: 'Synthetic reference.',
    provenance: 'synthetic-audio', speechBackend: 'analyzer-if-installed', requireOnDeviceRecognition: true,
    transcript: 'Exact synthetic source.', durationMs: 60000, sampleRate: 16000, channels: 1,
    sttMs: 17, status: 'complete', windows: [{ requestId: 'request-synthetic', startMs: 0, durationMs: 60000,
      diagnostics: { version: 1, requestedStartMs: 0, requestedDurationMs: 60000, decodedFrames: 960000,
        decodedDurationMs: 60000, decodedSampleRate: 16000, callbackCount: 1, finalCallbackCount: 1,
        finalLikeCallbackCount: 1, mergedSegmentCount: 1, untimedCallbackCount: 0, callbacksTruncated: false,
        backend: 'recognizer', callbacks: [{ index: 1, isFinal: true, finalLike: true, text: 'Raw callback.', segmentCount: 1 }] } }],
  },
  nominalMinutes: 1, wordCount: 3, requestedAt: index, createdAt: index, queueMs: 2, suiteVerificationMs: 3,
  modelLoadMs: 0, processingMs: 31, sttMs: 17, sttRecognitionMs: 15, sttQualityMs: 2, llmMs: 31,
  persistMs: 4, totalMs: 52, timingBoundary: 'request-to-first-durable-benchmark-result',
  prefillMs: 20, decodeMs: 11, draftTokens: null, draftTokensAccepted: null,
  generations: [{ outputText: 'Raw model output.', phase: 'title', inputChars: 23, ttftMs: 4, wallMs: 31,
    promptMs: 20, predictedMs: 11, promptTokens: 9, predictedTokens: 3, formattedPromptTokens: 9,
    draftTokens: null, draftTokensAccepted: null, completion: null }],
  output: { title: 'Controlled title', summary: 'Literal summary.', tags: ['work'], tasks: ['Actual commitment.'], warnings: ['Review this.'] },
  succeeded: false, error: null,
  assessment: { faithfulSummary: null, completeTasks: false, acceptableLanguage: true, notes: 'Keep this annotation.' },
})
const put = (run: BenchmarkRun): string => {
  const text = JSON.stringify(run)
  mockFiles.set(pathFor(run.id), text)
  return text
}
beforeEach(() => {
  jest.clearAllMocks()
  mockFiles.clear()
  mockActiveReads = 0
  mockMaximumReads = 0
})

test('lists at most thirty compact recent runs without changing durable raw reports', async () => {
  for (let index = 1; index <= 43; index++) put(runFixture(index))
  const before = [...mockFiles]
  const summaries = await storage.listBenchmarkRunSummaries?.()
  expect(summaries).toHaveLength(30)
  expect(summaries?.map((run) => run.id)).toEqual(Array.from({ length: 30 }, (_, index) => `run-synthetic-${43 - index}`))
  expect([...mockFiles]).toEqual(before)
  expect(mockMaximumReads).toBe(1)
})

test('projects display output and timings while dropping large source, callback, generation and future payloads', async () => {
  const run = runFixture()
  const largeText = 'controlled payload '.repeat(40000)
  run.source = largeText
  run.audio!.transcript = largeText
  run.audio!.referenceTranscript = largeText
  run.audio!.windows![0].diagnostics!.callbacks![0].text = largeText
  run.generations[0].outputText = largeText
  const raw = { ...run, futureDiagnostics: { payload: largeText } }
  mockFiles.set(pathFor(run.id), JSON.stringify(raw))
  const summaries = await storage.listBenchmarkRunSummaries?.()
  expect(summaries).toEqual([expect.objectContaining({
    id: 'run-synthetic-1', condition: 'warm', wordCount: 3, totalMs: 52, modelLoadMs: 0,
    sttMs: 17, llmMs: 31, processingMs: 31, prefillMs: 20, decodeMs: 11,
    output: { title: 'Controlled title', summary: 'Literal summary.', tags: ['work'], tasks: ['Actual commitment.'], warnings: ['Review this.'] },
    audio: { durationMs: 60000, locale: 'en-US', sttMs: 17, speechBackend: 'analyzer-if-installed', recognizerFallback: true },
  })])
  expect(JSON.stringify(summaries).length).toBeLessThan(4000)
  expect(JSON.stringify(summaries)).not.toContain('controlled payload')
  expect(mockFiles.get(pathFor(run.id))).toBe(JSON.stringify(raw))
})

test('keeps summary reads sequential even when an on-demand full read overlaps', async () => {
  put(runFixture(1)); put(runFixture(2)); put(runFixture(3))
  const [summaries, detail] = await Promise.all([
    storage.listBenchmarkRunSummaries?.(), storage.loadBenchmarkRun?.('run-synthetic-2'),
  ])
  expect(summaries).toHaveLength(3)
  expect(detail).toEqual(runFixture(2))
  expect(mockMaximumReads).toBe(1)
})

test('skips corrupt, unrelated and mismatched-ID files without hiding valid summaries', async () => {
  put(runFixture(4))
  mockFiles.set(pathFor('run-corrupt'), '{invalid')
  mockFiles.set(pathFor('run-wrong'), JSON.stringify(runFixture(5)))
  mockFiles.set('file:///documents/benchmarks/unrelated.json', JSON.stringify(runFixture(6)))
  mockFiles.set(pathFor('run-incomplete'), JSON.stringify({ version: 1, id: 'run-incomplete' }))
  expect(await storage.listBenchmarkRunSummaries?.()).toEqual([expect.objectContaining({ id: 'run-synthetic-4' })])
})

test('full detail retrieves every durable field and rejects unsafe identifiers before file access', async () => {
  const run = runFixture()
  const raw = { ...run, futureDiagnostics: { keep: ['entire', 'payload'] } }
  mockFiles.set(pathFor(run.id), JSON.stringify(raw))
  expect(await storage.loadBenchmarkRun?.(run.id)).toEqual(raw)
  const calls = jest.mocked(FileSystem.readAsStringAsync).mock.calls.length
  await expect(storage.loadBenchmarkRun?.('../run-other')).rejects.toThrow(/id/i)
  expect(jest.mocked(FileSystem.readAsStringAsync).mock.calls).toHaveLength(calls)
})

test('assessment updates preserve raw callbacks, sources, generations, unknown fields and other annotations', async () => {
  const run = runFixture()
  const raw = { ...run, futureDiagnostics: { keep: ['entire', 'payload'] } }
  mockFiles.set(pathFor(run.id), JSON.stringify(raw))
  const summary = await storage.updateBenchmarkAssessment?.(run.id, 'faithfulSummary', true)
  expect(summary?.assessment).toEqual({ faithfulSummary: true, completeTasks: false, acceptableLanguage: true, notes: 'Keep this annotation.' })
  expect(JSON.parse(mockFiles.get(pathFor(run.id))!)).toEqual({
    ...raw, assessment: { faithfulSummary: true, completeTasks: false, acceptableLanguage: true, notes: 'Keep this annotation.' },
  })
  expect(summary).not.toHaveProperty('source')
  expect(summary?.audio).not.toHaveProperty('windows')
})

test('concurrent assessments preserve both independent field updates', async () => {
  put(runFixture())
  await Promise.all([
    storage.updateBenchmarkAssessment?.('run-synthetic-1', 'faithfulSummary', true),
    storage.updateBenchmarkAssessment?.('run-synthetic-1', 'completeTasks', true),
  ])
  expect(JSON.parse(mockFiles.get(pathFor('run-synthetic-1'))!).assessment).toEqual({
    faithfulSummary: true, completeTasks: true, acceptableLanguage: true, notes: 'Keep this annotation.',
  })
})

test('existing full list and export retain complete raw records', async () => {
  const run = runFixture()
  const raw = { ...run, futureDiagnostics: { keep: ['entire', 'payload'] } }
  mockFiles.set(pathFor(run.id), JSON.stringify(raw))
  expect(await storage.listBenchmarkRuns()).toEqual([raw])
  await storage.shareBenchmarkRuns()
  expect(JSON.parse(mockFiles.get('file:///cache/notatki-model-benchmark.json')!).runs).toEqual([raw])
  expect(Sharing.shareAsync).toHaveBeenCalled()
})

test('keeps equal-timestamp order identical to the existing full list and bounds custom limits', async () => {
  for (const index of [3, 1, 2]) put({ ...runFixture(index), createdAt: 9 })
  const full = await storage.listBenchmarkRuns()
  expect((await storage.listBenchmarkRunSummaries(2)).map((run) => run.id))
    .toEqual(full.slice(0, 2).map((run) => run.id))
  const calls = jest.mocked(FileSystem.readAsStringAsync).mock.calls.length
  expect(await storage.listBenchmarkRunSummaries(0)).toEqual([])
  await expect(storage.listBenchmarkRunSummaries(31)).rejects.toThrow(/limit/i)
  expect(jest.mocked(FileSystem.readAsStringAsync).mock.calls).toHaveLength(calls)
})

test('failed annotation writes preserve the original raw file and do not poison subsequent reads', async () => {
  const run = runFixture()
  const original = put(run)
  jest.mocked(FileSystem.moveAsync).mockRejectedValueOnce(new Error('Controlled disk failure'))
  await expect(storage.updateBenchmarkAssessment(run.id, 'completeTasks', true)).rejects.toThrow('Controlled disk failure')
  expect(mockFiles.get(pathFor(run.id))).toBe(original)
  expect(await storage.loadBenchmarkRun(run.id)).toEqual(run)
  expect((await storage.listBenchmarkRunSummaries()).map((item) => item.id)).toEqual([run.id])
})

test('projection owns its mutable display arrays and never edits a full loaded report', () => {
  const run = runFixture()
  const original = JSON.stringify(run)
  const summary = storage.projectBenchmarkRun(run)
  summary.output!.tasks.push('An independent display change.')
  summary.output!.warnings.length = 0
  summary.assessment.completeTasks = true
  expect(JSON.stringify(run)).toBe(original)
})

test('compact assessment excludes future nested payloads while full annotation writes preserve them', async () => {
  const run = runFixture()
  const raw = { ...run, assessment: { ...run.assessment, futureData: { payload: 'Controlled large annotation. '.repeat(20000) } } }
  mockFiles.set(pathFor(run.id), JSON.stringify(raw))
  const summaries = await storage.listBenchmarkRunSummaries()
  expect(Object.keys(summaries[0].assessment)).toEqual([
    'faithfulSummary', 'completeTasks', 'acceptableLanguage', 'notes',
  ])
  expect(summaries[0].assessment).toEqual({
    faithfulSummary: null, completeTasks: false, acceptableLanguage: true, notes: 'Keep this annotation.',
  })
  expect(JSON.stringify(summaries).length).toBeLessThan(4000)
  await storage.updateBenchmarkAssessment(run.id, 'completeTasks', true)
  expect(JSON.parse(mockFiles.get(pathFor(run.id))!).assessment).toEqual({ ...raw.assessment, completeTasks: true })
})
