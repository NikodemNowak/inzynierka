import { AppState } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { prepareBenchmarkAudio } from '../ai/benchmarkAudio'
import { verifyFileNatively } from '../ai/nativeFileVerification'
import { enqueueLlm } from '../ai/llmQueue'
import { nativeCapture, NativeSpeechWindowError, type CaptureSnapshot, type NativeSpeechWindowDiagnostics } from './nativeCapture'
import { planSpeechBenchmarkWindows, runSpeechWindowBenchmarkSuite, type SpeechWindowBenchmarkOptions, type SpeechWindowBenchmarkReport } from './speechWindowBenchmark'

jest.mock('../ai/benchmarkAudio', () => ({ prepareBenchmarkAudio: jest.fn(async () => undefined) }))
jest.mock('../ai/nativeFileVerification', () => ({ verifyFileNatively: jest.fn() }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: jest.fn(async (job: () => Promise<unknown>) => job()) }))
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }))
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 32044 })),
  writeAsStringAsync: jest.fn(async () => undefined), moveAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []), readAsStringAsync: jest.fn(),
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn() }))
jest.mock('./nativeCapture', () => {
  const actual = jest.requireActual<typeof import('./nativeCapture')>('./nativeCapture')
  return {
    ...actual,
    nativeCapture: {
      getSnapshot: jest.fn(async () => null), inspectAudio: jest.fn(),
      getSpeechCapabilities: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })),
      cancelTranscription: jest.fn(async () => undefined),
      transcribeWindowWithDiagnostics: jest.fn(), transcribeWindowWithBackend: jest.fn(),
    },
  }
})

const source = 'Pierwsza fraza źródła Ala przygotuje raport w czwartek. Nie kupujemy nowych kamer. Ostatnia fraza źródła.'
const { createHash } = jest.requireActual<{ createHash: (algorithm: string) => { update: (text: string) => { digest: (encoding: string) => string } } }>('crypto')
const options = (): SpeechWindowBenchmarkOptions => ({
  fixtureId: 'synthetic-contract-test', fixture: {
    uri: 'file:///bundle/fixture.wav', locale: 'en-US', provenance: 'synthetic-audio',
    referenceTranscript: source, audioSha256: 'a'.repeat(64), bundled: true, expectedDurationMs: 1000,
  },
})
const diagnostic = (startMs: number, durationMs: number, backend: 'recognizer' | 'analyzer' = 'recognizer'): NativeSpeechWindowDiagnostics => ({
  version: 1, requestedStartMs: startMs, requestedDurationMs: durationMs,
  decodedFrames: durationMs * 16, decodedDurationMs: durationMs, decodedSampleRate: 16000,
  callbackCount: 1, finalCallbackCount: 1, finalLikeCallbackCount: 1,
  untimedCallbackCount: 0, mergedSegmentCount: 1, callbacksTruncated: false, callbacks: [],
  backend, recognitionMs: 40, decodeMs: 1, setupMs: 2, ...(backend === 'analyzer' ? { finalizedThroughMs: durationMs } : {}),
})
const result = (startMs = 0, durationMs = 1000) => ({ transcript: source, diagnostics: diagnostic(startMs, durationMs) })
const savedReports = (): SpeechWindowBenchmarkReport[] => jest.mocked(FileSystem.writeAsStringAsync).mock.calls
  .filter(([path]) => /stt-window-benchmarks\/stt-suite-[^/]+\.json\.part$/.test(path))
  .map(([, json]) => JSON.parse(json) as SpeechWindowBenchmarkReport)
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const flush = async (): Promise<void> => { for (let n = 0; n < 30; n++) await Promise.resolve() }
let states: ((state: string) => void)[] = []
let memory: (() => void)[] = []
let captureListener: ((snapshot: CaptureSnapshot) => void) | undefined

