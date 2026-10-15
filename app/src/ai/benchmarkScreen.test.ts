import { createElement } from 'react'
import * as ReactHooks from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Button } from 'react-native'
import BenchmarkScreen, { projectSpeechWindowBenchmarkReport } from '../app/dev/benchmark'
import { runBenchmarkSuite } from './benchmarkService'
import { runSpeechWindowBenchmarkSuite, shareSpeechWindowBenchmarks } from '../stt/speechWindowBenchmark'
import { prepareEnglishBenchmarkAudioFixture } from './benchmarkFixtures'
import { captureGpuDiagnosticReport, type GpuDiagnosticReport } from '../processing/gpuDiagnostics'
import {
  listBenchmarkRunSummaries, loadBenchmarkRun, projectBenchmarkRun,
  updateBenchmarkAssessment,
} from './benchmarkStorage'
import type { BenchmarkRun } from './benchmarkTypes'
import type { SpeechWindowBenchmarkReport } from '../stt/speechWindowBenchmark'

const speechReportFixture = (): SpeechWindowBenchmarkReport => {
  const payload = 'Controlled raw speech payload. '.repeat(2000)
  const durations = [30000, 55000, 60000, 60000, 55000, 30000] as const
  const rates = [0.125, 0, 0.04, null, 0.5, undefined] as const
  return {
    version: 1, kind: 'stt-window-ab-v1', id: 'stt-controlled-preview', createdAt: 1, status: 'complete',
    fixtureId: 'controlled', deviceLabel: 'Controlled device',
    environment: { platform: 'ios', osVersion: '27.0', nativeAppVersion: '1', nativeBuildVersion: '7', execution: 'foreground' },
    requireOnDeviceRecognition: true, fixture: { uri: 'file:///controlled.wav', locale: 'en-US',
      referenceTranscript: payload, provenance: 'synthetic-audio' },
    sourceIdentity: null, audio: null, capabilities: null, nativeReadinessDiagnostics: 'not-reported',
    order: durations, resumed: false, comparisons: [],
    futureReportPayload: { payload },
    arms: durations.map((windowDurationMs, index) => ({
      id: `controlled-arm-${index}`, pass: index < 3 ? 1 : 2, orderIndex: index, windowDurationMs,
      requestedBackend: 'recognizer', status: 'complete', startedAt: 1, wallMs: 12500,
      nativeRequestWallMs: 12500, windowReceiptWriteMs: 10, qualityMs: 20,
      nativeRecognitionMs: 12000, nativeDecodeMs: 200, nativeSetupMs: 100,
      completedDurationMs: 60000, transcript: payload,
      futureArmPayload: { payload },
      windows: [{ index: 0, requestId: `controlled-request-${index}`, startMs: 0, durationMs: 30000,
        status: 'complete', transcript: payload, wallMs: 1000,
        diagnostics: { version: 1, requestedStartMs: 0, requestedDurationMs: 30000,
          decodedFrames: 480000, decodedDurationMs: 30000, decodedSampleRate: 16000,
          callbackCount: 1, finalCallbackCount: 1, finalLikeCallbackCount: 1, mergedSegmentCount: 1,
          untimedCallbackCount: 0, callbacksTruncated: false,
          callbacks: [{ index: 1, isFinal: true, finalLike: true, text: payload, segmentCount: 1 }] } }],
      quality: rates[index] === undefined ? undefined : {
        method: 'synthetic-reference-word-error-v1', rawReferenceWords: 8, rawTranscriptWords: 7,
        normalizedReferenceWords: 8, normalizedTranscriptWords: 7, substitutions: 1, deletions: 0,
        insertions: 0, wordErrorRate: rates[index]!, wordRatio: 0.875, maximumWordErrorRate: 0.15,
        minimumWordRatio: 0.8, reviewRequired: true, futureQualityPayload: { payload },
      },
    })),
  } as SpeechWindowBenchmarkReport
}

