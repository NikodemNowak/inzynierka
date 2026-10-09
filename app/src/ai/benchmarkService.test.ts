import { ENGLISH_AUDIO_FIXTURE_DATA } from './benchmarkAudioFixturesData'
import { AppState } from 'react-native'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import {
  nativeCapture,
  NativeSpeechWindowError,
  type CaptureSnapshot,
  type NativeSpeechWindowDiagnostics,
} from '../stt/nativeCapture'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import {
  runBenchmarkSuite,
  type BenchmarkSuiteOptions,
} from './benchmarkService'
import {
  BENCHMARK_PROFILES,
  BENCHMARK_QWEN35,
  validateBenchmarkMetadata,
} from './benchmarkProfiles'
import { loadModel, unloadModel, cancelGeneration } from './llm'
import { processNoteWithLlm } from './noteProcessing'
import { extractTasks } from './taskExtraction'
import { saveBenchmarkRun } from './benchmarkStorage'
import { verifyBenchmarkModel } from './benchmarkModels'
import { enqueueLlm } from './llmQueue'
import { prepareBenchmarkAudio } from './benchmarkAudio'
import * as benchmarkAudioQuality from './benchmarkAudioQuality'
import type { BenchmarkRun } from './benchmarkTypes'
import type { ProcessingExecutionContext } from './processingContext'
import type { LoadedModelInfo } from './llm'
import type { ObservedGeneration } from './generationMetrics'
import { createGpuDiagnosticReport } from '../processing/gpuDiagnostics'
import { clearSourcePlanCache } from './sourcePlanCache'
jest.mock('./sourcePlanCache', () => ({ clearSourcePlanCache: jest.fn() }), { virtual: true })

let mockGpuThermalState = 0
jest.mock('../processing/gpuDiagnostics', () => ({
  createGpuDiagnosticReport: jest.fn(() => ({
    version: 1, id: `gpu-thermal-${mockGpuThermalState}`, trigger: 'benchmark',
    method: 'bgtaskscheduler-supported-resources-v1', createdAt: Date.now(),
    environment: { platform: 'ios', platformVersion: '27.0', appState: 'active', appMode: 'release' },
    evaluation: 'unsupported', capabilities: {
      continuedProcessing: true, gpu: false, gpuUnavailableReason: null,
      supportedResourcesRawValue: 0, thermalState: mockGpuThermalState,
      configurationStatus: 'configured', registrationStatus: 'registered',
      taskIdentifierPattern: 'com.nowak.notatki.processing.*', osVersion: '27.0',
      appVersion: '1.0.0', appBuild: '6', bundleIdentifier: 'com.nowak.notatki',
      hardwareModel: 'iPhone18,1', queryError: null,
    },
    signing: { gpuEntitlement: 'unverified' },
    gpuProbe: { status: 'not-run', reason: 'device-unsupported', leaseGranted: null },
    leaseDiagnostics: [],
  })),
}))

let mockInfo: LoadedModelInfo | null = null
let mockObserver: ((event: ObservedGeneration) => void) | null = null
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}))
jest.mock('./llm', () => ({
  getLoadedModelInfo: () => mockInfo,
  loadModel: jest.fn(async (path, _progress, options) => {
    mockInfo = {
      modelPath: path,
      model: options.model,
      execution: options.execution,
      speculative: options.speculative,
      gpu: true,
      devices: ['Metal'],
      reasonNoGPU: '',
      systemInfo: 'actual native',
      metadata: {
        'general.architecture': options.model.architecture,
        [`${options.model.architecture}.nextn_predict_layers`]:
          options.model.nextnPredictLayers,
      },
    }
  }),
  unloadModel: jest.fn(async () => {
    mockInfo = null
  }),
  cancelGeneration: jest.fn(async () => undefined),
  GenerationCancelledError: class extends Error {
    constructor() {
      super('Generation cancelled')
    }
  },
}))
jest.mock('./generationMetrics', () => ({
  observeGenerations: (observer: (event: ObservedGeneration) => void) => {
    mockObserver = observer
    return () => {
      mockObserver = null
    }
  },
  runtimeMetricMetadata: () => ({
    os: 'ios',
    osVersion: '26',
    gpu: mockInfo?.gpu,
    devices: mockInfo?.devices,
    execution: mockInfo?.execution,
    speculative: mockInfo?.speculative,
  }),
}))
jest.mock('./noteProcessing', () => ({ processNoteWithLlm: jest.fn() }))
jest.mock('./taskExtraction', () => ({ extractTasks: jest.fn() }))
jest.mock('./benchmarkStorage', () => ({
  saveBenchmarkRun: jest.fn(async () => undefined),
}))
jest.mock('./benchmarkModels', () => ({
  benchmarkModelPath: (model: { filename: string }) =>
    `/models/${model.filename}`,
  verifyBenchmarkModel: jest.fn(async (model) => ({
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    architecture: model.architecture,
    nextnPredictLayers: model.nextnPredictLayers,
    verifiedAt: 1,
  })),
}))
jest.mock('./llmQueue', () => ({
  enqueueLlm: jest.fn((job: () => Promise<unknown>) => job()),
}))
jest.mock('../stt/nativeCapture', () => ({
  NativeSpeechWindowError: class extends Error {
    readonly transcript: string
    readonly diagnostics?: import('../stt/nativeCapture').NativeSpeechWindowDiagnostics
    constructor(
      message: string,
      transcript: string,
      diagnostics?: import('../stt/nativeCapture').NativeSpeechWindowDiagnostics,
    ) {
      super(message)
      this.name = 'NativeSpeechWindowError'
      this.transcript = transcript
      this.diagnostics = diagnostics
    }
  },
  nativeCapture: {
    getSnapshot: jest.fn(async () => null),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    inspectAudio: jest.fn(),
    transcribeWindow: jest.fn(),
    cancelTranscription: jest.fn(async () => undefined),
  },
}))
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    getSpeechRecognizerPermissionsAsync: jest.fn(),
    requestSpeechRecognizerPermissionsAsync: jest.fn(),
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
  },
}))
jest.mock('../i18n/translate', () => ({
  translate: (_pl: string, en: string) => en,
}))

const options = (): BenchmarkSuiteOptions => ({
  arms: ['qwen3', 'qwen35-off', 'qwen35-mtp'],
  warmRepeats: 1,
  language: 'pl',
  source: 'Send the schedule to Anna.',
  fixtureId: 'custom',
  sourceProvenance: 'user-text',
  nominalMinutes: null,
  deviceLabel: 'Test device',
  execution: 'foreground',
})
const emit = (): void => {
  mockObserver?.({
    phase: 'summary',
    inputChars: 100,
    result: {
      text: 'Summary',
      ttftMs: 2,
      tokensPerSecond: 10,
      wallMs: 50,
      promptMs: 20,
      predictedMs: 25,
      promptTokens: 30,
      predictedTokens: 20,
      draftTokens: mockInfo?.speculative ? 5 : 0,
      draftTokensAccepted: mockInfo?.speculative ? 3 : 0,
      completion: {
        status: 'complete',
        truncated: false,
        stoppedLimit: false,
        contextFull: false,
        interrupted: false,
        stoppedEos: true,
        stoppingWord: '',
      },
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGpuThermalState = 0
  mockInfo = null
  mockObserver = null
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
    writable: true,
  })
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() }))
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    emit()
    return {
      title: 'Schedule',
      summary: 'Send the schedule.',
      tags: ['Praca'],
    }
  })
  jest.mocked(extractTasks).mockResolvedValue(['Send the schedule to Anna'])
  jest.mocked(enqueueLlm).mockImplementation((job) => job())
  jest.mocked(activateKeepAwakeAsync).mockResolvedValue(undefined)
  jest.mocked(deactivateKeepAwake).mockResolvedValue(undefined)
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({
    durationMs: 42000,
    sampleRate: 16000,
    channels: 1,
  })
  jest
    .mocked(nativeCapture!.transcribeWindow)
    .mockResolvedValue('Actual speech.')
  const permission = {
    granted: true,
    status: 'granted',
    canAskAgain: true,
    expires: 'never',
  } as Awaited<
    ReturnType<
      typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync
    >
  >
  jest
    .mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync)
    .mockResolvedValue(permission)
  jest
    .mocked(ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync)
    .mockResolvedValue(permission)
  jest
    .mocked(ExpoSpeechRecognitionModule.isRecognitionAvailable)
    .mockReturnValue(true)
  jest
    .mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition)
    .mockReturnValue(true)
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}

