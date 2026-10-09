import { getDatabase } from '../db/database'
import { recordMetric } from './metricsRepository'
import {
  acquireProcessingJob,
  writeProcessingCheckpoint,
} from './processingJobsRepository'

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }))

type SqlValue = string | number | null
interface SyncDatabase {
  exec(sql: string): void
  close(): void
  prepare(sql: string): {
    run(...values: SqlValue[]): {
      changes: number | bigint
      lastInsertRowid: number | bigint
    }
    get(...values: SqlValue[]): unknown
    all(...values: SqlValue[]): unknown[]
  }
}
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SyncDatabase
}
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void
}
const { tmpdir } = require('node:os') as { tmpdir(): string }
const { join } = require('node:path') as { join(...paths: string[]): string }
const metricInput = {
  phase: 'tasks',
  model: 'synthetic',
  inputChars: 20,
  ttftMs: 1,
  tokensPerSecond: 1,
  wallMs: 2,
  promptMs: 1,
  predictedMs: 1,
  promptTokens: 1,
  predictedTokens: 1,
}

test('persists a checkpoint and concurrent generation metrics on separate WAL connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'notatki-write-race-'))
  const path = join(directory, 'synthetic.db')
  const primary = new DatabaseSync(path)
  let metric: Promise<void> | undefined
  const adapterFor = (connection: SyncDatabase) => ({
    runAsync: async (sql: string, ...args: (SqlValue | SqlValue[])[]) => {
      const result = connection.prepare(sql).run(...args.flat())
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      }
    },
    getFirstAsync: async (sql: string, ...args: (SqlValue | SqlValue[])[]) => {
      const row = connection.prepare(sql).get(...args.flat()) ?? null
      if (
        connection !== primary &&
        sql.startsWith('SELECT checkpoints') &&
        metric === undefined
      ) {
        // Faithful Expo ordering: deferred transaction has read its snapshot,
        // while the non-awaited generation metric requests a separate write.
        metric = recordMetric(metricInput)
        await Promise.resolve()
        await Promise.resolve()
      }
      return row
    },
  })
  const adapter = {
    ...adapterFor(primary),
    withExclusiveTransactionAsync: async (
      operation: (tx: unknown) => Promise<void>,
    ) => {
      // expo-sqlite 56 uses a new connection and BEGIN, not BEGIN EXCLUSIVE.
      const transaction = new DatabaseSync(path)
      transaction.exec('BEGIN')
      try {
        await operation(adapterFor(transaction))
        transaction.exec('COMMIT')
      } catch (error) {
        transaction.exec('ROLLBACK')
        throw error
      } finally {
        transaction.close()
      }
    },
  }
  jest
    .mocked(getDatabase)
    .mockResolvedValue(
      adapter as unknown as Awaited<ReturnType<typeof getDatabase>>,
    )
  try {
    primary.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE processing_jobs (id TEXT PRIMARY KEY,noteId TEXT,kind TEXT,source TEXT,model TEXT,pipeline TEXT,status TEXT,attemptId TEXT,checkpoints TEXT,result TEXT,reason TEXT,updatedAt INTEGER);
      CREATE TABLE metrics (id TEXT,phase TEXT,model TEXT,inputChars INTEGER,ttftMs INTEGER,tokensPerSecond REAL,wallMs INTEGER,promptMs INTEGER,predictedMs INTEGER,promptTokens INTEGER,predictedTokens INTEGER,createdAt INTEGER,metadata TEXT);`)
    const job = await acquireProcessingJob({
      noteId: 'synthetic-note',
      kind: 'tasks',
      source: 'Alice will send the report.',
      model: 'synthetic',
      pipeline: 'synthetic-v1',
    })
    await writeProcessingCheckpoint(job, 'tasks:0:26', { validEvidence: true })
    await metric
    expect(
      primary.prepare('SELECT checkpoints FROM processing_jobs').get(),
    ).toEqual(
      expect.objectContaining({
        checkpoints: '{"tasks:0:26":{"validEvidence":true}}',
      }),
    )
    expect(primary.prepare('SELECT * FROM metrics').all()).toHaveLength(1)
    primary.exec('DROP TABLE metrics')
    await expect(recordMetric(metricInput)).rejects.toThrow('no such table')
    // A real SQL failure remains visible and does not poison the writer queue.
    await writeProcessingCheckpoint(job, 'after-error', true)
    await metric?.catch(() => undefined)
    expect(
      primary.prepare('SELECT checkpoints FROM processing_jobs').get(),
    ).toEqual(
      expect.objectContaining({
        checkpoints: '{"tasks:0:26":{"validEvidence":true},"after-error":true}',
      }),
    )
  } finally {
    await metric?.catch(() => undefined)
    primary.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