test('STT preview keeps only displayed fields and detaches every raw report level', () => {
  const full = speechReportFixture()
  const original = JSON.stringify(full)
  const preview = projectSpeechWindowBenchmarkReport?.(full)
  expect(preview).toBeDefined()
  expect(Object.keys(preview!)).toEqual(['id', 'status', 'nativeReadinessDiagnostics', 'arms'])
  expect(preview!.id).toBe('stt-controlled-preview')
  expect(preview!.status).toBe('complete')
  expect(preview!.nativeReadinessDiagnostics).toBe('not-reported')
  expect(preview!.arms).toHaveLength(6)
  expect(Object.keys(preview!.arms[0])).toEqual(['pass', 'windowDurationMs', 'nativeRequestWallMs', 'status', 'quality'])
  expect(Object.keys(preview!.arms[0].quality!)).toEqual(['wordErrorRate'])
  expect(preview!.arms.map((arm) => arm.quality?.wordErrorRate)).toEqual([0.125, 0, 0.04, null, 0.5, undefined])
  expect(preview!.arms).not.toBe(full.arms)
  expect(preview!.arms[0]).not.toBe(full.arms[0])
  expect(preview!.arms[0].quality).not.toBe(full.arms[0].quality)
  expect(JSON.stringify(preview).length).toBeLessThan(2000)
  expect(JSON.stringify(preview)).not.toContain('Controlled raw speech payload')
  expect(JSON.stringify(full)).toBe(original)
})

test('real STT onResult publishes a compact preview and preserves all six visible metrics', async () => {
  const full = speechReportFixture()
  const original = JSON.stringify(full)
  const published: unknown[] = []
  const react = jest.requireActual<typeof import('react')>('react')
  const realUseState = react.useState
  const state = jest.spyOn(react, 'useState').mockImplementation(((initial: unknown) => {
    const [value, publish] = realUseState(initial)
    return [value, (next: unknown) => {
      if (typeof next === 'object' && next !== null && 'id' in next && next.id === full.id)
        published.push(next)
      publish(next)
    }]
  }) as typeof ReactHooks.useState)
  jest.mocked(runSpeechWindowBenchmarkSuite).mockImplementationOnce(async (options) => {
    options.onResult?.(full)
    return full
  })
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
    const start = buttonNamed(renderer, 'Porównaj samo STT: 30 / 55 / 60 s')
    expect(start).toBeDefined()
    await act(async () => { start?.props.onPress() })
    expect(runSpeechWindowBenchmarkSuite).toHaveBeenCalledTimes(1)
    expect(published).toHaveLength(1)
    expect(Object.keys(published[0] as object)).toEqual(['id', 'status', 'nativeReadinessDiagnostics', 'arms'])
    const preview = published[0] as ReturnType<typeof projectSpeechWindowBenchmarkReport>
    expect(preview.arms).not.toBe(full.arms)
    for (const [index, arm] of preview.arms.entries()) {
      expect(Object.keys(arm)).toEqual(['pass', 'windowDurationMs', 'nativeRequestWallMs', 'status', 'quality'])
      expect(arm).not.toBe(full.arms[index])
      if (arm.quality) {
        expect(Object.keys(arm.quality)).toEqual(['wordErrorRate'])
        expect(arm.quality).not.toBe(full.arms[index].quality)
      }
    }
    expect(JSON.stringify(published).length).toBeLessThan(2000)
    expect(JSON.stringify(published)).not.toContain('Controlled raw speech payload')
    for (const text of ['complete', '6', 'stt-controlled-preview',
      '1/30s: 12.50s · WER 12.50%', '1/55s: 12.50s · WER 0.00%', '1/60s: 12.50s · WER 4.00%',
      '2/60s: 12.50s · WER —', '2/55s: 12.50s · WER 50.00%', '2/30s: 12.50s · WER —',
      'Ten build nie raportuje szczegółowych statusów zasobów Analyzer.'])
      expect(hasRenderedText(renderer, text)).toBe(true)
    expect(JSON.stringify(full)).toBe(original)
    expect(buttonNamed(renderer, 'Eksport pomiarów STT')).toBeDefined()
    expect(buttonNamed(renderer, 'Eksportuj wszystkie wyniki i źródła')).toBeDefined()
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    state.mockRestore()
  }
})