test('keeps the whole suite awake while queued, hashing and processing, then releases its tag', async () => {
  const queued = deferred<() => Promise<unknown>>()
  const hashing = deferred<void>()
  const verifying = deferred<void>()
  jest.mocked(enqueueLlm).mockImplementation(
    (job) =>
      new Promise((resolve, reject) => {
        queued.resolve(() => job().then(resolve, reject))
      }),
  )
  jest.mocked(verifyBenchmarkModel).mockImplementationOnce(async (model) => {
    expect(deactivateKeepAwake).not.toHaveBeenCalled()
    verifying.resolve()
    await hashing.promise
    return {
      sha256: model.sha256!,
      sizeBytes: model.sizeBytes!,
      architecture: model.architecture!,
      nextnPredictLayers: model.nextnPredictLayers!,
      verifiedAt: 1,
    }
  })
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    expect(deactivateKeepAwake).not.toHaveBeenCalled()
    emit()
    return {
      title: 'Schedule',
      summary: 'Send the schedule.',
      tags: ['Praca'],
    }
  })
  const promise = runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
  })
  const startQueued = await queued.promise
  expect(deactivateKeepAwake).not.toHaveBeenCalled()
  const processing = startQueued()
  await verifying.promise
  expect(deactivateKeepAwake).not.toHaveBeenCalled()
  hashing.resolve()
  await processing
  await promise
  expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1)
  const tag = jest.mocked(activateKeepAwakeAsync).mock.calls[0][0]
  expect(typeof tag).toBe('string')
  expect(tag).not.toBe('ExpoKeepAwakeDefaultTag')
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
  expect(deactivateKeepAwake).toHaveBeenCalledWith(tag)
})

test('releases the wake tag if SHA-256 verification fails and uses a fresh tag for the next suite', async () => {
  jest
    .mocked(verifyBenchmarkModel)
    .mockRejectedValueOnce(new Error('Checksum mismatch'))
  await expect(runBenchmarkSuite(options())).rejects.toThrow(
    'Checksum mismatch',
  )
  const first = jest.mocked(activateKeepAwakeAsync).mock.calls[0][0]
  expect(deactivateKeepAwake).toHaveBeenCalledWith(first)
  expect(loadModel).not.toHaveBeenCalled()
  await runBenchmarkSuite({ ...options(), arms: ['qwen3'], warmRepeats: 0 })
  const second = jest.mocked(activateKeepAwakeAsync).mock.calls[1][0]
  expect(second).not.toBe(first)
  expect(deactivateKeepAwake).toHaveBeenNthCalledWith(2, second)
})

test('waits for pending activation and releases it when cancelled before queueing', async () => {
  const activation = deferred<void>()
  jest.mocked(activateKeepAwakeAsync).mockReturnValueOnce(activation.promise)
  const controller = new AbortController()
  const promise = runBenchmarkSuite({
    ...options(),
    signal: controller.signal,
  })
  const assertion = expect(promise).rejects.toThrow(/cancel/i)
  controller.abort()
  expect(deactivateKeepAwake).not.toHaveBeenCalled()
  activation.resolve()
  await assertion
  expect(enqueueLlm).not.toHaveBeenCalled()
  expect(deactivateKeepAwake).toHaveBeenCalledWith(
    jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
  )
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
  expect(cancelGeneration).not.toHaveBeenCalled()
})

test('releases a possibly acquired tag if keep-awake activation rejects', async () => {
  jest
    .mocked(activateKeepAwakeAsync)
    .mockRejectedValueOnce(new Error('Wake activation failed'))
  await expect(runBenchmarkSuite(options())).rejects.toThrow(
    'Wake activation failed',
  )
  expect(enqueueLlm).not.toHaveBeenCalled()
  expect(deactivateKeepAwake).toHaveBeenCalledWith(
    jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
  )
})

test('runs cold and warm full workflows in one queue and isolates MTP off/on on the same pinned file', async () => {
  const runs = await runBenchmarkSuite(options())
  expect(enqueueLlm).toHaveBeenCalledTimes(1)
  expect(verifyBenchmarkModel).toHaveBeenCalledTimes(2)
  expect(runs.map((run) => [run.arm, run.condition])).toEqual([
    ['qwen3', 'cold'],
    ['qwen3', 'warm'],
    ['qwen35-off', 'cold'],
    ['qwen35-off', 'warm'],
    ['qwen35-mtp', 'cold'],
    ['qwen35-mtp', 'warm'],
  ])
  const calls = jest.mocked(loadModel).mock.calls
  expect(calls[2][0]).toBe(calls[4][0])
  expect(calls[2][2]?.model).toBe(BENCHMARK_QWEN35)
  expect(calls[2][2]?.speculative).toBe(false)
  expect(calls[4][2]?.speculative).toBe(true)
  expect(runs[4]).toMatchObject({
    revision: BENCHMARK_QWEN35.revision,
    modelSha256: BENCHMARK_QWEN35.sha256,
    prefillMs: 20,
    decodeMs: 25,
    draftTokens: 5,
    draftTokensAccepted: 3,
    succeeded: true,
    output: { tasks: ['Send the schedule to Anna'] },
  })
  expect(processNoteWithLlm).toHaveBeenCalledTimes(6)
  expect(extractTasks).toHaveBeenCalledTimes(6)
  expect(saveBenchmarkRun).toHaveBeenCalledTimes(12)
  expect(mockInfo).toBeNull()
  expect(unloadModel).toHaveBeenCalled()
})

test('retains incomplete outputs and marks them failed rather than inventing a success', async () => {
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    emit()
    return {
      title: 'Schedule',
      summary: '',
      tags: [],
      warnings: ['Summary failed'],
    }
  })
  const [run] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen35-mtp'],
    warmRepeats: 0,
  })
  expect(run.succeeded).toBe(false)
  expect(run.output?.warnings).toEqual(['Summary failed'])
  expect(run.output?.tasks).toEqual(['Send the schedule to Anna'])
})

test('persists task uncertainty instead of presenting the run as a clean success', async () => {
  jest
    .mocked(extractTasks)
    .mockImplementation(async (_source, _status, _language, execution) => {
      const context = execution as typeof execution & {
        onWarning?: (message: string) => void
      }
      context?.onWarning?.('Check an ambiguous task cancellation.')
      context?.onWarning?.('Check an ambiguous task cancellation.')
      return ['Send the schedule to Anna']
    })
  const [run] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
  })
  expect(run.output?.warnings).toEqual([
    'Check an ambiguous task cancellation.',
  ])
  expect(run.output?.tasks).toEqual(['Send the schedule to Anna'])
  expect(run.succeeded).toBe(false)
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      output: expect.objectContaining({
        warnings: ['Check an ambiguous task cancellation.'],
      }),
    }),
  )
})

test('records the pipeline version and raw generation for local failure diagnosis', async () => {
  const [run] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
  })
  expect(run).toMatchObject({ pipelineVersion: 'source-linked-summary-v40' })
  expect(run.generations[0]).toMatchObject({ outputText: 'Summary' })
})

test('does not stop a different note generation when this suite is cancelled while queued', async () => {
  const controller = new AbortController()
  let scheduled: (() => Promise<unknown>) | undefined
  jest.mocked(enqueueLlm).mockImplementation(
    (job) =>
      new Promise((resolve, reject) => {
        scheduled = () => job().then(resolve, reject)
      }),
  )
  const promise = runBenchmarkSuite({
    ...options(),
    signal: controller.signal,
  })
  const assertion = expect(promise).rejects.toThrow(/cancel/i)
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  expect(cancelGeneration).not.toHaveBeenCalled()
  // The unrelated queue owner may run for minutes. Cancelling this suite must
  // release its screen lock before its queued callback ever gets a turn.
  for (let step = 0; step < 5; step++) await Promise.resolve()
  try {
    expect(deactivateKeepAwake).toHaveBeenCalledWith(
      jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
    )
  } finally {
    await scheduled?.()
    await assertion
  }
  expect(loadModel).not.toHaveBeenCalled()
  expect(deactivateKeepAwake).toHaveBeenCalledWith(
    jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
  )
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
})

test('aborts native processing when the app enters background', async () => {
  const handlers = new Map<string, (state?: string) => void>()
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((event: string, handler: (state?: string) => void) => {
      handlers.set(event, handler)
      return { remove: jest.fn() }
    }) as typeof AppState.addEventListener)
  jest
    .mocked(processNoteWithLlm)
    .mockImplementation(
      async (_source, _progress, _load, _language, execution) => {
        handlers.get('change')?.('background')
        expect(execution?.signal?.aborted).toBe(true)
        throw new Error('Cancelled')
      },
    )
  try {
    await expect(
      runBenchmarkSuite({ ...options(), arms: ['qwen3'], warmRepeats: 0 }),
    ).rejects.toThrow(/cancel/i)
    expect(cancelGeneration).toHaveBeenCalled()
    expect(extractTasks).not.toHaveBeenCalled()
    expect(mockInfo).toBeNull()
    expect(deactivateKeepAwake).toHaveBeenCalledWith(
      jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
    )
  } finally {
    listener.mockRestore()
  }
})