beforeEach(() => {
  jest.clearAllMocks()
  states = []; memory = []; captureListener = undefined
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((name: string, callback: (state: string) => void) => {
    if (name === 'change') states.push(callback)
    else memory.push(callback as () => void)
    return { remove: jest.fn() }
  }) as typeof AppState.addEventListener)
  jest.mocked(nativeCapture!.getSnapshot).mockResolvedValue(null)
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 1000, sampleRate: 16000, channels: 1 })
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue({
    version: 1, analyzerAvailable: true, supportedLocales: ['en_US'], installedLocales: ['en_US'], locales: {
      'en-US': { recognizerAvailable: true, recognizerOnDevice: true, analyzerSupported: true, analyzerInstalled: false,
        analyzerReadiness: { requestedLocale: 'en-US', resolvedLocale: 'en_US', deviceAvailable: true,
          localeSupported: true, localeInstalled: true, assetStatus: 'supported', ready: false, fallbackReason: 'analyzer-assets-not-ready' } },
    },
  })
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockImplementation(async (_uri, start, duration) => result(start, duration))
  jest.mocked(nativeCapture!.transcribeWindowWithBackend!).mockImplementation(async (_uri, start, duration) => ({
    ...result(start, duration), diagnostics: { ...diagnostic(start, duration), requestedBackend: 'analyzer-if-installed', fallbackReason: 'analyzer-assets-not-ready',
      analyzerReadiness: { requestedLocale: 'en-US', deviceAvailable: true, localeSupported: true, localeInstalled: true, assetStatus: 'supported', ready: false } },
  }))
  jest.mocked(nativeCapture!.addListener).mockImplementation(((name: string, callback: (snapshot: CaptureSnapshot) => void) => {
    if (name === 'captureState') captureListener = callback
    return { remove: jest.fn() }
  }) as unknown as NonNullable<typeof nativeCapture>['addListener'])
  jest.mocked(verifyFileNatively).mockResolvedValue({ sha256: 'a'.repeat(64), sizeBytes: 32044, durationMs: 4 })
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: true, isDirectory: false, size: 32044, modificationTime: 0, uri: options().fixture.uri })
  jest.mocked(enqueueLlm).mockImplementation(async (job) => job())
  jest.mocked(prepareBenchmarkAudio).mockResolvedValue(undefined)
  jest.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined)
  jest.mocked(FileSystem.moveAsync).mockResolvedValue(undefined)
  jest.mocked(FileSystem.copyAsync).mockResolvedValue(undefined)
})
afterEach(() => { jest.restoreAllMocks() })

