import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { prepareBenchmarkAudio } from '../ai/benchmarkAudio'
import { evaluateBenchmarkAudioQuality } from '../ai/benchmarkAudioQuality'
import type { BenchmarkAudioCompleteness, BenchmarkAudioFixture } from '../ai/benchmarkTypes'
import { verifyFileNatively } from '../ai/nativeFileVerification'
import { enqueueLlm } from '../ai/llmQueue'
import { Sha256 } from '../ai/sha256'
import { validateImportDuration } from '../audio/captureManifest'
import {
  nativeCapture, NativeSpeechWindowError,
  type NativeSpeechCapabilities, type NativeSpeechWindowDiagnostics, type SpeechBackend,
} from './nativeCapture'

export const SPEECH_BENCHMARK_WINDOWS = [30000, 55000, 60000] as const
type WindowDuration = typeof SPEECH_BENCHMARK_WINDOWS[number]
type Status = 'running' | 'complete' | 'failed' | 'cancelled'
type CancellationReason = 'external-signal' | 'app-inactive' | 'app-background' | 'memory-warning' | 'recording-started'

export interface SpeechBenchmarkWindow {
  index: number
  requestId: string
  startMs: number
  durationMs: number
  status: 'complete' | 'failed' | 'cancelled'
  transcript: string
  // Observed error text is evidence only, never a completed source window.
  partialTranscript?: string
  error?: string
  wallMs: number
  diagnostics?: NativeSpeechWindowDiagnostics
}
export interface SpeechBenchmarkArm {
  id: string
  pass: 1 | 2
  orderIndex: number
  windowDurationMs: WindowDuration
  requestedBackend: SpeechBackend
  status: Status
  startedAt: number
  endedAt?: number
  // Start through last native request and durable window receipt. Scoring and
  // final report serialization are separately timed and excluded here.
  wallMs: number
  nativeRequestWallMs: number
  windowReceiptWriteMs: number
  qualityMs: number
  nativeRecognitionMs: number | null
  nativeDecodeMs: number | null
  nativeSetupMs: number | null
  completedDurationMs: number
  transcript: string
  transcriptSha256?: string
  windows: SpeechBenchmarkWindow[]
  quality?: BenchmarkAudioCompleteness
  boundaryPhrases?: { first: string; last: string; firstPreserved: boolean; lastPreserved: boolean }
  error?: string
}
export interface SpeechBenchmarkComparison {
  pass: 1 | 2
  baselineId: string
  candidateId: string
  noNewLexicalRegression: boolean | null
  sameActualBackend: boolean
  nativeRequestWallDeltaMs: number
  nativeRecognitionDeltaMs: number | null
}
export interface SpeechWindowBenchmarkReport {
  version: 1
  kind: 'stt-window-ab-v1'
  id: string
  createdAt: number
  endedAt?: number
  status: Status
  fixtureId: string
  deviceLabel: string
  environment: { platform: string; osVersion: string; nativeAppVersion: string | null; nativeBuildVersion: string | null; execution: 'foreground' }
  requireOnDeviceRecognition: true
  fixture: BenchmarkAudioFixture
  sourceIdentity: { originalUri: string; preparedUri: string; preparationMs: number; expectedSha256: string; actualSha256: string; sizeBytes: number; verificationMs: number; referenceSha256: string } | null
  audio: { durationMs: number; sampleRate: number; channels: number } | null
  capabilities: NativeSpeechCapabilities | null
  nativeReadinessDiagnostics: 'reported' | 'not-reported'
  capabilityError?: string
  // These are ordered warm/system-cache observations, not a cold model claim.
  order: readonly WindowDuration[]
  resumed: false
  cancellationReason?: CancellationReason
  error?: string
  arms: SpeechBenchmarkArm[]
  comparisons: SpeechBenchmarkComparison[]
}
export interface SpeechWindowBenchmarkOptions {
  fixtureId: string
  fixture: BenchmarkAudioFixture
  speechBackend?: SpeechBackend
  deviceLabel?: string
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onResult?: (report: SpeechWindowBenchmarkReport) => void
}