test('memory pressure still cancels native processing and releases the wake tag', async () => {
  let memoryWarning: (() => void) | undefined
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((event: string, handler: (state?: string) => void) => {
      if (event === 'memoryWarning') memoryWarning = () => handler()
      return { remove: jest.fn() }
    }) as typeof AppState.addEventListener)
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    memoryWarning?.()
    throw new Error('Cancelled')
  })
  try {
    await expect(
      runBenchmarkSuite({ ...options(), arms: ['qwen3'], warmRepeats: 0 }),
    ).rejects.toThrow(/cancel/i)
    expect(cancelGeneration).toHaveBeenCalledWith('benchmark')
    expect(deactivateKeepAwake).toHaveBeenCalledWith(
      jest.mocked(activateKeepAwakeAsync).mock.calls[0][0],
    )
  } finally {
    listener.mockRestore()
  }
})

test('requires the actual GGUF NextN metadata for the MTP checkpoint', () => {
  expect(() =>
    validateBenchmarkMetadata(BENCHMARK_QWEN35, {
      'general.architecture': 'qwen35',
      'qwen35.nextn_predict_layers': '1',
    }),
  ).not.toThrow()
  expect(() =>
    validateBenchmarkMetadata(BENCHMARK_QWEN35, {
      'general.architecture': 'qwen35',
    }),
  ).toThrow(/NextN/)
  expect(BENCHMARK_PROFILES[1].model).toBe(BENCHMARK_PROFILES[2].model)
})

const audioOptions = (): BenchmarkSuiteOptions => ({
  ...options(),
  arms: ['qwen3'],
  inputMode: 'audio',
  audioFixture: {
    uri: 'file:///documents/TestAudio/benchmark-en-smoke-v6.wav',
    locale: 'en-US',
    referenceTranscript: 'Reference text must never replace actual speech.',
    provenance: 'synthetic-audio',
  },
})

const englishSmokeReference =
  "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was one thousand two hundred dollars. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning. The workshop materials, the supplier's reply, and the updated schedule are the topics for that meeting."

const englishSmokeOptions = (): BenchmarkSuiteOptions => ({
  ...audioOptions(),
  fixtureId: 'en-audio-smoke-v6',
  audioFixture: {
    ...audioOptions().audioFixture!,
    referenceTranscript: englishSmokeReference,
  },
})

test.each(['en-audio-3min-v1', 'en-audio-10min-v1', 'en-audio-30min-v1'])(
  'persists suffix-only actual speech as review-required for registered bundled fixture %s',
  async (fixtureId) => {
    const actual = 'The final meeting topics were discussed.'
    jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue(actual)
    const [run] = await runBenchmarkSuite({ ...englishSmokeOptions(), fixtureId, warmRepeats: 0 })
    expect(run.source).toBe(actual)
    expect(run.audio?.completeness?.reviewRequired).toBe(true)
    expect(run.succeeded).toBe(false)
    expect(run.output?.warnings).toEqual([expect.stringMatching(/speech transcript needs review/i)])
    expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
    expect(processNoteWithLlm).toHaveBeenCalledWith(actual, expect.any(Function), undefined, 'en', expect.any(Object))
  },
)

test.each([
  ['en-audio-3min-v1', 167220, 3],
  ['en-audio-10min-v1', 600000, 10],
  ['en-audio-30min-v1', 1800000, 30],
] as const)('recognizes every window afresh in cold and warm bundled %s runs', async (fixtureId, durationMs, nominalMinutes) => {
  const windowCount = Math.ceil(durationMs / 30000)
  const coldChunks = Array.from({ length: windowCount }, (_, index) => `Recognized section ${index} contains actual speech from the current audio window.`)
  const warmChunks = coldChunks.map((chunk) => chunk.replace('Recognized', 'Observed'))
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs, sampleRate: 16000, channels: 1 })
  for (const chunk of [...coldChunks, ...warmChunks]) jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValueOnce(chunk)
  const runs = await runBenchmarkSuite({
    ...audioOptions(), fixtureId, nominalMinutes,
    audioFixture: { ...audioOptions().audioFixture!, referenceTranscript: coldChunks.join(' '),
      expectedDurationMs: durationMs, audioSha256: 'a'.repeat(64), bundled: true },
  })
  expect(runs.map((run) => run.condition)).toEqual(['cold', 'warm'])
  expect(nativeCapture!.inspectAudio).toHaveBeenCalledTimes(2)
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(windowCount * 2)
  for (const [index, run] of runs.entries()) {
    const actual = (index === 0 ? coldChunks : warmChunks).join(' ')
    expect(run.source).toBe(actual)
    expect(run.audio).toMatchObject({ transcript: actual, durationMs, expectedDurationMs: durationMs,
      audioSha256: 'a'.repeat(64), bundled: true, sampleRate: 16000, channels: 1, status: 'complete',
      completeness: { reviewRequired: false } })
    expect(run.audio?.windows).toHaveLength(windowCount)
    expect(run.audio?.windows?.at(-1)).toMatchObject({ startMs: (windowCount - 1) * 30000,
      durationMs: durationMs - (windowCount - 1) * 30000 })
    expect(processNoteWithLlm).toHaveBeenNthCalledWith(index + 1, actual, expect.any(Function), undefined, 'en', expect.any(Object))
    expect(extractTasks).toHaveBeenNthCalledWith(index + 1, actual, expect.any(Function), 'en', expect.any(Object))
    expect(saveBenchmarkRun).toHaveBeenNthCalledWith(index * 2 + 2, run)
    expect(run.succeeded).toBe(true)
  }
})

test('persists wrong bundled audio duration as a failed run before STT or model load', async () => {
  const [run] = await runBenchmarkSuite({
    ...audioOptions(), fixtureId: 'en-audio-3min-v1', warmRepeats: 0,
    audioFixture: { ...audioOptions().audioFixture!, expectedDurationMs: 167220, bundled: true },
  })
  expect(run.error).toMatch(/duration/i)
  expect(run.audio?.status).toBe('failed')
  expect(run.source).toBe('')
  expect(run.succeeded).toBe(false)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(loadModel).not.toHaveBeenCalled()
  expect(saveBenchmarkRun).toHaveBeenCalledWith(run)
})

test('retains actual partial speech and bundled identity when a later long-audio window fails', async () => {
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 600000, sampleRate: 16000, channels: 1 })
  jest.mocked(nativeCapture!.transcribeWindow)
    .mockResolvedValueOnce('Actual first minute.')
    .mockRejectedValueOnce(new NativeSpeechWindowError('Recognition failed in the second minute', 'Actual partial second minute.'))
  const [run] = await runBenchmarkSuite({
    ...audioOptions(), fixtureId: 'en-audio-10min-v1', nominalMinutes: 10, warmRepeats: 0,
    audioFixture: { ...audioOptions().audioFixture!, expectedDurationMs: 600000, audioSha256: 'b'.repeat(64), bundled: true },
  })
  expect(run.source).toBe('Actual first minute. Actual partial second minute.')
  expect(run.audio).toMatchObject({ status: 'failed', durationMs: 600000, expectedDurationMs: 600000,
    audioSha256: 'b'.repeat(64), bundled: true, transcript: run.source })
  expect(run.audio?.windows).toHaveLength(2)
  expect(run.succeeded).toBe(false)
  expect(run.error).toMatch(/second minute/)
  expect(processNoteWithLlm).not.toHaveBeenCalled()
  expect(loadModel).not.toHaveBeenCalled()
  expect(saveBenchmarkRun).toHaveBeenCalledWith(run)
})