test.each([30000, 55000, 60000] as const)('plans exact contiguous source coverage with positive EOF at %ims', (size) => {
  for (const duration of [1, size, size + 1, 1781630, 1800000]) {
    const plan = planSpeechBenchmarkWindows(duration, size)
    expect(plan[0].startMs).toBe(0)
    expect(plan.every((window, index) => window.durationMs > 0 && window.durationMs <= size && (index === 0 || window.startMs === plan[index - 1].startMs + plan[index - 1].durationMs))).toBe(true)
    expect(plan.reduce((sum, window) => sum + window.durationMs, 0)).toBe(duration)
    expect(plan.at(-1)!.startMs + plan.at(-1)!.durationMs).toBe(duration)
  }
})
test.each([0, -1, NaN, Infinity, 1800001])('rejects invalid source duration %s instead of creating a zero checkpoint', (duration) => {
  expect(() => planSpeechBenchmarkWindows(duration, 60000)).toThrow()
})
test('counterbalances all six native-only arms and pins actual audio and UTF-8 source hashes', async () => {
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.status).toBe('complete')
  expect(report.order).toEqual([30000, 55000, 60000, 60000, 55000, 30000])
  expect(report.arms.map((arm) => [arm.pass, arm.windowDurationMs, arm.status])).toEqual([
    [1, 30000, 'complete'], [1, 55000, 'complete'], [1, 60000, 'complete'],
    [2, 60000, 'complete'], [2, 55000, 'complete'], [2, 30000, 'complete'],
  ])
  expect(report.resumed).toBe(false)
  expect(report.sourceIdentity).toMatchObject({ actualSha256: 'a'.repeat(64), expectedSha256: 'a'.repeat(64), referenceSha256: createHash('sha256').update(source).digest('hex') })
  expect(report.arms.every((arm) => arm.transcriptSha256 === createHash('sha256').update(source).digest('hex'))).toBe(true)
  expect(report.arms.every((arm) => arm.quality?.wordErrorRate === 0 && arm.boundaryPhrases?.firstPreserved && arm.boundaryPhrases.lastPreserved)).toBe(true)
  expect(report.comparisons).toHaveLength(4)
  expect(report.comparisons.every((item) => item.sameActualBackend && item.noNewLexicalRegression)).toBe(true)
  expect(savedReports().at(-1)).toMatchObject({ status: 'complete', resumed: false })
  expect(jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mock.calls.every((args) => args.length === 5 && !args.includes(source))).toBe(true)
  expect(nativeCapture!.transcribeWindowWithBackend).not.toHaveBeenCalled()
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: options().fixture.uri, to: report.sourceIdentity?.preparedUri })
  expect(report.sourceIdentity?.preparedUri).toMatch(/^file:\/\/\/documents\/stt-window-benchmarks\/stt-suite-[^/]+\/source\.wav$/)
  expect(verifyFileNatively).toHaveBeenCalledWith(report.sourceIdentity?.preparedUri, 32044, 'a'.repeat(64), expect.any(AbortSignal))
  expect(jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mock.calls.every((args) => args[0] === report.sourceIdentity?.preparedUri)).toBe(true)
  expect(enqueueLlm).toHaveBeenCalledTimes(1)
  expect(activateKeepAwakeAsync).toHaveBeenCalledWith(report.id)
  expect(deactivateKeepAwake).toHaveBeenCalledWith(report.id)
})
test('recognizes all requested ranges at 55s boundary and exact minute EOF without reuse', async () => {
  const input = options(); input.fixture.expectedDurationMs = 60000
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 60000, sampleRate: 16000, channels: 1 })
  const report = await runSpeechWindowBenchmarkSuite(input)
  expect(report.arms.map((arm) => arm.windows.map((window) => [window.startMs, window.durationMs]))).toEqual([
    [[0, 30000], [30000, 30000]], [[0, 55000], [55000, 5000]], [[0, 60000]],
    [[0, 60000]], [[0, 55000], [55000, 5000]], [[0, 30000], [30000, 30000]],
  ])
  expect(report.arms.every((arm) => arm.completedDurationMs === 60000)).toBe(true)
  expect(report.arms.map((arm) => arm.nativeRecognitionMs)).toEqual([80, 80, 40, 40, 80, 80])
  expect(report.arms.map((arm) => arm.nativeDecodeMs)).toEqual([2, 2, 1, 1, 2, 2])
})
test('retains installed-locale membership plus nonready AssetInventory fallback in every actual request', async () => {
  const report = await runSpeechWindowBenchmarkSuite({ ...options(), speechBackend: 'analyzer-if-installed' })
  expect(report.capabilities?.locales['en-US']).toMatchObject({ analyzerInstalled: false, analyzerReadiness: { localeInstalled: true, assetStatus: 'supported', ready: false } })
  expect(report.arms.every((arm) => arm.windows.every((window) => window.diagnostics?.backend === 'recognizer' && window.diagnostics.fallbackReason === 'analyzer-assets-not-ready' && window.diagnostics.analyzerReadiness?.localeInstalled))).toBe(true)
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
  expect(jest.mocked(nativeCapture!.transcribeWindowWithBackend!).mock.calls.every((args) => args.length === 6 && args.at(-1) === 'analyzer-if-installed' && !args.includes(source))).toBe(true)
})
test.each(['success', 'reject'] as const)('cancelled native %s cannot publish a late completed transcript', async (kind) => {
  const controller = new AbortController()
  const pending = deferred<ReturnType<typeof result>>()
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockReturnValueOnce(pending.promise)
  const task = runSpeechWindowBenchmarkSuite({ ...options(), signal: controller.signal })
  await flush()
  expect(nativeCapture!.transcribeWindowWithDiagnostics).toHaveBeenCalledTimes(1)
  controller.abort()
  await flush()
  if (kind === 'success') pending.resolve(result())
  else pending.reject(new NativeSpeechWindowError('late interrupted', 'Late partial text', diagnostic(0, 1000)))
  const report = await task
  expect(report.status).toBe('cancelled')
  expect(report.arms[0]).toMatchObject({ status: 'cancelled', transcript: '', completedDurationMs: 0, windows: [{ status: 'cancelled', transcript: '' }] })
  expect(report.arms[0].quality).toBeUndefined()
  expect(nativeCapture!.cancelTranscription).toHaveBeenCalledTimes(1)
  expect(report.comparisons).toEqual([])
  expect(savedReports().at(-1)?.status).toBe('cancelled')
})
test('preserves completed window receipts and error partial source, then fresh retry starts at zero', async () => {
  const input = options(); input.fixture.expectedDurationMs = 60001
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 60001, sampleRate: 16000, channels: 1 })
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValueOnce(result(0, 30000)).mockRejectedValueOnce(new NativeSpeechWindowError('interrupted', 'Observed unfinished words', diagnostic(30000, 30000)))
  const failed = await runSpeechWindowBenchmarkSuite(input)
  expect(failed.status).toBe('failed')
  expect(failed.arms[0]).toMatchObject({ completedDurationMs: 30000, transcript: source, windows: [{ status: 'complete' }, { status: 'failed', transcript: '', partialTranscript: 'Observed unfinished words' }] })
  expect(failed.arms[0].quality).toBeUndefined()
  expect(failed.arms).toHaveLength(1)
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockClear()
  const retry = await runSpeechWindowBenchmarkSuite(input)
  expect(retry.status).toBe('complete')
  expect(retry.id).not.toBe(failed.id)
  expect(retry.resumed).toBe(false)
  expect(jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mock.calls[0].slice(1, 3)).toEqual([0, 30000])
})
test.each(['app-inactive', 'app-background', 'memory-warning', 'recording-started'] as const)('protects foreground/writer ownership on %s', async (reason) => {
  const pending = deferred<ReturnType<typeof result>>()
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockReturnValueOnce(pending.promise)
  const task = runSpeechWindowBenchmarkSuite(options())
  await flush()
  if (reason === 'app-inactive') states.forEach((callback) => callback('inactive'))
  else if (reason === 'app-background') states.forEach((callback) => callback('background'))
  else if (reason === 'memory-warning') memory.forEach((callback) => callback())
  else captureListener?.({ manifest: { state: 'recording' } } as CaptureSnapshot)
  pending.resolve(result())
  const report = await task
  expect(report).toMatchObject({ status: 'cancelled', cancellationReason: reason })
  expect(report.arms[0].transcript).toBe('')
  expect(nativeCapture!.transcribeWindowWithDiagnostics).toHaveBeenCalledTimes(1)
})
test('refuses an already active writer and never creates a native speech request', async () => {
  jest.mocked(nativeCapture!.getSnapshot).mockResolvedValue({ manifest: { state: 'recording' } } as CaptureSnapshot)
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report).toMatchObject({ status: 'cancelled', cancellationReason: 'recording-started', arms: [] })
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
  expect(verifyFileNatively).not.toHaveBeenCalled()
})
test('abort before preflight and permission denial never launch native or verification', async () => {
  const controller = new AbortController(); controller.abort()
  const cancelled = await runSpeechWindowBenchmarkSuite({ ...options(), signal: controller.signal })
  expect(cancelled.status).toBe('cancelled')
  expect(prepareBenchmarkAudio).not.toHaveBeenCalled()
  jest.mocked(prepareBenchmarkAudio).mockRejectedValueOnce(new Error('permission denied'))
  const denied = await runSpeechWindowBenchmarkSuite(options())
  expect(denied).toMatchObject({ status: 'failed', error: 'permission denied', arms: [] })
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
  expect(verifyFileNatively).not.toHaveBeenCalled()
})
test.each(['missing', 'wrong-hash', 'wrong-size'] as const)('does not measure audio with %s pinned identity', async (kind) => {
  if (kind === 'missing') jest.mocked(verifyFileNatively).mockResolvedValueOnce(null)
  else jest.mocked(verifyFileNatively).mockResolvedValueOnce({ sha256: kind === 'wrong-hash' ? 'b'.repeat(64) : 'a'.repeat(64), sizeBytes: kind === 'wrong-size' ? 4 : 32044, durationMs: 4 })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.status).toBe('failed')
  expect(report.arms).toEqual([])
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
})
test('marks a changed actual backend as incomparable even if both transcripts match', async () => {
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValueOnce(result())
    .mockResolvedValueOnce({ transcript: source, diagnostics: diagnostic(0, 1000, 'analyzer') })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.comparisons[0]).toMatchObject({ sameActualBackend: false, noNewLexicalRegression: true })
})
test('missing coverage diagnostics fail before final text, completedDuration or quality can be accepted', async () => {
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValue({ transcript: source })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report).toMatchObject({ status: 'failed', arms: [{ status: 'failed', transcript: '', completedDurationMs: 0,
    error: 'Native speech coverage diagnostics are missing', windows: [{ status: 'failed', transcript: '', partialTranscript: source }] }] })
  expect(report.arms[0].quality).toBeUndefined()
  expect(report.comparisons).toEqual([])
  expect(savedReports().at(-1)).toMatchObject({ status: 'failed' })
})
test('missing optional timers with full frame/final coverage proof remain unknown rather than zero', async () => {
  const proof = diagnostic(0, 1000)
  delete proof.recognitionMs; delete proof.decodeMs; delete proof.setupMs
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValue({ transcript: source, diagnostics: proof })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.status).toBe('complete')
  expect(report.arms.every((arm) => arm.nativeRecognitionMs === null && arm.nativeDecodeMs === null && arm.nativeSetupMs === null)).toBe(true)
  expect(report.comparisons.every((item) => item.sameActualBackend && item.nativeRecognitionDeltaMs === null)).toBe(true)
})
test('build7 capability shape remains usable and explicitly marks detailed readiness as not reported', async () => {
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue({
    version: 1, analyzerAvailable: true, supportedLocales: ['en_US'], installedLocales: ['en_US'], locales: {
      'en-US': { recognizerAvailable: true, recognizerOnDevice: true, analyzerSupported: true, analyzerInstalled: false },
    },
  })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report).toMatchObject({ status: 'complete', nativeReadinessDiagnostics: 'not-reported', capabilities: {
    installedLocales: ['en_US'], locales: { 'en-US': { analyzerInstalled: false } },
  } })
  expect(report.capabilities?.locales['en-US']).not.toHaveProperty('analyzerReadiness')
  expect(report.arms.every((arm) => arm.windows.every((window) => window.diagnostics?.analyzerReadiness === undefined))).toBe(true)
})