const screenRun = (index = 1): BenchmarkRun => ({
  version: 1, id: `run-screen-${index}`, suiteId: 'suite-screen', arm: 'qwen3', model: 'Controlled',
  revision: 'pinned', modelSha256: 'a'.repeat(64), verification: { sha256: 'a'.repeat(64), sizeBytes: 1,
    architecture: 'qwen3', nextnPredictLayers: 0, verifiedAt: 1 },
  environment: { deviceLabel: 'Controlled device', deviceLabelSource: 'automatic', appMode: 'release', gpu: true },
  condition: 'warm', repeat: 1, language: 'en', source: 'Exact retained source.', fixtureId: 'controlled',
  sourceProvenance: 'synthetic-audio', inputMode: 'audio', audio: { uri: 'file:///synthetic.wav', locale: 'en-US',
    referenceTranscript: `Full reference ${index}`, transcript: `Full transcript ${index}`,
    provenance: 'synthetic-audio', requireOnDeviceRecognition: true, durationMs: 60000,
    sampleRate: 16000, channels: 1, sttMs: 17000, status: 'complete' },
  nominalMinutes: 1, wordCount: 3, requestedAt: index, createdAt: index, queueMs: 0, suiteVerificationMs: 0,
  modelLoadMs: 0, processingMs: 31000, sttMs: 17000, llmMs: 31000, persistMs: 4, totalMs: 52000,
  timingBoundary: 'request-to-first-durable-benchmark-result', prefillMs: 20000, decodeMs: 11000,
  draftTokens: null, draftTokensAccepted: null, generations: [], succeeded: false, error: null,
  output: { title: `Controlled title ${index}`, summary: 'Literal summary.', tags: [], tasks: ['Actual commitment.'], warnings: ['Check source.'] },
  assessment: { faithfulSummary: null, completeTasks: null, acceptableLanguage: null, notes: '' },
})
const hasRenderedText = (renderer: ReactTestRenderer, text: string): boolean =>
  JSON.stringify(renderer.toJSON()).includes(text)
const buttonNamed = (renderer: ReactTestRenderer, title: string) =>
  renderer.root.findAllByType(Button).find((button) => button.props.title === title)
const detailsButtons = (renderer: ReactTestRenderer) => renderer.root.findAllByType(Button)
  .filter((button) => button.props.title === 'Pokaż źródła')

test('renders compact result metrics and loads full audio texts only on demand', async () => {
  const run = screenRun()
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(run)])
  jest.mocked(loadBenchmarkRun).mockResolvedValue(run)
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    expect(hasRenderedText(renderer, 'Controlled title 1')).toBe(true)
    expect(hasRenderedText(renderer, 'Literal summary.')).toBe(true)
    expect(hasRenderedText(renderer, 'Actual commitment.')).toBe(true)
    expect(hasRenderedText(renderer, '52.00')).toBe(true)
    expect(hasRenderedText(renderer, '17.00')).toBe(true)
    expect(hasRenderedText(renderer, '31.00')).toBe(true)
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
    expect(hasRenderedText(renderer, 'Full reference')).toBe(false)
    expect(loadBenchmarkRun).not.toHaveBeenCalled()
    expect(detailsButtons(renderer)).toHaveLength(1)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    expect(hasRenderedText(renderer, 'Full transcript 1')).toBe(true)
    expect(hasRenderedText(renderer, 'Full reference 1')).toBe(true)
    expect(loadBenchmarkRun).toHaveBeenCalledWith('run-screen-1')
    await act(async () => { buttonNamed(renderer, 'Ukryj źródła')?.props.onPress() })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
  } finally { await act(async () => { renderer.unmount() }) }
})