test('cancels a thirty-minute fixture midway and saves actual partial windows without LLM work', async () => {
  const controller = new AbortController()
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 1800000, sampleRate: 16000, channels: 1 })
  let windows = 0
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    windows += 1
    if (windows === 13) controller.abort()
    return `Actual window ${windows}.`
  })
  await expect(runBenchmarkSuite({
    ...audioOptions(), fixtureId: 'en-audio-30min-v1', nominalMinutes: 30, warmRepeats: 0, signal: controller.signal,
    audioFixture: { ...audioOptions().audioFixture!, expectedDurationMs: 1800000, bundled: true },
  })).rejects.toThrow(/cancel/i)
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(13)
  expect(nativeCapture!.cancelTranscription).toHaveBeenCalledTimes(1)
  const run = jest.mocked(saveBenchmarkRun).mock.calls[0][0]
  expect(run.audio?.windows).toHaveLength(13)
  expect(run.source).toBe(Array.from({ length: 13 }, (_, index) => `Actual window ${index + 1}.`).join(' '))
  expect(run.audio?.status).toBe('failed')
  expect(run.succeeded).toBe(false)
  expect(loadModel).not.toHaveBeenCalled()
  expect(processNoteWithLlm).not.toHaveBeenCalled()
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
})

test('persists the real iPhone suffix-only STT as review-required in both fresh runs while retaining actual LLM input', async () => {
  const actualPhoneTranscript =
    'The workshop materials, the suppliers reply, and the updated schedule are the topics for that meeting'
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({
    durationMs: 49770,
    sampleRate: 16000,
    channels: 1,
  })
  jest
    .mocked(nativeCapture!.transcribeWindow)
    .mockResolvedValue(actualPhoneTranscript)
  const runs = await runBenchmarkSuite(englishSmokeOptions())
  expect(runs).toHaveLength(2)
  for (const run of runs) {
    expect(run.source).toBe(actualPhoneTranscript)
    expect(run.audio).toMatchObject({
      transcript: actualPhoneTranscript,
      referenceTranscript: englishSmokeReference,
      status: 'complete',
      completeness: {
        rawReferenceWords: 124,
        rawTranscriptWords: 16,
        normalizedReferenceWords: 124,
        normalizedTranscriptWords: 16,
        substitutions: 0,
        deletions: 108,
        insertions: 0,
        wordErrorRate: 108 / 124,
        wordRatio: 16 / 124,
        maximumWordErrorRate: 0.15,
        minimumWordRatio: 0.8,
        reviewRequired: true,
      },
    })
    expect(run.output?.warnings).toEqual([
      expect.stringMatching(/transcript|speech/i),
    ])
    expect(run.succeeded).toBe(false)
    expect(run.error).toBeNull()
    expect(run.assessment).toMatchObject({
      faithfulSummary: null,
      completeTasks: null,
      acceptableLanguage: null,
    })
  }
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(2)
  expect(processNoteWithLlm).toHaveBeenNthCalledWith(
    1,
    actualPhoneTranscript,
    expect.any(Function),
    undefined,
    'en',
    expect.any(Object),
  )
  expect(processNoteWithLlm).toHaveBeenNthCalledWith(
    2,
    actualPhoneTranscript,
    expect.any(Function),
    undefined,
    'en',
    expect.any(Object),
  )
  expect(extractTasks).toHaveBeenNthCalledWith(
    1,
    actualPhoneTranscript,
    expect.any(Function),
    'en',
    expect.any(Object),
  )
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(runs[1])
})

test('accepts lexical completeness with the declared equivalent numeric formats while keeping actual numbers as LLM input', async () => {
  const actual = englishSmokeReference
    .replace('one thousand two hundred', '1,200')
    .replace('one thousand seven hundred fifty', '1,750')
    .replace('October twelfth', 'October 12th')
    .replace('ten in the morning', '10:00 AM')
  jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue(actual)
  const [run] = await runBenchmarkSuite({
    ...englishSmokeOptions(),
    warmRepeats: 0,
  })
  expect(run.source).toBe(actual)
  expect(run.audio).toMatchObject({
    completeness: { wordErrorRate: 0, wordRatio: 1, reviewRequired: false },
  })
  expect(run.output?.warnings).toEqual([])
  expect(run.succeeded).toBe(true)
  expect(processNoteWithLlm).toHaveBeenCalledWith(
    actual,
    expect.any(Function),
    undefined,
    'en',
    expect.any(Object),
  )
})

test('does not apply the synthetic smoke threshold to another audio fixture', async () => {
  jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue('Call Alice.')
  const [run] = await runBenchmarkSuite({
    ...englishSmokeOptions(),
    fixtureId: 'custom-audio',
    warmRepeats: 0,
  })
  expect(run.source).toBe('Call Alice.')
  expect(run.audio).not.toHaveProperty('completeness')
  expect(run.output?.warnings).toEqual([])
  expect(run.succeeded).toBe(true)
})

test('keeps the STT review warning beside later LLM warnings in the durable result', async () => {
  jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue('Call Alice.')
  jest.mocked(processNoteWithLlm).mockResolvedValue({
    title: 'Alice',
    summary: '',
    tags: [],
    warnings: ['Summary needs checking.'],
    failedFields: ['summary'],
  })
  const [run] = await runBenchmarkSuite({
    ...englishSmokeOptions(),
    warmRepeats: 0,
  })
  expect(run.output?.warnings).toEqual([
    expect.stringMatching(/speech transcript needs review/i),
    'Summary needs checking.',
  ])
  expect(run.source).toBe('Call Alice.')
  expect(run.succeeded).toBe(false)
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
})

test('persists actual native window diagnostics while scoring and processing only its actual transcript', async () => {
  const diagnostics = {
    version: 1 as const,
    requestedStartMs: 0,
    requestedDurationMs: 49770,
    decodedFrames: 796320,
    decodedDurationMs: 49770,
    decodedSampleRate: 16000,
    callbackCount: 5,
    finalCallbackCount: 1,
    finalLikeCallbackCount: 2,
    untimedCallbackCount: 0,
    mergedSegmentCount: 124,
    callbacksTruncated: false,
    observedStartMs: 0,
    observedEndMs: 49770,
    callbacks: [],
  }
  const facade = jest.fn(async () => ({
    transcript: englishSmokeReference,
    diagnostics,
  }))
  const descriptor = Object.getOwnPropertyDescriptor(
    nativeCapture,
    'transcribeWindowWithDiagnostics',
  )
  Object.defineProperty(nativeCapture, 'transcribeWindowWithDiagnostics', {
    configurable: true,
    value: facade,
  })
  jest
    .mocked(nativeCapture!.inspectAudio)
    .mockResolvedValue({ durationMs: 49770, sampleRate: 16000, channels: 1 })
  try {
    const [run] = await runBenchmarkSuite({
      ...englishSmokeOptions(),
      warmRepeats: 0,
    })
    expect(facade).toHaveBeenCalledWith(
      expect.any(String),
      0,
      49770,
      'en-US',
      expect.any(String),
    )
    expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
    expect(run.audio).toMatchObject({
      windows: [
        {
          startMs: 0,
          durationMs: 49770,
          requestId: expect.any(String),
          diagnostics,
        },
      ],
      transcript: englishSmokeReference,
      completeness: { reviewRequired: false },
    })
    expect(run.source).toBe(englishSmokeReference)
    expect(processNoteWithLlm).toHaveBeenCalledWith(
      englishSmokeReference,
      expect.any(Function),
      undefined,
      'en',
      expect.any(Object),
    )
    expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
  } finally {
    if (descriptor)
      Object.defineProperty(
        nativeCapture,
        'transcribeWindowWithDiagnostics',
        descriptor,
      )
    else
      Reflect.deleteProperty(nativeCapture!, 'transcribeWindowWithDiagnostics')
  }
})

