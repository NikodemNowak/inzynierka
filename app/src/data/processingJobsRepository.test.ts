import { getDatabase } from '../db/database'
import {
  acquireProcessingJob,
  discardPendingProcessingResult,
  findPendingProcessingResult,
  finishProcessingJob,
  recoverProcessingJobs,
  stageProcessingResult,
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
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string
  unlinkSync(path: string): void
  rmdirSync(path: string): void
}
const { tmpdir } = require('node:os') as { tmpdir(): string }
const { join } = require('node:path') as { join(...paths: string[]): string }
let sqlite: SyncDatabase
let directory: string
let databasePath: string

const connect = () => {
  sqlite = new DatabaseSync(databasePath)
  const adapter = {
    runAsync: async (sql: string, ...values: SqlValue[]) => {
      const result = sqlite.prepare(sql).run(...values)
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      }
    },
    getFirstAsync: async (sql: string, ...values: SqlValue[]) =>
      sqlite.prepare(sql).get(...values) ?? null,
    getAllAsync: async (sql: string, ...values: SqlValue[]) =>
      sqlite.prepare(sql).all(...values),
    withExclusiveTransactionAsync: async (
      operation: (transaction: unknown) => Promise<void>,
    ) => {
      sqlite.exec('BEGIN EXCLUSIVE')
      try {
        await operation(adapter)
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  jest
    .mocked(getDatabase)
    .mockResolvedValue(
      adapter as unknown as Awaited<ReturnType<typeof getDatabase>>,
    )
}

const request = {
  noteId: 'synthetic-note',
  kind: 'tasks' as const,
  source: 'source-v1',
  model: 'model-v1',
  pipeline: 'pipeline-v1',
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'notatki-jobs-'))
  databasePath = join(directory, 'synthetic.db')
  connect()
  sqlite.exec(
    'CREATE TABLE processing_jobs (id TEXT PRIMARY KEY,noteId TEXT,kind TEXT,source TEXT,model TEXT,pipeline TEXT,status TEXT,attemptId TEXT,checkpoints TEXT,result TEXT,reason TEXT,updatedAt INTEGER)',
  )
  sqlite.exec(
    'CREATE UNIQUE INDEX job_note_kind ON processing_jobs(noteId,kind)',
  )
})
afterEach(() => {
  sqlite.close()
  unlinkSync(databasePath)
  rmdirSync(directory)
})

test('keeps completed suggestions and evidence through a real SQLite reopen until explicit discard', async () => {
  const job = await acquireProcessingJob(request)
  await writeProcessingCheckpoint(job, 'fragment:1', { quote: 'source-v1' })
  expect(await stageProcessingResult(job, ['source-v1'])).toBe(true)
  await finishProcessingJob(job, 'pending')
  sqlite.close()
  connect()
  const recovered = await recoverProcessingJobs()
  expect(recovered).toEqual([
    expect.objectContaining({
      status: 'pending',
      result: '["source-v1"]',
      checkpoints: '{"fragment:1":{"quote":"source-v1"}}',
    }),
  ])
  await discardPendingProcessingResult(request.noteId, 'tasks', 'old-source')
  expect(await findPendingProcessingResult(request)).toBe('["source-v1"]')
  await discardPendingProcessingResult(request.noteId, 'tasks', request.source)
  expect(await findPendingProcessingResult(request)).toBeNull()
})

test('reacquires the same validated result with a new attempt and rejects old attempt writes', async () => {
  const previous = await acquireProcessingJob(request)
  await stageProcessingResult(previous, ['source-v1'])
  await finishProcessingJob(previous, 'pending')
  const next = await acquireProcessingJob(request)
  expect(next.result).toBe('["source-v1"]')
  expect(next.attemptId).not.toBe(previous.attemptId)
  await expect(
    writeProcessingCheckpoint(previous, 'late', 'late'),
  ).rejects.toThrow('no longer active')
  expect(await stageProcessingResult(previous, ['old'])).toBe(false)
})

test('never offers a completed suggestion to changed source or model identities', async () => {
  const job = await acquireProcessingJob(request)
  await stageProcessingResult(job, ['source-v1'])
  await finishProcessingJob(job, 'pending')
  expect(
    await findPendingProcessingResult({ ...request, source: 'changed' }),
  ).toBeNull()
  expect(
    await findPendingProcessingResult({ ...request, model: 'changed' }),
  ).toBeNull()
  const next = await acquireProcessingJob({ ...request, source: 'changed' })
  expect(next.result).toBeNull()
  expect(next.checkpoints).toBe('{}')
})