test('publishes a compact new result and preserves the existing all-results export button', async () => {
  const run = screenRun()
  jest.mocked(runBenchmarkSuite).mockImplementationOnce(async (options) => {
    options.onResult?.(run)
    jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(run)])
    return [run]
  })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    await act(async () => { buttonNamed(renderer, 'Uruchom test audio po angielsku')?.props.onPress() })
    expect(hasRenderedText(renderer, 'Controlled title 1')).toBe(true)
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
    expect(detailsButtons(renderer)).toHaveLength(1)
    expect(buttonNamed(renderer, 'Eksportuj wszystkie wyniki i źródła')).toBeDefined()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('saves manual assessment through full-file update rather than overwriting a projected result', async () => {
  const run = screenRun()
  const summary = projectBenchmarkRun(run)
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([summary])
  jest.mocked(updateBenchmarkAssessment).mockImplementation(async () => {
    const updated = { ...summary, assessment: { ...summary.assessment, faithfulSummary: true } }
    jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([updated])
    return updated
  })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const assess = renderer.root.findAllByType(Button).find((button) => button.props.title === 'Wierność podsumowania: —')
    expect(assess).toBeDefined()
    await act(async () => { assess?.props.onPress() })
    expect(updateBenchmarkAssessment).toHaveBeenCalledWith('run-screen-1', 'faithfulSummary', true)
    expect(buttonNamed(renderer, 'Wierność podsumowania: Tak')).toBeDefined()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('ignores a late full detail after selection changes and displays a detail failure', async () => {
  let resolveFirst!: (run: BenchmarkRun) => void
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(screenRun(2)), projectBenchmarkRun(screenRun(1))])
  jest.mocked(loadBenchmarkRun).mockImplementation((id) => id === 'run-screen-2'
    ? new Promise((resolve) => { resolveFirst = resolve }) : Promise.reject(new Error('Controlled detail failure')))
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    expect(detailsButtons(renderer)).toHaveLength(2)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    await act(async () => { resolveFirst(screenRun(2)) })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
    expect(hasRenderedText(renderer, 'Controlled detail failure')).toBe(true)
  } finally { await act(async () => { renderer.unmount() }) }
})

test('ignores a late full detail after a new benchmark begins', async () => {
  let resolveDetail!: (run: BenchmarkRun) => void
  let resolveSuite!: (runs: BenchmarkRun[]) => void
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(screenRun())])
  jest.mocked(loadBenchmarkRun).mockImplementation(() => new Promise((resolve) => { resolveDetail = resolve }))
  jest.mocked(runBenchmarkSuite).mockImplementationOnce(() => new Promise((resolve) => { resolveSuite = resolve }))
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    expect(detailsButtons(renderer)).toHaveLength(1)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    await act(async () => { buttonNamed(renderer, 'Uruchom test audio po angielsku')?.props.onPress() })
    await act(async () => { resolveDetail(screenRun()) })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
    await act(async () => { resolveSuite([]) })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
  } finally { await act(async () => { renderer.unmount() }) }
})

test('ignores a pending detail after it is hidden or the audio selection changes', async () => {
  let resolveDetail!: (run: BenchmarkRun) => void
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(screenRun())])
  jest.mocked(loadBenchmarkRun).mockImplementation(() => new Promise((resolve) => { resolveDetail = resolve }))
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    await act(async () => { buttonNamed(renderer, 'Ukryj źródła')?.props.onPress() })
    await act(async () => { resolveDetail(screenRun()) })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    const chooseTen = renderer.root.findAllByType(Button).find((button) => button.props.title === 'Nagranie 10 min')
    expect(chooseTen).toBeDefined()
    await act(async () => { chooseTen?.props.onPress() })
    await act(async () => { resolveDetail(screenRun()) })
    expect(hasRenderedText(renderer, 'Full transcript')).toBe(false)
  } finally { await act(async () => { renderer.unmount() }) }
})