test.each(['requested-range', 'no-final', 'decode-gap', 'invalid-range'] as const)('rejects incomplete native %s evidence without accepting its source as final', async (kind) => {
  const proof = diagnostic(0, 1000)
  if (kind === 'requested-range') proof.requestedStartMs = 55000
  else if (kind === 'no-final') proof.finalCallbackCount = 0
  else if (kind === 'decode-gap') proof.decodedFrames = 8000
  else proof.requestedDurationMs = NaN
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValueOnce({ transcript: source, diagnostics: proof })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.status).toBe('failed')
  expect(report.arms[0]).toMatchObject({ status: 'failed', transcript: '', completedDurationMs: 0, windows: [{ status: 'failed', transcript: '', partialTranscript: source }] })
  expect(report.arms[0].quality).toBeUndefined()
})
test('abort while waiting for the heavy queue promptly releases the benchmark without cancelling another job', async () => {
  const controller = new AbortController()
  const queued = deferred<void>()
  jest.mocked(enqueueLlm).mockImplementationOnce(async (job) => { await queued.promise; return job() })
  const task = runSpeechWindowBenchmarkSuite({ ...options(), signal: controller.signal })
  await flush()
  expect(enqueueLlm).toHaveBeenCalledTimes(1)
  controller.abort()
  const report = await task
  expect(report.status).toBe('cancelled')
  expect(report.arms).toEqual([])
  expect(nativeCapture!.cancelTranscription).not.toHaveBeenCalled()
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
  expect(deactivateKeepAwake).toHaveBeenCalledWith(report.id)
  const savedBeforeDrain = jest.mocked(FileSystem.writeAsStringAsync).mock.calls.length
  queued.resolve()
  await flush()
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
  expect(nativeCapture!.getSnapshot).not.toHaveBeenCalled()
  expect(verifyFileNatively).not.toHaveBeenCalled()
  expect(FileSystem.copyAsync).not.toHaveBeenCalled()
  expect(jest.mocked(FileSystem.writeAsStringAsync).mock.calls.length).toBe(savedBeforeDrain)
})
test('stop during a durable window receipt preserves only that completed prefix and starts no next window', async () => {
  const controller = new AbortController()
  const input = options(); input.fixture.expectedDurationMs = 60000
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 60000, sampleRate: 16000, channels: 1 })
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path) => {
    if (path.includes('-window-0.json.part')) controller.abort()
  })
  const report = await runSpeechWindowBenchmarkSuite({ ...input, signal: controller.signal })
  expect(report).toMatchObject({ status: 'cancelled', arms: [{ status: 'cancelled', completedDurationMs: 30000, transcript: source, windows: [{ status: 'complete' }] }] })
  expect(nativeCapture!.transcribeWindowWithDiagnostics).toHaveBeenCalledTimes(1)
  expect(report.arms[0].quality).toBeUndefined()
})
test('a writer that starts before the second window prevents that request and keeps the first receipt', async () => {
  const input = options(); input.fixture.expectedDurationMs = 60000
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 60000, sampleRate: 16000, channels: 1 })
  jest.mocked(nativeCapture!.getSnapshot).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ manifest: { state: 'recording' } } as CaptureSnapshot)
  const report = await runSpeechWindowBenchmarkSuite(input)
  expect(report).toMatchObject({ status: 'cancelled', cancellationReason: 'recording-started', arms: [{ completedDurationMs: 30000 }] })
  expect(nativeCapture!.transcribeWindowWithDiagnostics).toHaveBeenCalledTimes(1)
})

