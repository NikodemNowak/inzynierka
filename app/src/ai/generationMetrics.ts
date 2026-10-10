import {
  recordLlmOperation,
  recordMetric,
  type LlmOperationMetricInput,
  type RuntimeMetricMetadata,
} from '../data/metricsRepository'
import { BuildInfo } from 'llama.rn'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { MODEL_CONFIG } from './modelConfig'
import { getLoadedModelInfo, type GenerationResult } from './llm'

export interface ObservedGeneration {
  phase: string
  inputChars: number
  sourceChars: number
  result: GenerationResult
}
const observers = new Set<(event: ObservedGeneration) => void>()
export const observeGenerations = (
  observer: (event: ObservedGeneration) => void,
): (() => void) => {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}
export const runtimeMetricMetadata = (
  result?: GenerationResult,
): RuntimeMetricMetadata => {
  const info = result?.modelInfo ?? getLoadedModelInfo()
  return {
    revision: info?.model.revision,
    sha256: info?.model.sha256,
    execution: info?.execution,
    gpu: info?.gpu,
    devices: info?.devices,
    systemInfo: info?.systemInfo,
    speculative: info?.speculative,
    os: Platform.OS,
    osVersion: String(Platform.Version),
    appVersion: Constants.expoConfig?.version,
    appBuild: String(
      Platform.OS === 'ios'
        ? (Constants.expoConfig?.ios?.buildNumber ?? '')
        : (Constants.expoConfig?.android?.versionCode ?? ''),
    ),
    llamaBuild: BuildInfo?.number,
    llamaCommit: BuildInfo?.commit,
    status: result?.completion?.status,
    formattedPromptTokens: result?.formattedPromptTokens,
    draftTokens: result?.draftTokens,
    draftTokensAccepted: result?.draftTokensAccepted,
    flags: result?.completion
      ? {
          truncated: result.completion.truncated,
          stoppedLimit: result.completion.stoppedLimit,
          contextFull: result.completion.contextFull,
          interrupted: result.completion.interrupted,
        }
      : undefined,
  }
}

// Measuring must never be able to break generating: a failed write is dropped
// rather than propagated to the note the user is waiting for.
// sourceChars is the characters of the ORIGINAL note source embedded in this
// request. Call sites whose inputChars already is source-derived text omit it,
// so it defaults to inputChars; call sites whose inputChars is the whole prompt
// pass the source-derived count explicitly.
export const recordGeneration = (
  phase: string,
  inputChars: number,
  result: GenerationResult,
  sourceChars: number = inputChars,
): void => {
  for (const observer of observers) {
    try {
      observer({ phase, inputChars, sourceChars, result })
    } catch {
      /* measurement cannot break processing */
    }
  }
  void recordMetric({
    phase,
    model: result.modelInfo?.model.displayName ?? MODEL_CONFIG.displayName,
    inputChars,
    ttftMs: result.ttftMs,
    tokensPerSecond: result.tokensPerSecond,
    wallMs: result.wallMs,
    promptMs: result.promptMs,
    predictedMs: result.predictedMs,
    promptTokens: result.promptTokens,
    predictedTokens: result.predictedTokens,
    metadata: runtimeMetricMetadata(result),
  }).catch(() => undefined)
}

export const recordOperationTiming = (
  input: Omit<LlmOperationMetricInput, 'model'>,
): void => {
  void recordLlmOperation({
    ...input,
    model: getLoadedModelInfo()?.model.displayName ?? MODEL_CONFIG.displayName,
    metadata: runtimeMetricMetadata(),
  }).catch(() => undefined)
}
