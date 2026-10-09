import { withDatabaseWrite } from '../db/writeQueue'
import { getDatabase } from '../db/database'

export interface RuntimeMetricMetadata {
  revision?: string
  sha256?: string
  execution?: string
  gpu?: boolean
  devices?: string[]
  systemInfo?: string
  os?: string
  osVersion?: string
  appVersion?: string
  appBuild?: string
  llamaBuild?: string
  llamaCommit?: string
  status?: string
  formattedPromptTokens?: number
  draftTokens?: number
  draftTokensAccepted?: number
  speculative?: boolean
  flags?: {
    truncated: boolean
    stoppedLimit: boolean
    contextFull: boolean
    interrupted: boolean
  }
}

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
  metadata?: RuntimeMetricMetadata | null
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
  metadata?: RuntimeMetricMetadata | null
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
  await withDatabaseWrite(() =>
    db.runAsync(
      'INSERT INTO metrics (id, phase, model, inputChars, ttftMs, tokensPerSecond, wallMs, promptMs, predictedMs, promptTokens, predictedTokens, createdAt, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    ),
  )
}

export const recordLlmOperation = async (
  input: LlmOperationMetricInput,
): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync(
      'INSERT INTO llm_operations (id, operation, model, inputChars, queueMs, modelLoadMs, totalMs, succeeded, createdAt, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    ),
  )
}

export const listMetrics = async (limit = 200): Promise<GenerationMetric[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<
    Omit<GenerationMetric, 'metadata'> & { metadata: string | null }
  >('SELECT * FROM metrics ORDER BY createdAt DESC LIMIT ?', [limit])
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata) }))
}

const parseMetadata = (
  encoded: string | null,
): RuntimeMetricMetadata | null => {
  if (!encoded) return null
  try {
    const parsed: unknown = JSON.parse(encoded)
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as RuntimeMetricMetadata)
      : null
  } catch {
    return null
  }
}

export const listLlmOperations = async (
  limit = 100,
): Promise<LlmOperationMetric[]> => {
  const db = await getDatabase()
  const rows = await db.getAllAsync<
    Omit<LlmOperationMetric, 'succeeded' | 'metadata'> & {
      succeeded: number
      metadata: string | null
    }
  >('SELECT * FROM llm_operations ORDER BY createdAt DESC LIMIT ?', [limit])
  return rows.map((row) => ({
    ...row,
    succeeded: row.succeeded === 1,
    metadata: parseMetadata(row.metadata),
  }))
}

export const clearMetrics = async (): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() => db.runAsync('DELETE FROM metrics'))
  await withDatabaseWrite(() => db.runAsync('DELETE FROM llm_operations'))
}