const riverside = 'These are the planning notes for the Riverside community podcast. Maya will prepare the first episode outline by Thursday. Daniel will contact the guest speaker by Tuesday. Nora will send the updated guest list to Maya before Wednesday. The north studio reservation was canceled so we must use the south studio for the recording. The final approved production budget is 1450 dollars. This final amount replaces the earlier budget of 900 dollars. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at 2 in the afternoon.'
test.each([
  ['Maya', 'my', 'maya_outline_thursday'],
  ['Nora', 'Norma', 'nora_guestlist_maya_wednesday'],
  ['1450', '1540', 'final_budget_replacement'],
  ['must not buy', 'must buy', 'existing_microphones_no_cameras'],
  ['November 8', 'November 9', 'editorial_review_date_time'],
])('flags the literal obligation change %s→%s despite completed audio coverage', async (before, after, missing) => {
  const input = options(); input.fixture.referenceTranscript = riverside; input.fixtureId = 'en-audio-30min-v1'
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockImplementation(async (_uri, start, duration, _locale, requestId) => ({
    transcript: requestId.includes('-arm-1-window-') || requestId.includes('-arm-4-window-') ? riverside.replace(before, after) : riverside,
    diagnostics: diagnostic(start, duration),
  }))
  const report = await runSpeechWindowBenchmarkSuite(input)
  expect(report.status).toBe('complete')
  expect(report.arms[0].quality?.criticalFacts?.missing).toEqual([])
  expect(report.arms[1].quality?.criticalFacts?.missing).toContain(missing)
  expect(report.comparisons.filter((item) => item.candidateId.endsWith('-arm-1') || item.candidateId.endsWith('-arm-4')).every((item) => item.noNewLexicalRegression === false)).toBe(true)
  expect(jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mock.calls.every((args) => !args.includes(riverside))).toBe(true)
})
test.each(['first', 'last'] as const)('keeps %s phrase loss visible instead of deleting it from the comparison', async (side) => {
  const incomplete = side === 'first' ? source.slice(source.indexOf('Ala')) : source.slice(0, source.lastIndexOf('Ostatnia'))
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockResolvedValueOnce(result()).mockResolvedValueOnce({ transcript: incomplete, diagnostics: diagnostic(0, 1000) })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.arms[1].boundaryPhrases?.[side === 'first' ? 'firstPreserved' : 'lastPreserved']).toBe(false)
  expect(report.comparisons[0].noNewLexicalRegression).toBe(false)
})

