import type { RuntimeMetricMetadata } from '../data/metricsRepository'
import type { Language } from '../i18n/language'
import type { BenchmarkArm } from './benchmarkProfiles'
import type { ModelVerification } from './benchmarkModels'
import type { GenerationCompletion } from './llm'
import type { NativeSpeechWindowDiagnostics } from '../stt/nativeCapture'
import type { GpuDiagnosticReport } from '../processing/gpuDiagnostics'

export type BenchmarkSpeechBackend = 'recognizer' | 'analyzer-if-installed'

export interface BenchmarkAudioCompleteness {
  method: 'synthetic-reference-word-error-v1'
  rawReferenceWords: number
  rawTranscriptWords: number
  normalizedReferenceWords: number
  normalizedTranscriptWords: number
  substitutions: number
  deletions: number
  insertions: number
  wordErrorRate: number | null
  wordRatio: number | null
  maximumWordErrorRate: 0.15
  minimumWordRatio: 0.8
  reviewRequired: boolean
  criticalFacts?: {
    method: 'riverside-critical-phrases-v1'
    required: 8
    preserved: number
    missing: string[]
  }
}

export interface BenchmarkAudioFixture {
  uri: string
  locale: 'en-US'
  referenceTranscript: string
  provenance: 'synthetic-audio'
  expectedDurationMs?: number
  // Expected identity from the bundled fixture registry, not a runtime hash.
  audioSha256?: string
  bundled?: boolean
  speechBackend?: BenchmarkSpeechBackend
}

export interface BenchmarkAudioWindow {
  requestId: string
  startMs: number
  durationMs: number
  diagnostics?: NativeSpeechWindowDiagnostics
}

export interface BenchmarkAudioRun extends BenchmarkAudioFixture {
  requireOnDeviceRecognition: true
  transcript: string
  durationMs: number | null
  sampleRate: number | null
  channels: number | null
  sttMs: number
  status: 'complete' | 'failed'
  // Known synthetic fixtures have a reference diagnostic. Passing these
  // lexical limits and registered phrase checks are not general semantic proof.
  completeness?: BenchmarkAudioCompleteness
  windows?: BenchmarkAudioWindow[]
}

export interface BenchmarkGeneration {
  // Stored locally only in an explicitly requested benchmark, not note metrics.
  outputText?: string
  phase: string
  inputChars: number
  ttftMs: number
  wallMs: number
  promptMs: number
  predictedMs: number
  promptTokens: number
  predictedTokens: number
  formattedPromptTokens: number | null
  draftTokens: number | null
  draftTokensAccepted: number | null
  completion: GenerationCompletion | null
}
export type BenchmarkCancellationReason =
  | 'external-signal'
  | 'app-inactive'
  | 'app-background'
  | 'memory-warning'
  | 'recording-started'

export interface BenchmarkRun {
  version: 1
  pipelineVersion?: string
  gpuDiagnostic?: GpuDiagnosticReport
  id: string
  suiteId: string
  arm: BenchmarkArm
  model: string
  revision: string
  modelSha256: string
  verification: ModelVerification
  environment: RuntimeMetricMetadata & {
    deviceLabel: string
    deviceLabelSource: 'user' | 'automatic'
    appMode: 'development' | 'release'
  }
  condition: 'cold' | 'warm'
  repeat: number
  language: Language
  source: string
  fixtureId: string
  sourceProvenance: 'synthetic-text' | 'user-text' | 'synthetic-audio'
  inputMode?: 'text' | 'audio'
  audio?: BenchmarkAudioRun
  nominalMinutes: number | null
  wordCount: number
  requestedAt: number
  createdAt: number
  queueMs: number
  suiteVerificationMs: number
  modelLoadMs: number
  processingMs: number
  sttMs?: number
  // Audio benchmark diagnostics within the existing combined sttMs boundary.
  sttRecognitionMs?: number
  sttQualityMs?: number
  llmMs?: number
  persistMs: number
  totalMs: number
  timingBoundary: 'request-to-first-durable-benchmark-result'
  prefillMs: number
  decodeMs: number
  draftTokens: number | null
  draftTokensAccepted: number | null
  generations: BenchmarkGeneration[]
  output: {
    title: string
    summary: string
    tags: string[]
    tasks: string[]
    warnings: string[]
  } | null
  succeeded: boolean
  error: string | null
  cancellationReason?: BenchmarkCancellationReason
  assessment: {
    faithfulSummary: boolean | null
    completeTasks: boolean | null
    acceptableLanguage: boolean | null
    notes: string
  }
}