test.each([false, true])(
  'keeps native failed-window transcript and diagnostics without running LLM (earlier complete window: %p)',
  async (earlierWindow) => {
    const earlier = 'Alice will prepare the workshop materials by Friday.'
    const partial = 'Bob will contact the supplier by Tuesday.'
    const startMs = earlierWindow ? 60000 : 0
    const durationMs = earlierWindow ? 12000 : 49770
    const diagnostics: NativeSpeechWindowDiagnostics = {
      version: 1,
      requestedStartMs: startMs,
      requestedDurationMs: durationMs,
      decodedFrames: durationMs * 16,
      decodedDurationMs: durationMs,
      decodedSampleRate: 16000,
      callbackCount: 3,
      finalCallbackCount: 1,
      finalLikeCallbackCount: 2,
      untimedCallbackCount: 1,
      mergedSegmentCount: 8,
      callbacksTruncated: false,
      callbacks: [],
    }
    const failure = new NativeSpeechWindowError(
      'Native speech final lacked timed segments',
      partial,
      diagnostics,
    )
    const facade = jest.fn()
    if (earlierWindow) facade.mockResolvedValueOnce({ transcript: earlier })
    facade.mockRejectedValueOnce(failure)
    const descriptor = Object.getOwnPropertyDescriptor(
      nativeCapture,
      'transcribeWindowWithDiagnostics',
    )
    Object.defineProperty(nativeCapture, 'transcribeWindowWithDiagnostics', {
      configurable: true,
      value: facade,
    })
    jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({
      durationMs: earlierWindow ? 72000 : 49770,
      sampleRate: 16000,
      channels: 1,
    })
    try {
      const [run] = await runBenchmarkSuite({
        ...englishSmokeOptions(),
        warmRepeats: 0,
      })
      const actual = earlierWindow ? `${earlier} ${partial}` : partial
      expect(run.source).toBe(actual)
      expect(run.audio?.transcript).toBe(actual)
      expect(run.audio?.status).toBe('failed')
      expect(run.audio?.windows?.at(-1)).toMatchObject({
        startMs,
        durationMs,
        requestId: expect.any(String),
        diagnostics,
      })
      if (earlierWindow)
        expect(run.audio?.windows?.[0]).not.toHaveProperty('diagnostics')
      expect(run.error).toBe(failure.message)
      expect(run.succeeded).toBe(false)
      expect(run.output).toBeNull()
      expect(processNoteWithLlm).not.toHaveBeenCalled()
      expect(extractTasks).not.toHaveBeenCalled()
      expect(loadModel).not.toHaveBeenCalled()
      expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
      expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
    } finally {
      if (descriptor)
        Object.defineProperty(
          nativeCapture,
          'transcribeWindowWithDiagnostics',
          descriptor,
        )
      else
        Reflect.deleteProperty(
          nativeCapture!,
          'transcribeWindowWithDiagnostics',
        )
    }
  },
)

test('uses fresh English STT in both cold and warm audio runs independently of the interface language', async () => {
  jest
    .mocked(nativeCapture!.transcribeWindow)
    .mockResolvedValueOnce('Alice will send the first schedule.')
    .mockResolvedValueOnce('Bob will send the second schedule.')
  const runs = await runBenchmarkSuite(audioOptions())
  expect(runs.map((run) => [run.condition, run.source, run.language])).toEqual([
    ['cold', 'Alice will send the first schedule.', 'en'],
    ['warm', 'Bob will send the second schedule.', 'en'],
  ])
  expect(runs[0].audio).toMatchObject({
    referenceTranscript: 'Reference text must never replace actual speech.',
    transcript: 'Alice will send the first schedule.',
    durationMs: 42000,
    locale: 'en-US',
    requireOnDeviceRecognition: true,
    provenance: 'synthetic-audio',
    status: 'complete',
  })
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(2)
  const calls = jest.mocked(nativeCapture!.transcribeWindow).mock.calls
  expect(calls[0].slice(0, 4)).toEqual([
    'file:///documents/TestAudio/benchmark-en-smoke-v6.wav',
    0,
    42000,
    'en-US',
  ])
  expect(calls[0][4]).not.toBe(calls[1][4])
  expect(processNoteWithLlm).toHaveBeenNthCalledWith(
    1,
    'Alice will send the first schedule.',
    expect.any(Function),
    undefined,
    'en',
    expect.any(Object),
  )
  expect(extractTasks).toHaveBeenNthCalledWith(
    2,
    'Bob will send the second schedule.',
    expect.any(Function),
    'en',
    expect.any(Object),
  )
})

test.each(['', '   '])(
  'persists empty STT as failure without processing the reference: %p',
  async (transcript) => {
    jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue(transcript)
    const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
    expect(run.succeeded).toBe(false)
    expect(run.error).toMatch(/transcript|speech/i)
    expect(run.source).toBe('')
    expect(run.audio?.transcript).toBe(transcript)
    expect(run.audio?.status).toBe('failed')
    expect(run.output).toBeNull()
    expect(processNoteWithLlm).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
    expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
  },
)

test('persists native STT errors and never substitutes synthetic reference text', async () => {
  jest
    .mocked(nativeCapture!.transcribeWindow)
    .mockRejectedValue(new Error('On-device speech unavailable'))
  const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
  expect(run).toMatchObject({
    succeeded: false,
    error: 'On-device speech unavailable',
    source: '',
    llmMs: 0,
  })
  expect(run.audio?.status).toBe('failed')
  expect(processNoteWithLlm).not.toHaveBeenCalled()
  expect(extractTasks).not.toHaveBeenCalled()
})

test('requests speech permission before lifecycle-sensitive work and persists denial', async () => {
  const permission = {
    granted: false,
    status: 'denied',
    canAskAgain: true,
    expires: 'never',
  } as Awaited<
    ReturnType<
      typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync
    >
  >
  jest
    .mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync)
    .mockResolvedValue(permission)
  jest
    .mocked(ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync)
    .mockImplementation(async () => {
      expect(activateKeepAwakeAsync).not.toHaveBeenCalled()
      return permission
    })
  const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
  expect(run.error).toMatch(/permission/i)
  expect(run.succeeded).toBe(false)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(processNoteWithLlm).not.toHaveBeenCalled()
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
})

test('allows empty device conditions and records automatic platform metadata', async () => {
  const [run] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
    deviceLabel: ' ',
  })
  expect(run.environment).toMatchObject({
    deviceLabel: 'iOS 26',
    deviceLabelSource: 'automatic',
  })
  const [manual] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
    deviceLabel: '  unplugged  ',
  })
  expect(manual.environment).toMatchObject({
    deviceLabel: 'unplugged',
    deviceLabelSource: 'user',
  })
})

test('separates measured STT, load, LLM and first persistence boundaries in audio mode', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(nativeCapture!.inspectAudio).mockImplementation(async () => {
    clock += 7
    return { durationMs: 42000, sampleRate: 16000, channels: 1 }
  })
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    clock += 101
    return 'Actual speech.'
  })
  const load = jest.mocked(loadModel).getMockImplementation()!
  jest.mocked(loadModel).mockImplementation(async (...args) => {
    clock += 20
    return load(...args)
  })
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    clock += 30
    emit()
    return { title: 'Actual', summary: 'Actual speech.', tags: [] }
  })
  jest.mocked(extractTasks).mockImplementation(async () => {
    clock += 10
    return []
  })
  jest.mocked(saveBenchmarkRun).mockImplementation(async () => {
    clock += 5
  })
  try {
    const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
    expect(run).toMatchObject({
      sttMs: 108,
      sttRecognitionMs: 108,
      sttQualityMs: 0,
      modelLoadMs: 20,
      llmMs: 40,
      processingMs: 40,
      persistMs: 5,
      totalMs: 173,
    })
  } finally {
    now.mockRestore()
    jest.mocked(loadModel).mockImplementation(load)
    jest.mocked(saveBenchmarkRun).mockResolvedValue(undefined)
  }
})

test('includes a native GPU capability observation in saved model results without treating it as a GPU test', async () => {
  const runs = await runBenchmarkSuite({ ...options(), arms: ['qwen3'] })
  expect(createGpuDiagnosticReport).toHaveBeenCalledWith('benchmark')
  for (const run of runs) {
    expect(run.gpuDiagnostic).toMatchObject({
      capabilities: { gpu: false, osVersion: '27.0', appBuild: '6' },
      signing: { gpuEntitlement: 'unverified' }, gpuProbe: { status: 'not-run', leaseGranted: null },
    })
  }
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(runs[runs.length - 1])
})

test('captures each run after waiting for model preparation and refreshes thermal evidence for warm repeats', async () => {
  const preparing = deferred<void>()
  const prepared = deferred<void>()
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(unloadModel).mockImplementationOnce(async () => { mockInfo = null })
    .mockImplementationOnce(async () => {
      preparing.resolve()
      await prepared.promise
      mockInfo = null
    })
  const suite = runBenchmarkSuite({
    ...options(), arms: ['qwen3'],
    onResult: () => { clock = 3000; mockGpuThermalState = 2 },
  })
  try {
    await preparing.promise
    clock = 2000
    mockGpuThermalState = 1
    prepared.resolve()
    const runs = await suite
    expect(runs.map((run) => ({
      thermalState: run.gpuDiagnostic?.capabilities.thermalState,
      diagnosticAt: run.gpuDiagnostic?.createdAt,
      runStartedAt: run.requestedAt,
    }))).toEqual([
      { thermalState: 1, diagnosticAt: 2000, runStartedAt: 2000 },
      { thermalState: 2, diagnosticAt: 3000, runStartedAt: 3000 },
    ])
    expect(runs[0].gpuDiagnostic).not.toBe(runs[1].gpuDiagnostic)
  } finally {
    prepared.resolve()
    await suite
    now.mockRestore()
  }
})