test('source copy and pinned hash costs remain outside every measured arm', async () => {
  let clock = 100000
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(FileSystem.copyAsync).mockImplementation(async () => { clock += 200 })
  jest.mocked(verifyFileNatively).mockImplementation(async () => {
    clock += 100
    return { sha256: 'a'.repeat(64), sizeBytes: 32044, durationMs: 100 }
  })
  jest.mocked(nativeCapture!.transcribeWindowWithDiagnostics).mockImplementation(async (_uri, start, duration) => {
    clock += 10
    return result(start, duration)
  })
  jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path) => {
    if (path.includes('-window-0.json.part')) clock += 5
  })
  const report = await runSpeechWindowBenchmarkSuite(options())
  expect(report.sourceIdentity).toMatchObject({ preparationMs: 200, verificationMs: 100 })
  expect(report.arms.every((arm) => arm.nativeRequestWallMs === 10 && arm.wallMs === 15 && arm.windowReceiptWriteMs === 5)).toBe(true)
})
test('a cancelled source-copy completion cannot launch hashing or speech later', async () => {
  const controller = new AbortController()
  const copy = deferred<void>()
  jest.mocked(FileSystem.copyAsync).mockReturnValueOnce(copy.promise)
  const task = runSpeechWindowBenchmarkSuite({ ...options(), signal: controller.signal })
  await flush()
  expect(FileSystem.copyAsync).toHaveBeenCalledTimes(1)
  controller.abort()
  copy.resolve()
  const report = await task
  expect(report).toMatchObject({ status: 'cancelled', arms: [], sourceIdentity: null })
  expect(verifyFileNatively).not.toHaveBeenCalled()
  expect(nativeCapture!.transcribeWindowWithDiagnostics).not.toHaveBeenCalled()
})

