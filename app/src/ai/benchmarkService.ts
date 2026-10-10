import { AppState } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { nativeCapture } from '../stt/nativeCapture'
import { createGpuDiagnosticReport } from '../processing/gpuDiagnostics'
import type { Language } from '../i18n/language'
import { translate } from '../i18n/translate'
import { enqueueLlm } from './llmQueue'
import {
  cancelGeneration,
  GenerationCancelledError,
  getLoadedModelInfo,
  loadModel,
  unloadModel,
} from './llm'
import { observeGenerations, runtimeMetricMetadata } from './generationMetrics'
import { summarizeGenerationPhases } from './benchmarkPhaseTotals'
import { processNoteWithLlm } from './noteProcessing'
import { clearSourcePlanCache } from './sourcePlanCache'
import { evaluateBenchmarkAudioQuality } from './benchmarkAudioQuality'
import { BENCHMARK_AUDIO_FIXTURES } from './benchmarkFixtures'
import { createTaskProposal } from './taskProposal'
import {
  PIPELINE_VERSION,
  type ProcessingExecutionContext,
} from './processingContext'
import {
  benchmarkModelPath,
  verifyBenchmarkModel,
  type ModelVerification,
} from './benchmarkModels'
import {
  BENCHMARK_PROFILES,
  validateBenchmarkMetadata,
  type BenchmarkArm,
} from './benchmarkProfiles'
import { saveBenchmarkRun } from './benchmarkStorage'
import type {
  BenchmarkAudioFixture,
  BenchmarkAudioRun,
  BenchmarkCancellationReason,
  BenchmarkGeneration,
  BenchmarkRun,
  BenchmarkSpeechBackend,
} from './benchmarkTypes'
import {
  prepareBenchmarkAudio,
  transcribeBenchmarkAudio,
} from './benchmarkAudio'
import type { ModelExecutionProfile } from './modelConfig'

export interface BenchmarkSuiteOptions {
  arms: readonly BenchmarkArm[]
  warmRepeats: number
  language: Language
  source: string
  fixtureId: string
  sourceProvenance: 'synthetic-text' | 'user-text'
  inputMode?: 'text' | 'audio'
  audioFixture?: BenchmarkAudioFixture
  speechBackend?: BenchmarkSpeechBackend
  nominalMinutes: number | null
  deviceLabel?: string
  execution: ModelExecutionProfile
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onResult?: (run: BenchmarkRun) => void
}
let running = false
let wakeTagSequence = 0
const ensureActive = (signal: AbortSignal): void => {
  if (signal.aborted) throw new GenerationCancelledError()
}