test('records the default recognizer backend and honors explicit analyzer opt-in for audio', async () => {
  const [defaultRun] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
  expect(defaultRun.audio?.speechBackend).toBe('recognizer')
  const [optInRun] = await runBenchmarkSuite({
    ...audioOptions(), warmRepeats: 0, speechBackend: 'analyzer-if-installed',
  })
  expect(optInRun.audio?.speechBackend).toBe('analyzer-if-installed')
})

test('measures recognition and quality independently while retaining the STT and first durable-result boundaries', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  const events: string[] = []
  const saved: BenchmarkRun[] = []
  jest.mocked(nativeCapture!.inspectAudio).mockImplementation(async () => {
    clock += 7
    return { durationMs: 42000, sampleRate: 16000, channels: 1 }
  })
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    clock += 101
    events.push('recognition-finished')
    return englishSmokeReference
  })
  const evaluate = benchmarkAudioQuality.evaluateBenchmarkAudioQuality
  const quality = jest
    .spyOn(benchmarkAudioQuality, 'evaluateBenchmarkAudioQuality')
    .mockImplementation((...args) => {
      events.push('quality-started')
      clock += 43
      return evaluate(...args)
    })
  const load = jest.mocked(loadModel).getMockImplementation()!
  jest.mocked(loadModel).mockImplementation(async (...args) => {
    clock += 20
    return load(...args)
  })
  jest.mocked(processNoteWithLlm).mockImplementation(async () => {
    events.push('llm-started')
    clock += 30
    emit()
    return { title: 'Workshop', summary: englishSmokeReference, tags: [] }
  })
  jest.mocked(extractTasks).mockImplementation(async () => {
    clock += 10
    return []
  })
  jest.mocked(saveBenchmarkRun).mockImplementation(async (run) => {
    saved.push(JSON.parse(JSON.stringify(run)) as BenchmarkRun)
    clock += saved.length === 1 ? 5 : 500
  })
  try {
    const [run] = await runBenchmarkSuite({
      ...englishSmokeOptions(),
      warmRepeats: 0,
      onProgress: (message) => {
        events.push(message)
        if (message === 'Checking transcript') clock += 2
      },
    })
    expect(run).toMatchObject({
      sttRecognitionMs: 108,
      sttQualityMs: 43,
      sttMs: 153,
      modelLoadMs: 20,
      llmMs: 40,
      processingMs: 40,
      persistMs: 5,
      totalMs: 218,
      source: englishSmokeReference,
      error: null,
    })
    expect(run.audio?.sttMs).toBe(153)
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({
      sttRecognitionMs: 108,
      sttQualityMs: 43,
      sttMs: 153,
      persistMs: 0,
      totalMs: 213,
    })
    expect(saved[1]).toMatchObject({ persistMs: 5, totalMs: 218 })
    const stt = events.findIndex((message) => message.startsWith('STT'))
    const finished = events.indexOf('recognition-finished')
    const checking = events.indexOf('Checking transcript')
    const scored = events.indexOf('quality-started')
    expect(stt).toBeGreaterThanOrEqual(0)
    expect(finished).toBeGreaterThan(stt)
    expect(checking).toBeGreaterThan(finished)
    expect(scored).toBeGreaterThan(checking)
    expect(events.indexOf('llm-started')).toBeGreaterThan(scored)
  } finally {
    now.mockRestore()
    quality.mockRestore()
    jest.mocked(loadModel).mockImplementation(load)
    jest.mocked(saveBenchmarkRun).mockResolvedValue(undefined)
  }
})

test('retains failed native recognition time and actual partial speech without quality work or an invented cancellation reason', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  const quality = jest.spyOn(
    benchmarkAudioQuality,
    'evaluateBenchmarkAudioQuality',
  )
  jest.mocked(nativeCapture!.inspectAudio).mockImplementation(async () => {
    clock += 7
    return { durationMs: 42000, sampleRate: 16000, channels: 1 }
  })
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    clock += 31
    throw new NativeSpeechWindowError('Native speech interrupted', 'Actual partial speech.')
  })
  try {
    const [run] = await runBenchmarkSuite({ ...englishSmokeOptions(), warmRepeats: 0 })
    expect(run).toMatchObject({
      sttRecognitionMs: 38,
      sttQualityMs: 0,
      sttMs: 38,
      source: 'Actual partial speech.',
      error: 'Native speech interrupted',
      succeeded: false,
      output: null,
    })
    expect(run).not.toHaveProperty('cancellationReason')
    expect(run.audio?.sttMs).toBe(38)
    expect(quality).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
    expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
  } finally {
    now.mockRestore()
    quality.mockRestore()
  }
})

test('records zero recognition and quality time when audio preflight prevents both phases', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
  const permission = {
    granted: false,
    status: 'denied',
    canAskAgain: false,
    expires: 'never',
  } as Awaited<ReturnType<typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync>>
  jest.mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync)
    .mockResolvedValue(permission)
  try {
    const [run] = await runBenchmarkSuite({ ...englishSmokeOptions(), warmRepeats: 0 })
    expect(run).toMatchObject({
      sttRecognitionMs: 0,
      sttQualityMs: 0,
      sttMs: 0,
      source: '',
      error: expect.stringMatching(/permission/i),
      succeeded: false,
    })
    expect(run.audio?.sttMs).toBe(0)
    expect(nativeCapture!.inspectAudio).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
  } finally {
    now.mockRestore()
  }
})

test('retains elapsed quality time and exact speech when transcript scoring fails', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    clock += 17
    return 'Actual speech.'
  })
  const quality = jest
    .spyOn(benchmarkAudioQuality, 'evaluateBenchmarkAudioQuality')
    .mockImplementation(() => {
      clock += 9
      throw new Error('Transcript scoring failed')
    })
  try {
    const [run] = await runBenchmarkSuite({ ...englishSmokeOptions(), warmRepeats: 0 })
    expect(run).toMatchObject({
      sttRecognitionMs: 17,
      sttQualityMs: 9,
      sttMs: 26,
      source: 'Actual speech.',
      error: 'Transcript scoring failed',
      output: null,
    })
    expect(run.audio?.sttMs).toBe(26)
    expect(run).not.toHaveProperty('cancellationReason')
    expect(loadModel).not.toHaveBeenCalled()
  } finally {
    now.mockRestore()
    quality.mockRestore()
  }
})

test.each([
  'external-signal',
  'app-inactive',
  'app-background',
  'memory-warning',
  'recording-started',
] as const)('persists the first %s cancellation trigger and stops the audio suite after its failed run', async (first) => {
  const controller = new AbortController()
  const handlers = new Map<string, (state?: string) => void>()
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    handler: (state?: string) => void,
  ) => {
    handlers.set(event, handler)
    return { remove: jest.fn() }
  }) as typeof AppState.addEventListener)
  let captureState: ((snapshot: CaptureSnapshot) => void) | undefined
  const subscribe = jest.mocked(nativeCapture!.addListener).getMockImplementation()!
  jest.mocked(nativeCapture!.addListener).mockImplementation(((
    _name: string,
    handler: (snapshot: CaptureSnapshot) => void,
  ) => {
    captureState = handler
    return { remove: jest.fn() }
  }) as unknown as NonNullable<typeof nativeCapture>['addListener'])
  const recording: CaptureSnapshot = {
    manifest: {
      version: 1,
      sessionId: 'capture-test',
      language: 'en',
      state: 'recording',
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      frames: 0,
      segments: [],
      gaps: [],
      needsTranscription: false,
      startedAt: 1000,
    },
    directory: 'file:///documents/capture-test',
    volumeLevel: 0,
    cursor: 0,
  }
  const triggers = {
    'external-signal': () => controller.abort(),
    'app-inactive': () => handlers.get('change')?.('inactive'),
    'app-background': () => handlers.get('change')?.('background'),
    'memory-warning': () => handlers.get('memoryWarning')?.(),
    'recording-started': () => captureState?.(recording),
  }
  const saved: BenchmarkRun[] = []
  jest.mocked(saveBenchmarkRun).mockImplementation(async (run) => {
    saved.push(JSON.parse(JSON.stringify(run)) as BenchmarkRun)
  })
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    triggers[first]()
    for (const trigger of Object.values(triggers)) trigger()
    return 'Actual partial speech.'
  })
  try {
    await expect(runBenchmarkSuite({
      ...englishSmokeOptions(),
      signal: controller.signal,
      warmRepeats: 1,
    })).rejects.toThrow(/cancel/i)
    expect(saved).toHaveLength(2)
    for (const run of saved) {
      expect(run).toMatchObject({
        cancellationReason: first,
        source: 'Actual partial speech.',
        succeeded: false,
        error: expect.stringMatching(/cancel/i),
        sttQualityMs: 0,
      })
    }
    expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(1)
    expect(nativeCapture!.cancelTranscription).toHaveBeenCalledTimes(1)
    expect(processNoteWithLlm).not.toHaveBeenCalled()
    expect(cancelGeneration).toHaveBeenCalledWith('benchmark')
    expect(mockInfo).toBeNull()
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
  } finally {
    listener.mockRestore()
    jest.mocked(nativeCapture!.addListener).mockImplementation(subscribe)
    jest.mocked(saveBenchmarkRun).mockResolvedValue(undefined)
  }
})