let running = false
let sequence = 0
const message = (failure: unknown): string => failure instanceof Error ? failure.message : String(failure)
const directory = (): string => {
  if (!FileSystem.documentDirectory) throw new Error('Local benchmark storage is unavailable')
  return `${FileSystem.documentDirectory}stt-window-benchmarks/`
}
const writeJson = async (path: string, value: unknown): Promise<void> => {
  await FileSystem.writeAsStringAsync(`${path}.part`, JSON.stringify(value))
  await FileSystem.moveAsync({ from: `${path}.part`, to: path })
}
const textHash = (text: string): string => {
  const bytes: number[] = []
  for (const character of text) {
    let point = character.codePointAt(0)!
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd
    if (point < 0x80) bytes.push(point)
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f))
    else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
  }
  const hash = new Sha256()
  hash.update(new Uint8Array(bytes))
  return hash.digestHex()
}
const phraseWords = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const boundaryPhrases = (reference: string, transcript: string): NonNullable<SpeechBenchmarkArm['boundaryPhrases']> => {
  const words = phraseWords(reference)
  const actual = ` ${phraseWords(transcript).join(' ')} `
  const first = words.slice(0, 12).join(' ')
  const last = words.slice(-12).join(' ')
  return { first, last, firstPreserved: !!first && actual.startsWith(` ${first} `), lastPreserved: !!last && actual.endsWith(` ${last} `) }
}
export const planSpeechBenchmarkWindows = (durationMs: number, windowDurationMs: WindowDuration): { startMs: number; durationMs: number }[] => {
  const duration = validateImportDuration(durationMs)
  if (!SPEECH_BENCHMARK_WINDOWS.includes(windowDurationMs)) throw new Error('Unsupported STT benchmark window')
  const windows: { startMs: number; durationMs: number }[] = []
  for (let startMs = 0; startMs < duration; startMs += windowDurationMs)
    windows.push({ startMs, durationMs: Math.min(windowDurationMs, duration - startMs) })
  return windows
}
const sumNative = (arm: SpeechBenchmarkArm, key: 'recognitionMs' | 'decodeMs' | 'setupMs'): number | null => {
  if (!arm.windows.length || arm.windows.some((window) => !Number.isFinite(window.diagnostics?.[key]) || window.diagnostics![key]! < 0)) return null
  return arm.windows.reduce((total, window) => total + window.diagnostics![key]!, 0)
}
const actualBackend = (arm: SpeechBenchmarkArm): 'recognizer' | 'analyzer' | null => {
  const backend = arm.windows[0]?.diagnostics?.backend
  return (backend === 'recognizer' || backend === 'analyzer') && arm.windows.every((window) => window.diagnostics?.backend === backend) ? backend : null
}
const comparisons = (arms: readonly SpeechBenchmarkArm[]): SpeechBenchmarkComparison[] => {
  const result: SpeechBenchmarkComparison[] = []
  for (const pass of [1, 2] as const) {
    const baseline = arms.find((arm) => arm.pass === pass && arm.windowDurationMs === 30000)
    if (!baseline || baseline.status !== 'complete') continue
    for (const candidate of arms.filter((arm) => arm.pass === pass && arm.windowDurationMs !== 30000 && arm.status === 'complete')) {
      const before = baseline.quality
      const after = candidate.quality
      const sameActualBackend = actualBackend(baseline) !== null && actualBackend(baseline) === actualBackend(candidate)
      const lexical = before && after && before.wordErrorRate !== null && after.wordErrorRate !== null && baseline.boundaryPhrases && candidate.boundaryPhrases
        ? after.wordErrorRate <= before.wordErrorRate &&
          (!before.criticalFacts || (!!after.criticalFacts && after.criticalFacts.missing.every((id) => before.criticalFacts!.missing.includes(id)))) &&
          (!baseline.boundaryPhrases.firstPreserved || candidate.boundaryPhrases.firstPreserved) &&
          (!baseline.boundaryPhrases.lastPreserved || candidate.boundaryPhrases.lastPreserved)
        : null
      result.push({ pass, baselineId: baseline.id, candidateId: candidate.id,
        sameActualBackend, noNewLexicalRegression: lexical,
        nativeRequestWallDeltaMs: candidate.nativeRequestWallMs - baseline.nativeRequestWallMs,
        nativeRecognitionDeltaMs: candidate.nativeRecognitionMs !== null && baseline.nativeRecognitionMs !== null
          ? candidate.nativeRecognitionMs - baseline.nativeRecognitionMs : null })
    }
  }
  return result
}