// Whole suite uses the application's queue: a note job cannot replace this
// context between prefill and completion, and only one model is resident.
export const runBenchmarkSuite = async (
  options: BenchmarkSuiteOptions,
): Promise<BenchmarkRun[]> => {
  if (running)
    throw new Error(
      translate('Pomiar już trwa.', 'A benchmark is already running.'),
    )
  const audioFixture = options.inputMode === 'audio' && options.audioFixture
    ? {
        ...options.audioFixture,
        speechBackend: options.speechBackend ?? options.audioFixture.speechBackend ?? 'recognizer',
      }
    : undefined
  if (options.inputMode === 'audio' && !audioFixture)
    throw new Error('Benchmark audio fixture is missing')
  if (!audioFixture && !options.source.trim())
    throw new Error(translate('Podaj tekst źródłowy.', 'Provide source text.'))
  if (
    !Number.isInteger(options.warmRepeats) ||
    options.warmRepeats < 0 ||
    options.warmRepeats > 5 ||
    !options.arms.length
  )
    throw new Error('Invalid benchmark repetitions or arms')
  const profiles = [...new Set(options.arms)].map((id) => {
    const profile = BENCHMARK_PROFILES.find((item) => item.id === id)
    if (!profile) throw new Error('Unknown benchmark arm')
    return profile
  })
  running = true
  let audioPreflightError: unknown
  if (audioFixture) {
    try {
      await prepareBenchmarkAudio(audioFixture.locale, options.signal, audioFixture.speechBackend)
    } catch (failure) {
      if (options.signal?.aborted) {
        running = false
        throw new GenerationCancelledError()
      }
      // Denied permission and unavailable STT are benchmark failures too;
      // preserve them in the same durable result format as runtime failures.
      audioPreflightError = failure
    }
  }
  const requestedAt = Date.now()
  const wakeTag = `NotatkiBenchmark-${requestedAt.toString(36)}-${++wakeTagSequence}`
  let wakeRequested = false
  let wakeActivation: Promise<void> | undefined
  let wakeRelease: Promise<void> | undefined
  const releaseWake = (): Promise<void> => {
    if (!wakeRequested) return Promise.resolve()
    // Delay reading activation until its synchronous call has returned. An
    // abort during activation must release after that activation settles.
    wakeRelease ??= Promise.resolve().then(async () => {
      await wakeActivation?.catch(() => undefined)
      // Android can reject release after its Activity has left the foreground.
      // Preserve the benchmark's own cancellation/error in that case.
      await deactivateKeepAwake(wakeTag).catch(() => undefined)
    })
    return wakeRelease
  }
  const controller = new AbortController()
  let ownsRuntime = false
  let cancellationReason: BenchmarkCancellationReason | undefined
  const abort = (reason?: BenchmarkCancellationReason): void => {
    if (!controller.signal.aborted) cancellationReason = reason
    controller.abort()
    // A cancelled queue entry must not hold the screen while another note's
    // generation finishes. The outer finally awaits this same one-time release.
    void releaseWake()
    // Cancellation while queued belongs to this suite only; stopping the
    // shared context there would cancel an unrelated note already running.
    if (ownsRuntime) void cancelGeneration('benchmark').catch(() => undefined)
  }
  const abortExternal = (): void => abort('external-signal')
  options.signal?.addEventListener('abort', abortExternal, { once: true })
  if (options.signal?.aborted) abortExternal()
  else if (AppState.currentState !== null && AppState.currentState !== 'active')
    abort(
      AppState.currentState === 'background'
        ? 'app-background'
        : AppState.currentState === 'inactive'
          ? 'app-inactive'
          : undefined,
    )
  // A standalone benchmark has no iOS background grant. Both Metal and CPU
  // comparisons stop on background/inactive and on memory pressure.
  const appSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active')
      abort(
        state === 'background'
          ? 'app-background'
          : state === 'inactive'
            ? 'app-inactive'
            : undefined,
      )
  })
  const memorySubscription = AppState.addEventListener('memoryWarning', () =>
    abort('memory-warning'),
  )
  const captureSubscription = nativeCapture?.addListener(
    'captureState',
    (snapshot) => {
      if (snapshot.manifest.state === 'recording') abort('recording-started')
    },
  )
  try {
    ensureActive(controller.signal)
    // Own only this suite's tag, including queue wait and SHA-256 verification.
    // Await activation before starting work and release even if it rejects or
    // cancellation arrives while the native activation is pending.
    wakeRequested = true
    wakeActivation = activateKeepAwakeAsync(wakeTag)
    await wakeActivation
    ensureActive(controller.signal)
    return await enqueueLlm(async () => {
      ensureActive(controller.signal)
      const capture = await nativeCapture?.getSnapshot()
      if (capture?.manifest.state === 'recording')
        throw new Error(
          translate(
            'Zakończ nagranie przed pomiarem.',
            'Finish recording before benchmarking.',
          ),
        )
      ownsRuntime = true
      await unloadModel()
      const queueMs = Date.now() - requestedAt
      const verifications = new Map<string, ModelVerification>()
      const verificationStarted = Date.now()
      // Installation integrity is outside each arm's note-processing timer;
      // its real cost is exported separately as suiteVerificationMs.
      for (const profile of profiles) {
        if (verifications.has(profile.model.filename)) continue
        options.onProgress?.(
          translate(
            `Sprawdzanie SHA-256: ${profile.model.displayName}`,
            `Checking SHA-256: ${profile.model.displayName}`,
          ),
        )
        const verification = await verifyBenchmarkModel(
          profile.model,
          controller.signal,
          (percent) => {
            options.onProgress?.(
              `${translate('Sprawdzanie SHA-256', 'Checking SHA-256')}: ${profile.model.displayName} · ${percent.toFixed(1)}%`,
            )
          },
        )
        verifications.set(profile.model.filename, verification)
      }
      const suiteVerificationMs = Date.now() - verificationStarted
      const suiteId = `suite-${requestedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const results: BenchmarkRun[] = []
      try {
        for (const profile of profiles) {
          await unloadModel()
          for (let repeat = 0; repeat <= options.warmRepeats; repeat++) {
            ensureActive(controller.signal)
            // Compare full workflows; a warm model must not imply cached source analysis.
            clearSourcePlanCache()
            // Sample each attempt after queue/verification/model preparation;
            // keep observation overhead outside its processing timer.
            const gpuDiagnostic = createGpuDiagnosticReport('benchmark')
            const startedAt = Date.now()
            const cold = getLoadedModelInfo() === null
            let modelLoadMs = 0
            let sttMs = 0
            let sttRecognitionMs = 0
            let sttQualityMs = 0
            let llmMs = 0
            let llmStartedAt: number | undefined
            let source = audioFixture ? '' : options.source
            const language: Language = audioFixture ? 'en' : options.language
            const audio: BenchmarkAudioRun | undefined = audioFixture
              ? {
                  ...audioFixture,
                  requireOnDeviceRecognition: true,
                  transcript: '',
                  durationMs: null,
                  sampleRate: null,
                  channels: null,
                  sttMs: 0,
                  status: 'failed',
                }
              : undefined
            let output: BenchmarkRun['output'] = null
            const speechWarnings: string[] = []
            let error: string | null = null
            const generations: BenchmarkGeneration[] = []
            const stopObserving = observeGenerations(
              ({ phase, inputChars, sourceChars, result }) => {
                generations.push({
                  outputText: result.text,
                  phase,
                  inputChars,
                  sourceChars,
                  ttftMs: result.ttftMs,
                  wallMs: result.wallMs,
                  promptMs: result.promptMs,
                  predictedMs: result.predictedMs,
                  promptTokens: result.promptTokens,
                  predictedTokens: result.predictedTokens,
                  formattedPromptTokens: result.formattedPromptTokens ?? null,
                  draftTokens: result.draftTokens ?? null,
                  draftTokensAccepted: result.draftTokensAccepted ?? null,
                  completion: result.completion ?? null,
                })
              },
            )
            const runtimeOptions = {
              modelPath: benchmarkModelPath(profile.model),
              model: profile.model,
              execution: options.execution,
              speculative: profile.speculative,
              signal: controller.signal,
            }
            options.onProgress?.(
              `${profile.id} · ${cold ? 'cold' : 'warm'} · ${repeat + 1}`,
            )
            try {
              if (audio) {
                const transcriptionAt = Date.now()
                try {
                  if (audioPreflightError !== undefined)
                    throw audioPreflightError
                  const recognitionAt = Date.now()
                  try {
                    source = await transcribeBenchmarkAudio(
                      audio,
                      controller.signal,
                      options.onProgress,
                    )
                  } finally {
                    sttRecognitionMs = Date.now() - recognitionAt
                  }
                  if (options.fixtureId === 'en-audio-smoke-v6' ||
                    BENCHMARK_AUDIO_FIXTURES.some((fixture) => fixture.id === options.fixtureId)) {
                    options.onProgress?.(
                      translate('Sprawdzanie transkrypcji', 'Checking transcript'),
                    )
                    const qualityAt = Date.now()
                    try {
                      audio.completeness = evaluateBenchmarkAudioQuality(
                        audio.referenceTranscript,
                        source,
                        options.fixtureId,
                      )
                    } finally {
                      sttQualityMs = Date.now() - qualityAt
                    }
                    const completeness = audio.completeness
                    if (completeness.reviewRequired) {
                      const rate =
                        completeness.wordErrorRate === null
                          ? '?'
                          : `${(completeness.wordErrorRate * 100).toFixed(1)}%`
                      const facts = completeness.criticalFacts
                      const phraseWarning = facts?.missing.length ? translate(
                        ` Zachowane pełne frazy kontrolne: ${facts.preserved}/${facts.required}. Sprawdź transkrypcję.`,
                        ` Recognized complete control phrases: ${facts.preserved}/${facts.required}. Check the transcript.`,
                      ) : ''
                      speechWarnings.push(
                        translate(
                          `Transkrypcja wymaga sprawdzenia: błąd słów syntetycznej próbki ${rate}, rozpoznano ${completeness.rawTranscriptWords}/${completeness.rawReferenceWords} słów. Brakująca mowa może powodować niepełny wynik LLM.${phraseWarning}`,
                          `Speech transcript needs review: synthetic-fixture word error ${rate}, recognized ${completeness.rawTranscriptWords}/${completeness.rawReferenceWords} words. Missing speech may make the LLM output incomplete.${phraseWarning}`,
                        ),
                      )
                    }
                  }
                } finally {
                  // A rejected native request may still carry actual partial
                  // speech. Keep it in the durable failed run, never a reference.
                  source = audio.transcript.trim()
                  sttMs = Date.now() - transcriptionAt
                  audio.sttMs = sttMs
                }
              }
              ensureActive(controller.signal)
              const loadingAt = Date.now()
              try {
                await loadModel(
                  runtimeOptions.modelPath,
                  undefined,
                  runtimeOptions,
                )
              } finally {
                modelLoadMs = cold ? Date.now() - loadingAt : 0
              }
              const info = getLoadedModelInfo()
              if (!info) throw new Error('Benchmark model context is missing')
              validateBenchmarkMetadata(profile.model, info.metadata)
              ensureActive(controller.signal)
              const execution: ProcessingExecutionContext = {
                signal: controller.signal,
                runtimeOptions,
                taskEvidenceMemo: {},
              }
              llmStartedAt = Date.now()
              const note = await processNoteWithLlm(
                source,
                (progress) =>
                  options.onProgress?.(`${profile.id} · ${progress.phase}`),
                undefined,
                language,
                execution,
              )
              output = {
                title: note.title,
                summary: note.summary,
                tags: note.tags,
                tasks: [],
                warnings: [...speechWarnings, ...(note.warnings ?? [])],
              }
              const taskProposal = await createTaskProposal(
                source,
                (message) => options.onProgress?.(`${profile.id} · ${message}`),
                language,
                execution,
              )
              output.tasks = taskProposal.tasks
              output.warnings = [
                ...new Set([...output.warnings, ...taskProposal.warnings]),
              ]
              ensureActive(controller.signal)
            } catch (failure) {
              error =
                failure instanceof Error ? failure.message : String(failure)
            } finally {
              if (llmStartedAt !== undefined) llmMs = Date.now() - llmStartedAt
              stopObserving()
            }
            const processingMs = llmMs
            const metadata = runtimeMetricMetadata()
            const deviceLabel = options.deviceLabel?.trim()
            const automaticLabel =
              `${metadata.os === 'ios' ? 'iOS' : (metadata.os ?? 'unknown')} ${metadata.osVersion ?? ''}`.trim()
            const draftAvailable = generations.some(
              (item) => item.draftTokens !== null,
            )
            const run: BenchmarkRun = {
              version: 1,
              pipelineVersion: PIPELINE_VERSION,
              gpuDiagnostic,
              id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
              suiteId,
              arm: profile.id,
              model: profile.model.displayName,
              revision: profile.model.revision ?? '',
              modelSha256: profile.model.sha256 ?? '',
              verification: verifications.get(profile.model.filename)!,
              environment: {
                ...metadata,
                deviceLabel: deviceLabel || automaticLabel,
                deviceLabelSource: deviceLabel ? 'user' : 'automatic',
                appMode: __DEV__ ? 'development' : 'release',
              },
              condition: cold ? 'cold' : 'warm',
              repeat,
              language,
              source,
              fixtureId: options.fixtureId,
              sourceProvenance: audio
                ? audio.provenance
                : options.sourceProvenance,
              inputMode: audio ? 'audio' : 'text',
              ...(audio ? { audio } : {}),
              nominalMinutes: options.nominalMinutes,
              wordCount: source.trim() ? source.trim().split(/\s+/).length : 0,
              requestedAt: startedAt,
              createdAt: Date.now(),
              queueMs,
              suiteVerificationMs,
              modelLoadMs,
              processingMs,
              sttMs,
              ...(audio ? { sttRecognitionMs, sttQualityMs } : {}),
              llmMs,
              persistMs: 0,
              totalMs: Date.now() - startedAt,
              timingBoundary: 'request-to-first-durable-benchmark-result',
              prefillMs: generations.reduce(
                (sum, item) => sum + item.promptMs,
                0,
              ),
              decodeMs: generations.reduce(
                (sum, item) => sum + item.predictedMs,
                0,
              ),
              draftTokens: draftAvailable
                ? generations.reduce(
                    (sum, item) => sum + (item.draftTokens ?? 0),
                    0,
                  )
                : null,
              draftTokensAccepted: draftAvailable
                ? generations.reduce(
                    (sum, item) => sum + (item.draftTokensAccepted ?? 0),
                    0,
                  )
                : null,
              generations,
              generationPhases: summarizeGenerationPhases(generations),
              output,
              error,
              ...(cancellationReason ? { cancellationReason } : {}),
              succeeded:
                error === null &&
                !audio?.completeness?.reviewRequired &&
                output !== null &&
                !output.warnings.length &&
                generations.length > 0 &&
                generations.every(
                  (item) => item.completion?.status === 'complete',
                ),
              assessment: {
                faithfulSummary: null,
                completeTasks: null,
                acceptableLanguage: null,
                notes: '',
              },
            }
            const savingAt = Date.now()
            await saveBenchmarkRun(run)
            run.persistMs = Date.now() - savingAt
            run.totalMs = Date.now() - startedAt
            if (cancellationReason) run.cancellationReason = cancellationReason
            // This second metadata write records the measured first durable
            // result boundary and is deliberately outside that timer.
            await saveBenchmarkRun(run)
            results.push(run)
            options.onResult?.(run)
            ensureActive(controller.signal)
            if (error) await unloadModel()
          }
        }
      } finally {
        await unloadModel()
      }
      return results
    })
  } finally {
    ownsRuntime = false
    options.signal?.removeEventListener('abort', abortExternal)
    appSubscription.remove()
    memorySubscription.remove()
    captureSubscription?.remove()
    try {
      await releaseWake()
    } finally {
      running = false
    }
  }
}
