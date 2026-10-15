import {
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core'
import type { CaptureManifest } from '../audio/captureManifest'

export type SpeechBackend = 'recognizer' | 'analyzer-if-installed'
export interface NativeSpeechAnalyzerReadiness {
  requestedLocale: string
  resolvedLocale?: string
  deviceAvailable: boolean
  localeSupported: boolean
  localeInstalled: boolean
  assetStatus: 'not-checked' | 'installed' | 'downloading' | 'supported' | 'unsupported' | 'unknown'
  ready: boolean
  fallbackReason?: string
}
export interface NativeSpeechCapabilities {
  version: 1
  analyzerAvailable: boolean
  supportedLocales: string[]
  installedLocales: string[]
  locales: Record<string, {
    recognizerAvailable: boolean
    recognizerOnDevice: boolean
    analyzerSupported: boolean
    analyzerInstalled: boolean
    analyzerReadiness?: NativeSpeechAnalyzerReadiness
  }>
}

export interface NativeSpeechCallbackDiagnostic {
  index: number
  isFinal: boolean
  finalLike: boolean
  text: string
  segmentCount: number
  startMs?: number
  endMs?: number
  metadataStartMs?: number
  metadataDurationMs?: number
}
export interface NativeSpeechWindowDiagnostics {
  version: 1
  requestedStartMs: number
  requestedDurationMs: number
  decodedFrames: number
  decodedDurationMs: number
  decodedSampleRate: number
  requestTaskHintRawValue?: number
  callbackCount: number
  finalCallbackCount: number
  finalLikeCallbackCount: number
  untimedCallbackCount: number
  mergedSegmentCount: number
  callbacksTruncated: boolean
  observedStartMs?: number
  observedEndMs?: number
  callbacks: readonly NativeSpeechCallbackDiagnostic[]
  requestedBackend?: SpeechBackend
  backend?: 'recognizer' | 'analyzer'
  fallbackReason?: string
  analyzerReadiness?: NativeSpeechAnalyzerReadiness
  decodePath?: 'pcm-copy' | 'converter'
  recognizerReused?: boolean
  setupMs?: number
  decodeMs?: number
  recognitionMs?: number
  firstResultMs?: number
  totalMs?: number
  finalizedThroughMs?: number
}
export interface NativeSpeechWindowResult {
  transcript: string
  diagnostics?: NativeSpeechWindowDiagnostics
}
export class NativeSpeechWindowError extends Error {
  constructor(
    message: string,
    readonly transcript: string,
    readonly diagnostics?: NativeSpeechWindowDiagnostics,
  ) {
    super(message)
    this.name = 'NativeSpeechWindowError'
  }
}

export interface CaptureSnapshot {
  manifest: CaptureManifest
  directory: string
  finalTranscript?: string
  interimTranscript?: string
  // Display-only recognizer hypothesis; never checkpointed or source-certified.
  livePreviewTranscript?: string
  volumeLevel: number
  cursor: number
  speechFinalizing?: boolean
}
export interface NativeCaptureModule {
  start(sessionId: string, language: string): Promise<CaptureSnapshot>
  stop(sessionId: string): Promise<CaptureSnapshot>
  resume(sessionId: string): Promise<CaptureSnapshot>
  getSnapshot(): Promise<CaptureSnapshot | null>
  recoverSessions(): Promise<CaptureSnapshot[]>
  markMaterialized(sessionId: string, noteId: string): Promise<void>
  deleteCaptureAudio(sessionId: string): Promise<void>
  inspectAudio(
    uri: string,
  ): Promise<{ durationMs: number; sampleRate: number; channels: number }>
  transcribeWindow(
    uri: string,
    startMs: number,
    durationMs: number,
    locale: string,
    requestId: string,
  ): Promise<string>
  transcribeWindowWithDiagnostics(
    uri: string,
    startMs: number,
    durationMs: number,
    locale: string,
    requestId: string,
  ): Promise<NativeSpeechWindowResult>
  transcribeWindowWithBackend?(
    uri: string, startMs: number, durationMs: number, locale: string,
    requestId: string, backend: SpeechBackend,
  ): Promise<NativeSpeechWindowResult>
  getSpeechCapabilities?(): Promise<NativeSpeechCapabilities>
  cancelTranscription(requestId: string): Promise<void>
  addListener(
    name: 'captureState',
    listener: (snapshot: CaptureSnapshot) => void,
  ): EventSubscription
  addListener(
    name: 'captureTranscript',
    listener: (event: {
      sessionId: string
      finalTranscript: string
      interimTranscript: string
      livePreviewTranscript?: string
      cursor?: number
    }) => void,
  ): EventSubscription
}
type RawWindowResult = string | (NativeSpeechWindowResult & { error?: string })
type RawNativeCaptureModule = Omit<NativeCaptureModule, 'transcribeWindow' | 'transcribeWindowWithDiagnostics' | 'transcribeWindowWithBackend'> & {
  transcribeWindow(
    uri: string, startMs: number, durationMs: number, locale: string, requestId: string,
  ): Promise<RawWindowResult>
  transcribeWindowWithBackend?(
    uri: string, startMs: number, durationMs: number, locale: string,
    requestId: string, backend: SpeechBackend,
  ): Promise<RawWindowResult>
}

const rawNativeCapture = requireOptionalNativeModule<RawNativeCaptureModule>('NotatkiCapture')
const normalizeWindowResult = (result: RawWindowResult): NativeSpeechWindowResult => {
  if (typeof result === 'string') return { transcript: result }
  if (!result || typeof result.transcript !== 'string') throw new Error('Native audio transcription returned an invalid result')
  if (result.error !== undefined) {
    if (typeof result.error !== 'string') throw new Error('Native audio transcription returned an invalid error')
    throw new NativeSpeechWindowError(result.error, result.transcript, result.diagnostics)
  }
  return result
}
const transcribeWindowWithDiagnostics: NativeCaptureModule['transcribeWindowWithDiagnostics'] = async (...args) => {
  if (!rawNativeCapture) throw new Error('Native audio transcription is unavailable')
  return normalizeWindowResult(await rawNativeCapture.transcribeWindow(...args))
}

// Keep the existing string API for ordinary imports, including older native
// binaries. Diagnostics travel with one completed request, never a global map.
export const nativeCapture: NativeCaptureModule | null = rawNativeCapture ? {
  start: rawNativeCapture.start.bind(rawNativeCapture),
  stop: rawNativeCapture.stop.bind(rawNativeCapture),
  resume: rawNativeCapture.resume.bind(rawNativeCapture),
  getSnapshot: rawNativeCapture.getSnapshot.bind(rawNativeCapture),
  recoverSessions: rawNativeCapture.recoverSessions.bind(rawNativeCapture),
  markMaterialized: rawNativeCapture.markMaterialized.bind(rawNativeCapture),
  deleteCaptureAudio: rawNativeCapture.deleteCaptureAudio.bind(rawNativeCapture),
  inspectAudio: rawNativeCapture.inspectAudio.bind(rawNativeCapture),
  cancelTranscription: rawNativeCapture.cancelTranscription.bind(rawNativeCapture),
  addListener: rawNativeCapture.addListener.bind(rawNativeCapture),
  transcribeWindowWithDiagnostics,
  transcribeWindow: async (...args) => (await transcribeWindowWithDiagnostics(...args)).transcript,
  ...(rawNativeCapture.transcribeWindowWithBackend ? {
    transcribeWindowWithBackend: async (...args: Parameters<NonNullable<NativeCaptureModule['transcribeWindowWithBackend']>>) =>
      normalizeWindowResult(await rawNativeCapture.transcribeWindowWithBackend!(...args)),
  } : {}),
  ...(rawNativeCapture.getSpeechCapabilities ? {
    getSpeechCapabilities: rawNativeCapture.getSpeechCapabilities.bind(rawNativeCapture),
  } : {}),
} : null
