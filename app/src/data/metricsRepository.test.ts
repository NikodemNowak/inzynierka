import type * as SQLite from 'expo-sqlite'
import { getDatabase } from '../db/database'
import { recordLlmOperation, recordMetric } from './metricsRepository'

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }))

const mockedGetDatabase = jest.mocked(getDatabase)
const mockDatabase = {
  runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
} as unknown as SQLite.SQLiteDatabase

describe('local LLM metrics persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetDatabase.mockResolvedValue(mockDatabase)
  })

  it('stores native prompt and generation measurements without note text', async () => {
    await recordMetric({
      phase: 'summary',
      model: 'Qwen3-4B (Q4_K_M)',
      inputChars: 363,
      ttftMs: 909,
      tokensPerSecond: 23.93,
      wallMs: 13_000,
      promptMs: 520,
      predictedMs: 12_000,
      promptTokens: 210,
      predictedTokens: 287,
    })

    expect(mockDatabase.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO metrics'),
      [
        expect.any(String),
        'summary',
        'Qwen3-4B (Q4_K_M)',
        363,
        909,
        23.93,
        13_000,
        520,
        12_000,
        210,
        287,
        expect.any(Number),
      ],
    )
  })

  it('stores queue, optional cold-load and total duration as separate operation data', async () => {
    await recordLlmOperation({
      operation: 'note',
      model: 'Qwen3-4B (Q4_K_M)',
      inputChars: 363,
      queueMs: 21,
      modelLoadMs: 4_200,
      totalMs: 16_154,
      succeeded: true,
    })

    expect(mockDatabase.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO llm_operations'),
      [
        expect.any(String),
        'note',
        'Qwen3-4B (Q4_K_M)',
        363,
        21,
        4_200,
        16_154,
        1,
        expect.any(Number),
      ],
    )
  })
})