// STT only: no model load/unload/generation, note mutation, import checkpoint,
// reference-fed hints, or automatic asset installation. The application's heavy
// queue excludes LLM work while these measured requests execute.
export const runSpeechWindowBenchmarkSuite = async (options: SpeechWindowBenchmarkOptions): Promise<SpeechWindowBenchmarkReport> => {
  if (running) throw new Error('An STT window benchmark is already running')
  if (!nativeCapture) throw new Error('Native audio file transcription is unavailable')
  const fixture = { ...options.fixture }
  const backend = options.speechBackend ?? 'recognizer'
  if (backend !== 'recognizer' && backend !== 'analyzer-if-installed') throw new Error('Unknown speech backend')
  if (!fixture.uri.startsWith('file://') || fixture.provenance !== 'synthetic-audio' || !fixture.bundled || !fixture.referenceTranscript.trim() || !/^[a-f0-9]{64}$/.test(fixture.audioSha256 ?? ''))
    throw new Error('A pinned local synthetic audio fixture is required')
  if (backend === 'analyzer-if-installed' && !nativeCapture.transcribeWindowWithBackend)
    throw new Error('Experimental speech backend is unavailable in this native build')
  running = true
  const controller = new AbortController()
  const id = `stt-suite-${Date.now().toString(36)}-${++sequence}`
  const report: SpeechWindowBenchmarkReport = {
    version: 1, kind: 'stt-window-ab-v1', id, createdAt: Date.now(), status: 'running',
    fixtureId: options.fixtureId, deviceLabel: options.deviceLabel ?? '', fixture,
    environment: { platform: Platform.OS, osVersion: String(Platform.Version), nativeAppVersion: Constants.nativeAppVersion,
      nativeBuildVersion: Constants.nativeBuildVersion, execution: 'foreground' }, requireOnDeviceRecognition: true,
    sourceIdentity: null, audio: null, capabilities: null, nativeReadinessDiagnostics: 'not-reported',
    order: [30000, 55000, 60000, 60000, 55000, 30000], resumed: false, arms: [], comparisons: [],
  }
  const abort = (reason: CancellationReason): void => {
    if (!controller.signal.aborted) report.cancellationReason = reason
    controller.abort()
  }
  const externalAbort = (): void => abort('external-signal')
  const active = (): void => { if (controller.signal.aborted) throw new Error('STT benchmark cancelled') }
  options.signal?.addEventListener('abort', externalAbort, { once: true })
  if (options.signal?.aborted) externalAbort()
  let appSubscription: ReturnType<typeof AppState.addEventListener> | undefined
  let memorySubscription: ReturnType<typeof AppState.addEventListener> | undefined
  let captureSubscription: ReturnType<NonNullable<typeof nativeCapture>['addListener']> | undefined
  let wakeActivation: Promise<void> | undefined
  let saveReport: (() => Promise<void>) | undefined
  try {
    active()
    // Speech permission dialogs may temporarily be inactive. Preflight runs
    // before the foreground benchmark lifecycle starts, just like audio v14.
    await prepareBenchmarkAudio(fixture.locale, controller.signal, backend)
    active()
    if (AppState.currentState !== null && AppState.currentState !== 'active')
      abort(AppState.currentState === 'background' ? 'app-background' : 'app-inactive')
    appSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') abort(state === 'background' ? 'app-background' : 'app-inactive')
    })
    memorySubscription = AppState.addEventListener('memoryWarning', () => abort('memory-warning'))
    captureSubscription = nativeCapture.addListener('captureState', (snapshot) => {
      if (snapshot.manifest.state === 'recording') abort('recording-started')
    })
    active()
    wakeActivation = activateKeepAwakeAsync(id)
    await wakeActivation
    active()
    let queueStarted = false
    let abortQueued: (() => void) | undefined
    const queuedCancellation = new Promise<never>((_resolve, reject) => {
      abortQueued = () => { if (!queueStarted) reject(new Error('STT benchmark cancelled while queued')) }
      controller.signal.addEventListener('abort', abortQueued, { once: true })
      if (controller.signal.aborted) abortQueued()
    })
    const work = enqueueLlm(async () => {
      active()
      queueStarted = true
      const capture = await nativeCapture!.getSnapshot()
      active()
      if (capture?.manifest.state === 'recording') { abort('recording-started'); active() }
      const folder = `${directory()}${id}/`
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true })
      saveReport = () => writeJson(`${directory()}${id}.json`, report)
      await saveReport()
      active()
      const preparationBegan = Date.now()
      const info = await FileSystem.getInfoAsync(fixture.uri)
      active()
      if (!info.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size <= 0) throw new Error('Benchmark audio file is missing or empty')
      // Build7's read-only verifier deliberately accepts Documents files only.
      // Keep the bundled/cache original intact and prepare one suite-owned copy
      // outside every arm timer. All six arms use its verified identical bytes.
      const preparedUri = `${folder}source.wav`
      await FileSystem.copyAsync({ from: fixture.uri, to: preparedUri })
      active()
      const preparationMs = Date.now() - preparationBegan
      const verificationBegan = Date.now()
      const verification = await verifyFileNatively(preparedUri, info.size, fixture.audioSha256!, controller.signal)
      active()
      if (!verification || verification.sha256 !== fixture.audioSha256 || verification.sizeBytes !== info.size)
        throw new Error('Native verification of the pinned benchmark audio is unavailable or invalid')
      report.sourceIdentity = { originalUri: fixture.uri, preparedUri, preparationMs,
        expectedSha256: fixture.audioSha256!, actualSha256: verification.sha256,
        sizeBytes: verification.sizeBytes, verificationMs: Date.now() - verificationBegan, referenceSha256: textHash(fixture.referenceTranscript) }
      const audio = await nativeCapture!.inspectAudio(preparedUri)
      active()
      validateImportDuration(audio.durationMs)
      if (!Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0 || !Number.isInteger(audio.channels) || audio.channels < 1 || audio.channels > 8)
        throw new Error('Invalid benchmark audio format')
      if (fixture.expectedDurationMs !== undefined && (!Number.isFinite(fixture.expectedDurationMs) || fixture.expectedDurationMs <= 0 || Math.abs(audio.durationMs - fixture.expectedDurationMs) > Math.max(50, fixture.expectedDurationMs * 0.0001)))
        throw new Error('Benchmark audio duration does not match the pinned fixture')
      report.audio = audio
      try { report.capabilities = await nativeCapture!.getSpeechCapabilities?.() ?? null }
      catch (failure) { report.capabilityError = message(failure) }
      if (report.capabilities?.locales[fixture.locale]?.analyzerReadiness) report.nativeReadinessDiagnostics = 'reported'
      active()
      for (const [orderIndex, windowDurationMs] of report.order.entries()) {
        active()
        const arm: SpeechBenchmarkArm = {
          id: `${id}-arm-${orderIndex}`, pass: orderIndex < 3 ? 1 : 2, orderIndex,
          windowDurationMs, requestedBackend: backend, status: 'running', startedAt: Date.now(),
          wallMs: 0, nativeRequestWallMs: 0, windowReceiptWriteMs: 0, qualityMs: 0,
          nativeRecognitionMs: null, nativeDecodeMs: null, nativeSetupMs: null,
          completedDurationMs: 0, transcript: '', windows: [],
        }
        report.arms.push(arm)
        const plan = planSpeechBenchmarkWindows(audio.durationMs, windowDurationMs)
        try {
          for (const [index, range] of plan.entries()) {
            active()
            const current = await nativeCapture!.getSnapshot()
            active()
            if (current?.manifest.state === 'recording') { abort('recording-started'); active() }
            options.onProgress?.(`STT ${orderIndex + 1}/6 · ${windowDurationMs / 1000}s · ${index + 1}/${plan.length}`)
            active()
            const requestId = `${arm.id}-window-${index}`
            const cancel = (): void => { void nativeCapture!.cancelTranscription(requestId).catch(() => undefined) }
            controller.signal.addEventListener('abort', cancel, { once: true })
            const began = Date.now()
            let window: SpeechBenchmarkWindow
            try {
              active()
              const result = backend === 'analyzer-if-installed'
                ? await nativeCapture!.transcribeWindowWithBackend!(preparedUri, range.startMs, range.durationMs, fixture.locale, requestId, backend)
                : await nativeCapture!.transcribeWindowWithDiagnostics(preparedUri, range.startMs, range.durationMs, fixture.locale, requestId)
              active()
              if (!result.transcript.trim()) throw new Error('Speech recognition returned an empty transcript')
              if (!result.diagnostics)
                throw new NativeSpeechWindowError('Native speech coverage diagnostics are missing', result.transcript)
              {
                const proof = result.diagnostics
                if (proof.version !== 1 || !Number.isFinite(proof.requestedStartMs) || !Number.isFinite(proof.requestedDurationMs) ||
                  Math.abs(proof.requestedStartMs - range.startMs) > 1 || Math.abs(proof.requestedDurationMs - range.durationMs) > 1 ||
                  !Number.isSafeInteger(proof.decodedFrames) || proof.decodedFrames <= 0 || !Number.isFinite(proof.decodedDurationMs) ||
                  Math.abs(proof.decodedDurationMs - range.durationMs) > 20 || !Number.isFinite(proof.decodedSampleRate) || proof.decodedSampleRate <= 0 ||
                  Math.abs(proof.decodedFrames * 1000 / proof.decodedSampleRate - proof.decodedDurationMs) > 20 ||
                  !Number.isSafeInteger(proof.finalCallbackCount) || proof.finalCallbackCount <= 0 ||
                  (proof.backend === 'analyzer' && (!Number.isFinite(proof.finalizedThroughMs) || Math.abs(proof.finalizedThroughMs! - range.durationMs) > 20)))
                  throw new NativeSpeechWindowError('Native speech evidence does not cover the requested audio window', result.transcript, proof)
              }
              window = { index, requestId, ...range, status: 'complete', transcript: result.transcript,
                wallMs: Date.now() - began, ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}) }
            } catch (failure) {
              window = { index, requestId, ...range, status: controller.signal.aborted ? 'cancelled' : 'failed',
                transcript: '', wallMs: Date.now() - began, error: message(failure),
                ...(failure instanceof NativeSpeechWindowError ? { partialTranscript: failure.transcript, diagnostics: failure.diagnostics } : {}) }
            } finally { controller.signal.removeEventListener('abort', cancel) }
            arm.nativeRequestWallMs += window.wallMs
            const writeBegan = Date.now()
            try {
              await writeJson(`${folder}${arm.id}-window-${index}.json`, window)
            } catch (failure) {
              // Recognition success is not a committed source checkpoint.
              // Preserve this observation separately, but never add a failed
              // receipt's text/range to the completed durable prefix.
              window = { ...window, status: controller.signal.aborted ? 'cancelled' : 'failed',
                ...(window.status === 'complete' ? { partialTranscript: window.transcript } : {}),
                transcript: '', error: `Speech window receipt could not be committed: ${message(failure)}` }
            } finally { arm.windowReceiptWriteMs += Date.now() - writeBegan }
            arm.windows.push(window)
            if (window.status === 'complete') {
              arm.completedDurationMs += window.durationMs
              arm.transcript = arm.windows.filter((item) => item.status === 'complete').map((item) => item.transcript).join(' ').trim()
            }
            if (window.status !== 'complete') throw new Error(window.error)
            active()
          }
          arm.status = 'complete'
        } catch (failure) {
          arm.status = controller.signal.aborted ? 'cancelled' : 'failed'
          arm.error = message(failure)
        }
        arm.endedAt = Date.now()
        arm.wallMs = arm.endedAt - arm.startedAt
        arm.nativeRecognitionMs = sumNative(arm, 'recognitionMs')
        arm.nativeDecodeMs = sumNative(arm, 'decodeMs')
        arm.nativeSetupMs = sumNative(arm, 'setupMs')
        arm.transcriptSha256 = textHash(arm.transcript)
        if (arm.status === 'complete') {
          const qualityBegan = Date.now()
          arm.quality = evaluateBenchmarkAudioQuality(fixture.referenceTranscript, arm.transcript, options.fixtureId)
          arm.boundaryPhrases = boundaryPhrases(fixture.referenceTranscript, arm.transcript)
          arm.qualityMs = Date.now() - qualityBegan
        }
        report.comparisons = comparisons(report.arms)
        await saveReport!()
        options.onResult?.(report)
        if (arm.status !== 'complete') throw new Error(arm.error)
        active()
      }
    })
    // Releasing a cancelled queued suite does not cancel the unrelated job in
    // front of it. Its eventual queue entry checks the aborted signal first.
    try { await Promise.race([work, queuedCancellation]) }
    finally { if (abortQueued) controller.signal.removeEventListener('abort', abortQueued) }
    active()
    report.status = 'complete'
  } catch (failure) {
    report.status = controller.signal.aborted ? 'cancelled' : 'failed'
    report.error = message(failure)
  } finally {
    report.endedAt = Date.now()
    try {
      // Persist final failures, including preflight/queued cancellations.
      if (!saveReport) {
        await FileSystem.makeDirectoryAsync(directory(), { intermediates: true })
        saveReport = () => writeJson(`${directory()}${id}.json`, report)
      }
      await saveReport()
    } finally {
      options.signal?.removeEventListener('abort', externalAbort)
      appSubscription?.remove(); memorySubscription?.remove(); captureSubscription?.remove()
      if (wakeActivation) {
        await wakeActivation.catch(() => undefined)
        await deactivateKeepAwake(id).catch(() => undefined)
      }
      running = false
    }
  }
  options.onResult?.(report)
  return report
}

export const shareSpeechWindowBenchmarks = async (): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable')
  const folder = directory()
  const reports: unknown[] = []
  if ((await FileSystem.getInfoAsync(folder)).exists) {
    for (const name of (await FileSystem.readDirectoryAsync(folder)).filter((name) => /^stt-suite-[a-z0-9-]+\.json$/.test(name))) {
      try { reports.push(JSON.parse(await FileSystem.readAsStringAsync(`${folder}${name}`)) as unknown) }
      catch { /* Keep other durable results when one export is damaged. */ }
    }
  }
  const path = `${FileSystem.cacheDirectory}notatki-stt-window-benchmarks.json`
  await FileSystem.writeAsStringAsync(path, JSON.stringify({ version: 1, exportedAt: Date.now(), reports }, null, 2))
  await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' })
}
