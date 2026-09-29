import { getDatabase } from '../db/database'

export interface GenerationMetric {
  id: string
  phase: string
  model: string
  inputChars: number
  ttftMs: number
  tokensPerSecond: number
  wallMs: number | null
  promptMs: number | null
  predictedMs: number | null
  promptTokens: number | null
  predictedTokens: number | null
  createdAt: number
}

export type GenerationMetricInput = Omit<
  GenerationMetric,
  | 'id'
  | 'createdAt'
  | 'wallMs'
  | 'promptMs'
  | 'predictedMs'
  | 'promptTokens'
  | 'predictedTokens'
> & {
  wallMs: number
  promptMs: number
  predictedMs: number
  promptTokens: number
  predictedTokens: number
}

export interface LlmOperationMetric {
  id: string
  operation: 'note' | 'proposal' | 'tasks'
  model: string
  inputChars: number
  queueMs: number
  modelLoadMs: number | null
  totalMs: number
  succeeded: boolean
  createdAt: number
}

export type LlmOperationMetricInput = Omit<
  LlmOperationMetric,
  'id' | 'createdAt'
>

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Kept on the device rather than logged, so the numbers behind the performance
// criteria survive a restart and leave with the export instead of being read
// off a console.
export const recordMetric = async (
  input: GenerationMetricInput,
): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync(
    'INSERT INTO metrics (id, phase, model, inputChars, ttftMs, tokensPerSecond, wallMs, promptMs, predictedMs, promptTokens, predictedTokens, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      input.phase,
      input.model,
      input.inputChars,
      Math.round(input.ttftMs),
      input.tokensPerSecond,
      Math.round(input.wallMs),
      Math.round(input.promptMs),
      Math.round(input.predictedMs),
      input.promptTokens,
      input.predictedTokens,
      Date.now(),
    ],
  )
}

export const recordLlmOperation = async (
  input: LlmOperationMetricInput,
): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync(
    'INSERT INTO llm_operations (id, operation, model, inputChars, queueMs, modelLoadMs, totalMs, succeeded, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      input.operation,
      input.model,
      input.inputChars,
      Math.round(input.queueMs),
      input.modelLoadMs === null ? null : Math.round(input.modelLoadMs),
      Math.round(input.totalMs),
      input.succeeded ? 1 : 0,
      Date.now(),
    ],
  )
}

export const listMetrics = async (limit = 200): Promise<GenerationMetric[]> => {
  const db = await getDatabase()
  return db.getAllAsync<GenerationMetric>(
    'SELECT * FROM metrics ORDER BY createdAt DESC LIMIT ?',
    [limit],
  )
}

export const listLlmOperations = async (
  limit = 100,
): Promise<LlmOperationMetric[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<
    Omit<LlmOperationMetric, 'succeeded'> & { succeeded: number }
  >('SELECT * FROM llm_operations ORDER BY createdAt DESC LIMIT ?', [limit])
  return rows.map((row) => ({ ...row, succeeded: row.succeeded === 1 }))
}

export const clearMetrics = async (): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM metrics')
  await db.runAsync('DELETE FROM llm_operations')
}
