import { getDatabase } from '../db/database'

export interface GenerationMetric {
  id: string
  phase: string
  model: string
  inputChars: number
  ttftMs: number
  tokensPerSecond: number
  createdAt: number
}

export type GenerationMetricInput = Omit<GenerationMetric, 'id' | 'createdAt'>

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Kept on the device rather than logged, so the numbers behind the performance
// criteria survive a restart and leave with the export instead of being read
// off a console.
export const recordMetric = async (input: GenerationMetricInput): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync(
    'INSERT INTO metrics (id, phase, model, inputChars, ttftMs, tokensPerSecond, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      input.phase,
      input.model,
      input.inputChars,
      Math.round(input.ttftMs),
      input.tokensPerSecond,
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

export const clearMetrics = async (): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM metrics')
}