test('retrieves a complete text source on demand without starting a benchmark', async () => {
  const run = { ...screenRun(), inputMode: 'text' as const, audio: undefined }
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(run)])
  jest.mocked(loadBenchmarkRun).mockResolvedValue(run)
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    expect(hasRenderedText(renderer, 'Exact retained source.')).toBe(false)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    expect(hasRenderedText(renderer, 'Exact retained source.')).toBe(true)
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('does not publish a full detail payload into a disposed screen', async () => {
  const run = screenRun()
  let resolveDetail!: (run: BenchmarkRun) => void
  let disposed = false
  const latePayloads: unknown[] = []
  const realUseState = ReactHooks.useState
  // Run real React state hooks; observe the screen's publication boundary.
  // Removing its mounted/epoch guard would dispatch this raw payload late.
  const state = jest.spyOn(ReactHooks, 'useState').mockImplementation(((initial: unknown) => {
    const [value, publish] = realUseState(initial)
    return [value, (next: unknown) => {
      if (disposed && typeof next === 'object' && next !== null && 'id' in next && next.id === run.id)
        latePayloads.push(next)
      publish(next)
    }]
  }) as typeof ReactHooks.useState)
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([projectBenchmarkRun(run)])
  jest.mocked(loadBenchmarkRun).mockImplementation(() => new Promise((resolve) => { resolveDetail = resolve }))
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
    expect(detailsButtons(renderer)).toHaveLength(1)
    await act(async () => { detailsButtons(renderer)[0].props.onPress() })
    await act(async () => { renderer.unmount(); disposed = true })
    await act(async () => { resolveDetail(run) })
    expect(latePayloads).toEqual([])
  } finally { state.mockRestore() }
})

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }))
jest.mock('../i18n/useI18n', () => ({
  useI18n: () => ({ language: 'pl', t: (pl: string) => pl }),
}))
jest.mock('../ui/theme', () => ({ useTheme: () => ({ colors: {} }) }))
jest.mock('./benchmarkModels', () => ({
  isBenchmarkModelPresent: jest.fn(async () => true),
  downloadBenchmarkModel: jest.fn(),
  deleteBenchmarkModel: jest.fn(),
}))
jest.mock('./benchmarkStorage', () => ({
  listBenchmarkRuns: jest.fn(async () => []),
  listBenchmarkRunSummaries: jest.fn(async () => []),
  loadBenchmarkRun: jest.fn(),
  projectBenchmarkRun: jest.requireActual<typeof import('./benchmarkStorage')>('./benchmarkStorage').projectBenchmarkRun,
  updateBenchmarkAssessment: jest.fn(),
  saveBenchmarkRun: jest.fn(),
  shareBenchmarkRuns: jest.fn(),
}))
jest.mock('../stt/speechWindowBenchmark', () => ({
  runSpeechWindowBenchmarkSuite: jest.fn(async () => ({ status: 'complete', arms: [], id: 'stt-suite-screen' })),
  shareSpeechWindowBenchmarks: jest.fn(async () => undefined),
}))
jest.mock('./benchmarkService', () => ({
  runBenchmarkSuite: jest.fn(async () => []),
}))
jest.mock('../processing/gpuDiagnostics', () => ({
  captureGpuDiagnosticReport: jest.fn(async (trigger: string) => ({
    version: 1, id: 'gpu-screen', trigger, createdAt: 1,
    evaluation: 'unsupported', capabilities: { gpu: false, osVersion: '27.0', appBuild: '6' },
  })),
  shareGpuDiagnosticReports: jest.fn(),
}))
jest.mock('./benchmarkFixtures', () => ({
  BENCHMARK_AUDIO_FIXTURES: [3, 10, 30].map((minutes) => ({
    id: `en-audio-${minutes}min-v1`,
    filename: `english-${minutes}min.wav`,
    nominalMinutes: minutes,
    durationMs: minutes * 60000,
    sha256: 'a'.repeat(64),
    referenceTranscript: 'Known synthetic speech reference.',
  })),
  makeBenchmarkFixture: (id: string, language: string) => ({
    id,
    language,
    source: 'Notes from a synthetic workshop.',
    provenance: 'synthetic-text',
    nominalMinutes: id === 'smoke' ? null : Number.parseInt(id, 10),
  }),
  makeEnglishBenchmarkAudioFixture: () => ({
    uri: 'file:///documents/TestAudio/benchmark-en-smoke-v6.wav',
    locale: 'en-US',
    provenance: 'synthetic-audio',
    referenceTranscript: 'Old smoke reference.',
  }),
  prepareEnglishBenchmarkAudioFixture: jest.fn(async (id: string) => ({
    uri: `file:///bundle/${id}.wav`,
    locale: 'en-US',
    provenance: 'synthetic-audio',
    referenceTranscript: 'Known synthetic speech reference.',
    bundled: true,
  })),
}))
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///documents/' } },
  File: class {
    uri: string
    constructor(base: { uri: string }, ...parts: string[]) {
      this.uri = `${base.uri}${parts.join('/')}`
    }
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(listBenchmarkRunSummaries).mockResolvedValue([])
  jest.mocked(loadBenchmarkRun).mockReset()
  jest.mocked(updateBenchmarkAssessment).mockReset()
  jest.mocked(prepareEnglishBenchmarkAudioFixture).mockImplementation(async (id) => ({
    uri: `file:///bundle/${id}.wav`,
    locale: 'en-US',
    provenance: 'synthetic-audio',
    referenceTranscript: 'Known synthetic speech reference.',
    bundled: true,
  }))
})