test.each([
  ['write', 0], ['move', 0], ['write', 1], ['move', 1],
] as const)('receipt %s failure at window %i retains only the earlier committed prefix and never emits complete', async (operation, failIndex) => {
  const input = options(); input.fixture.expectedDurationMs = 60000
  jest.mocked(nativeCapture!.inspectAudio).mockResolvedValue({ durationMs: 60000, sampleRate: 16000, channels: 1 })
  const matchesReceipt = (path: string): boolean => path.includes(`-arm-0-window-${failIndex}.json`)
  if (operation === 'write') jest.mocked(FileSystem.writeAsStringAsync).mockImplementation(async (path) => {
    if (matchesReceipt(path)) throw new Error('receipt disk write failed')
  })
  else jest.mocked(FileSystem.moveAsync).mockImplementation(async ({ to }) => {
    if (matchesReceipt(to)) throw new Error('receipt disk move failed')
  })
  const published: SpeechWindowBenchmarkReport[] = []
  const report = await runSpeechWindowBenchmarkSuite({ ...input, onResult: (value) => {
    published.push(JSON.parse(JSON.stringify(value)) as SpeechWindowBenchmarkReport)
  } })
  expect(report).toMatchObject({ status: 'failed', arms: [{ status: 'failed', completedDurationMs: failIndex * 30000,
    transcript: failIndex === 0 ? '' : source }] })
  expect(report.arms[0].windows[failIndex]).toMatchObject({ status: 'failed', transcript: '', partialTranscript: source,
    error: `Speech window receipt could not be committed: receipt disk ${operation} failed` })
  expect(report.arms[0].quality).toBeUndefined()
  expect(report.comparisons).toEqual([])
  expect(nativeCapture!.transcribeWindowWithDiagnostics).toHaveBeenCalledTimes(failIndex + 1)
  expect(published.every((value) => value.status !== 'complete' && value.arms.every((arm) => arm.status !== 'complete'))).toBe(true)
  expect(savedReports().every((value) => value.status !== 'complete' && value.arms.every((arm) => arm.status !== 'complete'))).toBe(true)
})