test.each(['inactive', 'background'] as const)(
  'keeps initial %s cancellation outside queueing and durable runs',
  async (state) => {
    Object.defineProperty(AppState, 'currentState', {
      value: state,
      configurable: true,
      writable: true,
    })
    await expect(runBenchmarkSuite(options())).rejects.toThrow(/cancel/i)
    expect(enqueueLlm).not.toHaveBeenCalled()
    expect(saveBenchmarkRun).not.toHaveBeenCalled()
    expect(cancelGeneration).not.toHaveBeenCalled()
    expect(activateKeepAwakeAsync).not.toHaveBeenCalled()
  },
)

test('does not label a failed LLM parse as a lifecycle cancellation', async () => {
  jest.mocked(processNoteWithLlm).mockRejectedValue(new Error('Invalid JSON output'))
  const [run] = await runBenchmarkSuite({ ...options(), arms: ['qwen3'], warmRepeats: 0 })
  expect(run.error).toBe('Invalid JSON output')
  expect(run).not.toHaveProperty('cancellationReason')
  expect(run).not.toHaveProperty('sttRecognitionMs')
  expect(run).not.toHaveProperty('sttQualityMs')
})

test('persists a cancellation arriving during first persistence in the existing metadata write without extending the timing boundary', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  const controller = new AbortController()
  const saved: BenchmarkRun[] = []
  jest.mocked(saveBenchmarkRun).mockImplementation(async (run) => {
    saved.push(JSON.parse(JSON.stringify(run)) as BenchmarkRun)
    clock += saved.length === 1 ? 23 : 500
    if (saved.length === 1) controller.abort()
  })
  try {
    await expect(runBenchmarkSuite({
      ...options(),
      arms: ['qwen3'],
      signal: controller.signal,
    })).rejects.toThrow(/cancel/i)
    expect(saved).toHaveLength(2)
    expect(saved[0]).not.toHaveProperty('cancellationReason')
    expect(saved[1]).toMatchObject({
      cancellationReason: 'external-signal',
      persistMs: 23,
      totalMs: 23,
      timingBoundary: 'request-to-first-durable-benchmark-result',
    })
    expect(processNoteWithLlm).toHaveBeenCalledTimes(1)
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
  } finally {
    now.mockRestore()
    jest.mocked(saveBenchmarkRun).mockResolvedValue(undefined)
  }
})

test('cancels an in-flight audio request, persists the abort and releases suite resources', async () => {
  const controller = new AbortController()
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    controller.abort()
    return 'Must not be processed after cancellation.'
  })
  await expect(
    runBenchmarkSuite({ ...audioOptions(), signal: controller.signal }),
  ).rejects.toThrow(/cancel/i)
  expect(nativeCapture!.cancelTranscription).toHaveBeenCalledWith(
    expect.stringMatching(/^benchmark-speech-/),
  )
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      succeeded: false,
      error: expect.stringMatching(/cancel/i),
    }),
  )
  expect(processNoteWithLlm).not.toHaveBeenCalled()
  expect(mockInfo).toBeNull()
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
})

test('reports an unavailable native file recognizer as a durable audio failure', async () => {
  const module = jest.requireMock<typeof import('../stt/nativeCapture')>(
    '../stt/nativeCapture',
  )
  const native = jest.replaceProperty(module, 'nativeCapture', null)
  try {
    const [run] = await runBenchmarkSuite({
      ...audioOptions(),
      warmRepeats: 0,
      deviceLabel: undefined,
    })
    expect(run.error).toMatch(/unavailable/i)
    expect(run.source).toBe('')
    expect(run.audio?.status).toBe('failed')
    expect(run.environment.deviceLabelSource).toBe('automatic')
    expect(processNoteWithLlm).not.toHaveBeenCalled()
    expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
  } finally {
    native.restore()
  }
})

test('persists a missing audio fixture without falling back to text', async () => {
  jest
    .mocked(nativeCapture!.inspectAudio)
    .mockRejectedValueOnce(new Error('Audio file not found'))
  const [run] = await runBenchmarkSuite({
    ...audioOptions(),
    source: '',
    warmRepeats: 0,
  })
  expect(run).toMatchObject({
    error: 'Audio file not found',
    source: '',
    succeeded: false,
    llmMs: 0,
  })
  expect(run.audio?.durationMs).toBeNull()
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(loadModel).not.toHaveBeenCalled()
})

test('refuses network recognition when the English on-device model is unavailable', async () => {
  jest
    .mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition)
    .mockReturnValue(false)
  const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
  expect(run.error).toMatch(/on-device.*unavailable/i)
  expect(run.succeeded).toBe(false)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(processNoteWithLlm).not.toHaveBeenCalled()
})

test('allows English file recognition when the unrelated system-locale recognizer is unavailable', async () => {
  jest
    .mocked(ExpoSpeechRecognitionModule.isRecognitionAvailable)
    .mockReturnValue(false)
  jest
    .mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition)
    .mockReturnValue(true)
  const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
  expect(run).toMatchObject({
    source: 'Actual speech.',
    language: 'en',
    succeeded: true,
    error: null,
  })
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledWith(
    expect.any(String),
    0,
    42000,
    'en-US',
    expect.any(String),
  )
})

test('cancels an active STT request when the app leaves the foreground', async () => {
  const handlers = new Map<string, (state?: string) => void>()
  const subscriptions = [jest.fn(), jest.fn()]
  let index = 0
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    handler: (state?: string) => void,
  ) => {
    handlers.set(event, handler)
    return { remove: subscriptions[index++] }
  }) as typeof AppState.addEventListener)
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    handlers.get('change')?.('background')
    throw new Error('Transcription cancelled')
  })
  await expect(runBenchmarkSuite(audioOptions())).rejects.toThrow(/cancel/i)
  expect(nativeCapture!.cancelTranscription).toHaveBeenCalledTimes(1)
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(
    expect.objectContaining({
      error: 'Transcription cancelled',
      succeeded: false,
    }),
  )
  expect(subscriptions.every((remove) => remove.mock.calls.length === 1)).toBe(
    true,
  )
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1)
  expect(processNoteWithLlm).not.toHaveBeenCalled()
})

test('counts failed model loading separately from LLM processing after successful STT', async () => {
  let clock = 1000
  const now = jest.spyOn(Date, 'now').mockImplementation(() => clock)
  const load = jest.mocked(loadModel).getMockImplementation()!
  jest.mocked(nativeCapture!.transcribeWindow).mockImplementation(async () => {
    clock += 12
    return 'Actual speech.'
  })
  jest.mocked(loadModel).mockImplementation(async () => {
    clock += 18
    throw new Error('Load failed')
  })
  try {
    const [run] = await runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 })
    expect(run).toMatchObject({
      source: 'Actual speech.',
      sttMs: 12,
      modelLoadMs: 18,
      llmMs: 0,
      processingMs: 0,
      totalMs: 30,
      error: 'Load failed',
    })
    expect(run.audio?.status).toBe('complete')
    expect(processNoteWithLlm).not.toHaveBeenCalled()
  } finally {
    now.mockRestore()
    jest.mocked(loadModel).mockImplementation(load)
  }
})

test('does not start a native STT window if cancellation arrives from its progress callback', async () => {
  const controller = new AbortController()
  await expect(
    runBenchmarkSuite({
      ...audioOptions(),
      signal: controller.signal,
      onProgress: (message) => {
        if (message.startsWith('STT')) controller.abort()
      },
    }),
  ).rejects.toThrow(/cancel/i)
  expect(nativeCapture!.transcribeWindow).not.toHaveBeenCalled()
  expect(processNoteWithLlm).not.toHaveBeenCalled()
})