test('starts bundled three-minute English audio cold and warm with one click and no required conditions', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(BenchmarkScreen))
  })
  try {
    const start = renderer.root
      .findAllByType(Button)
      .find(
        (button) => button.props.title === 'Uruchom test audio po angielsku',
      )
    expect(start).toBeDefined()
    expect(start?.props.disabled).toBe(false)
    await act(async () => {
      start?.props.onPress()
    })
    expect(runBenchmarkSuite).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMode: 'audio',
        arms: ['qwen3'],
        warmRepeats: 1,
        language: 'en',
        deviceLabel: '',
        source: '',
        fixtureId: 'en-audio-3min-v1',
        nominalMinutes: 3,
        audioFixture: expect.objectContaining({
          uri: 'file:///bundle/en-audio-3min-v1.wav',
          locale: 'en-US',
          provenance: 'synthetic-audio',
          bundled: true,
        }),
      }),
    )
  } finally {
    await act(async () => {
      renderer.unmount()
    })
  }
})

test.each([10, 30])('runs the selected %i-minute bundled audio without opening a file picker', async (minutes) => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(BenchmarkScreen))
  })
  try {
    const choice = renderer.root.findAllByType(Button).find((button) =>
      button.props.title.replace(/^●\s*/, '') === `Nagranie ${minutes} min`,
    )
    expect(choice).toBeDefined()
    await act(async () => { choice?.props.onPress() })
    const start = renderer.root.findAllByType(Button).find((button) =>
      button.props.title === 'Uruchom test audio po angielsku',
    )
    await act(async () => { start?.props.onPress() })
    expect(prepareEnglishBenchmarkAudioFixture).toHaveBeenCalledWith(
      `en-audio-${minutes}min-v1`, expect.any(AbortSignal),
    )
    expect(runBenchmarkSuite).toHaveBeenCalledWith(expect.objectContaining({
      fixtureId: `en-audio-${minutes}min-v1`, nominalMinutes: minutes,
      inputMode: 'audio', source: '', language: 'en', arms: ['qwen3'],
      warmRepeats: 1, execution: 'foreground',
      audioFixture: expect.objectContaining({ uri: `file:///bundle/en-audio-${minutes}min-v1.wav` }),
    }))
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('shows bundled-audio preparation failure without starting a text or fake audio run', async () => {
  jest.mocked(prepareEnglishBenchmarkAudioFixture).mockRejectedValueOnce(new Error('Bundled audio is missing'))
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const start = renderer.root.findAllByType(Button).find((button) =>
      button.props.title === 'Uruchom test audio po angielsku',
    )
    await act(async () => { start?.props.onPress() })
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('Bundled audio is missing')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('keeps duration controls disabled and prevents duplicate starts while audio is preparing', async () => {
  let finish!: () => void
  jest.mocked(prepareEnglishBenchmarkAudioFixture).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { finish = resolve })
    return { uri: 'file:///bundle/en-audio-3min-v1.wav', locale: 'en-US', provenance: 'synthetic-audio', referenceTranscript: 'Known speech.', bundled: true }
  })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const start = renderer.root.findAllByType(Button).find((button) =>
      button.props.title === 'Uruchom test audio po angielsku',
    )
    await act(async () => { start?.props.onPress() })
    for (const button of renderer.root.findAllByType(Button).filter((button) =>
      button.props.title.includes('Nagranie '),
    )) expect(button.props.disabled).toBe(true)
    await act(async () => { start?.props.onPress() })
    expect(prepareEnglishBenchmarkAudioFixture).toHaveBeenCalledTimes(1)
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
    await act(async () => { finish() })
    expect(runBenchmarkSuite).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('keeps the existing text comparison independent from bundled audio selection', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const textMode = renderer.root.findAllByType(Button).find((button) =>
      button.props.title === 'Porównanie modeli na tekście',
    )
    await act(async () => { textMode?.props.onPress() })
    const start = renderer.root.findAllByType(Button).find((button) =>
      button.props.title === 'Uruchom wybrane warianty',
    )
    await act(async () => { start?.props.onPress() })
    expect(prepareEnglishBenchmarkAudioFixture).not.toHaveBeenCalled()
    expect(runBenchmarkSuite).toHaveBeenCalledWith(expect.objectContaining({
      inputMode: 'text', audioFixture: undefined, fixtureId: 'smoke',
      source: 'Notes from a synthetic workshop.', language: 'pl', nominalMinutes: null,
    }))
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('automatically saves a GPU capability diagnostic before any model run', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    expect(captureGpuDiagnosticReport).toHaveBeenCalledWith('automatic')
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('nie udostępniają GPU w tle')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('a user can save a fresh GPU capability observation without loading the model', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const button = renderer.root.findAllByType(Button).find((item) => item.props.title === 'Sprawdź GPU w tle')
    expect(button).toBeDefined()
    await act(async () => { button?.props.onPress() })
    expect(captureGpuDiagnosticReport).toHaveBeenLastCalledWith('user')
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test('keeps a newer manual GPU observation when the automatic capture finishes later', async () => {
  let finishAutomatic!: (report: GpuDiagnosticReport) => void
  jest.mocked(captureGpuDiagnosticReport).mockImplementationOnce(() =>
    new Promise<GpuDiagnosticReport>((resolve) => { finishAutomatic = resolve }),
  )
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const button = renderer.root.findAllByType(Button).find((item) => item.props.title === 'Sprawdź GPU w tle')
    await act(async () => { button?.props.onPress() })
    const newer = await jest.mocked(captureGpuDiagnosticReport).mock.results[1].value as GpuDiagnosticReport
    expect(JSON.stringify(renderer.toJSON())).toContain('nie udostępniają GPU w tle')
    await act(async () => { finishAutomatic({
      // Request order remains authoritative if the wall clock is adjusted.
      ...newer, id: 'gpu-older', createdAt: 99999,
      capabilities: { ...newer.capabilities, gpu: null }, evaluation: 'unknown',
    }) })
    expect(JSON.stringify(renderer.toJSON())).toContain('nie udostępniają GPU w tle')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Wynik pozostaje nierozstrzygnięty')
  } finally {
    await act(async () => { renderer.unmount() })
  }
})

test.each(['success', 'failure'] as const)(
  'releases a cancelled GPU check before its deferred %s and preserves the automatic observation',
  async (outcome) => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
    const automatic = await jest.mocked(captureGpuDiagnosticReport).mock.results[0].value as GpuDiagnosticReport
    let complete!: (report: GpuDiagnosticReport) => void
    let fail!: (error: Error) => void
    jest.mocked(captureGpuDiagnosticReport).mockImplementationOnce(() =>
      new Promise<GpuDiagnosticReport>((resolve, reject) => { complete = resolve; fail = reject }),
    )
    try {
      const check = () => renderer.root.findAllByType(Button).find((item) => item.props.title === 'Sprawdź GPU w tle')
      await act(async () => { check()?.props.onPress() })
      expect(check()?.props.disabled).toBe(true)
      const cancel = renderer.root.findAllByType(Button).find((item) => item.props.title === 'Anuluj')
      expect(cancel).toBeDefined()
      await act(async () => { cancel?.props.onPress() })
      const releasedBeforeCaptureFinished = check()?.props.disabled === false
      await act(async () => {
        if (outcome === 'success') complete({
          ...automatic, id: 'gpu-cancelled', trigger: 'user', createdAt: 2,
          capabilities: { ...automatic.capabilities, gpu: true }, evaluation: 'signature-unverified',
        })
        else fail(new Error('Late diagnostic failure'))
      })
      const screen = JSON.stringify(renderer.toJSON())
      expect(screen).toContain('nie udostępniają GPU w tle')
      expect(screen).not.toContain('Late diagnostic failure')
      expect(releasedBeforeCaptureFinished).toBe(true)
      expect(renderer.root.findAllByType(Button).some((item) => item.props.title === 'Anuluj')).toBe(false)
    } finally {
      await act(async () => { renderer.unmount() })
    }
  },
)

test('SpeechAnalyzer is opt-in and is passed only to the selected audio benchmark', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const choice = renderer.root.findAllByType(Button).find((item) => item.props.title.includes('SpeechAnalyzer'))
    expect(choice).toBeDefined()
    await act(async () => { choice?.props.onPress() })
    const start = renderer.root.findAllByType(Button).find((item) => item.props.title === 'Uruchom test audio po angielsku')
    await act(async () => { start?.props.onPress() })
    expect(runBenchmarkSuite).toHaveBeenCalledWith(expect.objectContaining({ speechBackend: 'analyzer-if-installed' }))
  } finally {
    await act(async () => { renderer.unmount() })
  }
})


test('runs the selected thirty-minute STT-only comparison without invoking the LLM benchmark', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const choice = renderer.root.findAllByType(Button).find((button) => button.props.title.replace(/^●\s*/, '') === 'Nagranie 30 min')
    await act(async () => { choice?.props.onPress() })
    const start = renderer.root.findAllByType(Button).find((button) => button.props.title === 'Porównaj samo STT: 30 / 55 / 60 s')
    expect(start?.props.disabled).toBe(false)
    await act(async () => { start?.props.onPress() })
    expect(prepareEnglishBenchmarkAudioFixture).toHaveBeenCalledWith('en-audio-30min-v1', expect.any(AbortSignal))
    expect(runSpeechWindowBenchmarkSuite).toHaveBeenCalledWith(expect.objectContaining({ fixtureId: 'en-audio-30min-v1', fixture: expect.objectContaining({ uri: 'file:///bundle/en-audio-30min-v1.wav' }), speechBackend: 'recognizer' }))
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('exports STT receipts separately from model benchmark results', async () => {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const share = renderer.root.findAllByType(Button).find((button) => button.props.title === 'Eksport pomiarów STT')
    await act(async () => { share?.props.onPress() })
    expect(shareSpeechWindowBenchmarks).toHaveBeenCalledTimes(1)
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
    expect(runSpeechWindowBenchmarkSuite).not.toHaveBeenCalled()
  } finally { await act(async () => { renderer.unmount() }) }
})

test('the STT-only button stays usable when no LLM model is present', async () => {
  const models = jest.requireMock<typeof import('./benchmarkModels')>('./benchmarkModels')
  jest.mocked(models.isBenchmarkModelPresent).mockResolvedValue(false)
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(BenchmarkScreen)) })
  try {
    const start = renderer.root.findAllByType(Button).find((button) => button.props.title === 'Porównaj samo STT: 30 / 55 / 60 s')
    expect(start?.props.disabled).toBe(false)
    await act(async () => { start?.props.onPress() })
    expect(runSpeechWindowBenchmarkSuite).toHaveBeenCalledTimes(1)
    expect(runBenchmarkSuite).not.toHaveBeenCalled()
  } finally {
    await act(async () => { renderer.unmount() })
    jest.mocked(models.isBenchmarkModelPresent).mockResolvedValue(true)
  }
})
