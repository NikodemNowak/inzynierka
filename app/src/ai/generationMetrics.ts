import {
  recordLlmOperation,
  recordMetric,
  type LlmOperationMetricInput,
} from '../data/metricsRepository'
import { MODEL_CONFIG } from './modelConfig'
import type { GenerationResult } from './llm'

// Measuring must never be able to break generating: a failed write is dropped
// rather than propagated to the note the user is waiting for.
export const recordGeneration = (
  phase: string,
  inputChars: number,
  result: GenerationResult,
): void => {
  void recordMetric({
    phase,
    model: MODEL_CONFIG.displayName,
    inputChars,
    ttftMs: result.ttftMs,
    tokensPerSecond: result.tokensPerSecond,
    wallMs: result.wallMs,
    promptMs: result.promptMs,
    predictedMs: result.predictedMs,
    promptTokens: result.promptTokens,
    predictedTokens: result.predictedTokens,
  }).catch(() => undefined)
}

export const recordOperationTiming = (
  input: Omit<LlmOperationMetricInput, 'model'>,
): void => {
  void recordLlmOperation({
    ...input,
    model: MODEL_CONFIG.displayName,
  }).catch(() => undefined)
}