test('waits for a just-dismissed speech permission dialog to return active before starting the suite', async () => {
  const inactiveListener = deferred<(state?: string) => void>()
  jest
    .mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync)
    .mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      status: 'undetermined',
      expires: 'never',
    } as Awaited<
      ReturnType<
        typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync
      >
    >)
  jest
    .mocked(ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync)
    .mockImplementationOnce(async () => {
      Object.defineProperty(AppState, 'currentState', {
        value: 'inactive',
        configurable: true,
        writable: true,
      })
      return {
        granted: true,
        canAskAgain: true,
        status: 'granted',
        expires: 'never',
      } as Awaited<
        ReturnType<
          typeof ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync
        >
      >
    })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    handler: (state?: string) => void,
  ) => {
    if (event === 'change' && AppState.currentState === 'inactive')
      inactiveListener.resolve(handler)
    return { remove: jest.fn() }
  }) as typeof AppState.addEventListener)
  const suite = runBenchmarkSuite({ ...audioOptions(), warmRepeats: 0 }).catch(
    (failure: unknown) => failure,
  )
  const resume = await inactiveListener.promise
  try {
    expect(activateKeepAwakeAsync).not.toHaveBeenCalled()
    Object.defineProperty(AppState, 'currentState', {
      value: 'active',
      configurable: true,
      writable: true,
    })
    resume('active')
    const result = await suite
    expect(Array.isArray(result) && result[0].succeeded).toBe(true)
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      value: 'active',
      configurable: true,
      writable: true,
    })
    resume('active')
    await suite
  }
})

test.each(['abort', 'timeout'] as const)(
  'bounds the post-permission foreground wait and removes its listener on %s',
  async (condition) => {
    jest.useFakeTimers()
    const listening = deferred<void>()
    const remove = jest.fn()
    const controller = new AbortController()
    jest
      .mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync)
      .mockResolvedValueOnce({
        granted: false,
        canAskAgain: true,
        status: 'undetermined',
        expires: 'never',
      } as Awaited<
        ReturnType<
          typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync
        >
      >)
    jest
      .mocked(
        ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync,
      )
      .mockImplementationOnce(async () => {
        Object.defineProperty(AppState, 'currentState', {
          value: 'inactive',
          configurable: true,
          writable: true,
        })
        return {
          granted: true,
          canAskAgain: true,
          status: 'granted',
          expires: 'never',
        } as Awaited<
          ReturnType<
            typeof ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync
          >
        >
      })
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
      listening.resolve()
      return { remove }
    })
    const wait = prepareBenchmarkAudio('en-US', controller.signal)
    const assertion = expect(wait).rejects.toThrow(
      condition === 'abort' ? /cancel/i : /foreground/i,
    )
    try {
      await listening.promise
      if (condition === 'abort') controller.abort()
      else jest.advanceTimersByTime(5000)
      await assertion
      expect(remove).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      controller.abort()
      await wait.catch(() => undefined)
      jest.useRealTimers()
      Object.defineProperty(AppState, 'currentState', {
        value: 'active',
        configurable: true,
        writable: true,
      })
    }
  },
)

test('shares a completed task evidence memo between note processing and its task proposal in one run', async () => {
  const completed = new WeakMap<
    object,
    { tasks: string[]; warnings: string[] }
  >()
  jest
    .mocked(processNoteWithLlm)
    .mockImplementation(
      async (_source, _progress, _load, _language, execution) => {
        if (!execution?.taskEvidenceMemo)
          throw new Error('Task evidence memo missing')
        completed.set(execution.taskEvidenceMemo, {
          tasks: ['Send the schedule to Anna.'],
          warnings: ['Task uncertainty preserved.'],
        })
        emit()
        return {
          title: 'Schedule',
          summary: 'Send the schedule to Anna.',
          tags: [],
        }
      },
    )
  jest
    .mocked(extractTasks)
    .mockImplementation(async (_source, _status, _language, execution) => {
      const memo = (execution as ProcessingExecutionContext | undefined)
        ?.taskEvidenceMemo
      const final = memo && completed.get(memo)
      if (!final) throw new Error('Completed note task evidence was not shared')
      for (const warning of final.warnings) execution?.onWarning?.(warning)
      return final.tasks
    })
  const [run] = await runBenchmarkSuite({
    ...options(),
    arms: ['qwen3'],
    warmRepeats: 0,
  })
  expect(run.error).toBeNull()
  expect(run.output).toMatchObject({
    tasks: ['Send the schedule to Anna.'],
    warnings: ['Task uncertainty preserved.'],
  })
  expect(run.succeeded).toBe(false)
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(run)
})

test('creates a fresh task evidence memo for each cold and warm audio run', async () => {
  const completed = new WeakMap<object, string[]>()
  const scopes = new Set<object>()
  jest
    .mocked(nativeCapture!.transcribeWindow)
    .mockResolvedValueOnce('Alice will send the first schedule.')
    .mockResolvedValueOnce('Bob will send the second schedule.')
  jest
    .mocked(processNoteWithLlm)
    .mockImplementation(
      async (source, _progress, _load, _language, execution) => {
        if (!execution?.taskEvidenceMemo)
          throw new Error('Task evidence memo missing')
        if (scopes.has(execution.taskEvidenceMemo))
          throw new Error('Task evidence memo leaked between runs')
        scopes.add(execution.taskEvidenceMemo)
        completed.set(execution.taskEvidenceMemo, [source])
        emit()
        return { title: 'Schedule', summary: source, tags: [] }
      },
    )
  jest
    .mocked(extractTasks)
    .mockImplementation(async (_source, _status, _language, execution) => {
      const memo = (execution as ProcessingExecutionContext | undefined)
        ?.taskEvidenceMemo
      const final = memo && completed.get(memo)
      if (!final) throw new Error('Completed note task evidence was not shared')
      return final
    })
  const runs = await runBenchmarkSuite(audioOptions())
  expect(
    runs.map((run) => [run.condition, run.output?.tasks, run.error]),
  ).toEqual([
    ['cold', ['Alice will send the first schedule.'], null],
    ['warm', ['Bob will send the second schedule.'], null],
  ])
  expect(scopes.size).toBe(2)
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(2)
  expect(runs.every((run) => run.succeeded)).toBe(true)
})

test('persists low-WER lost-owner critical diagnostics while still processing exact actual speech', async () => {
  const actual = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts. Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running. Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review"
  const reference = ENGLISH_AUDIO_FIXTURE_DATA['en-audio-3min-v1'].referenceTranscript
  jest.mocked(nativeCapture!.transcribeWindow).mockResolvedValue(actual)
  const runs = await runBenchmarkSuite({ ...audioOptions(), fixtureId: 'en-audio-3min-v1',
    audioFixture: { ...audioOptions().audioFixture!, referenceTranscript: reference } })
  expect(runs.map((run) => run.condition)).toEqual(['cold', 'warm'])
  for (const run of runs) {
    expect(run.source).toBe(actual)
    expect(run.audio?.transcript).toBe(actual)
    expect(run.audio?.completeness).toMatchObject({ wordErrorRate: 16 / 421, reviewRequired: true,
      criticalFacts: { method: 'riverside-critical-phrases-v1', required: 8, preserved: 7, missing: ['maya_outline_thursday'] } })
    expect(run.output?.warnings).toEqual([expect.stringMatching(/speech transcript needs review.*7\/8/i)])
    expect(run.output?.warnings.join(' ')).not.toContain('maya_outline_thursday')
    expect(run.succeeded).toBe(false)
    expect(run.error).toBeNull()
    expect(run.assessment).toMatchObject({ faithfulSummary: null, completeTasks: null, acceptableLanguage: null })
  }
  expect(nativeCapture!.transcribeWindow).toHaveBeenCalledTimes(2)
  expect(processNoteWithLlm).toHaveBeenCalledWith(actual, expect.any(Function), undefined, 'en', expect.any(Object))
  expect(extractTasks).toHaveBeenCalledWith(actual, expect.any(Function), 'en', expect.any(Object))
  expect(saveBenchmarkRun).toHaveBeenLastCalledWith(runs[1])
})


test('clears retained source plans before every cold and warm benchmark sample', async () => {
  const seenClears: number[] = []
  const original = jest.mocked(processNoteWithLlm).getMockImplementation()!
  jest.mocked(processNoteWithLlm).mockImplementation(async (...args) => {
    seenClears.push(jest.mocked(clearSourcePlanCache).mock.calls.length)
    return original(...args)
  })
  const runs = await runBenchmarkSuite(options())
  expect(runs).toHaveLength(6)
  expect(seenClears).toEqual([1, 2, 3, 4, 5, 6])
  expect(clearSourcePlanCache).toHaveBeenCalledTimes(6)
})
