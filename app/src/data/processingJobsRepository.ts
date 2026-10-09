import { withDatabaseWrite } from '../db/writeQueue'
import { getDatabase } from '../db/database'
import { decodeCheckpointMap, isReusableJob } from '../processing/jobIdentity'

export type ProcessingJobKind = 'note' | 'proposal' | 'tasks'
export type ProcessingJobStatus =
  | 'running'
  | 'paused'
  | 'failed'
  | 'ready'
  | 'pending'
  | 'completed'
  | 'invalidated'
export interface ProcessingJob {
  id: string
  noteId: string
  kind: ProcessingJobKind
  source: string
  model: string
  pipeline: string
  status: ProcessingJobStatus
  attemptId: string
  checkpoints: string
  result: string | null
  reason: string | null
  updatedAt: number
}
export type JobRequest = Pick<
  ProcessingJob,
  'noteId' | 'kind' | 'source' | 'model' | 'pipeline'
>
export const newProcessingId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

export const acquireProcessingJob = async (
  request: JobRequest,
): Promise<ProcessingJob> => {
  const db = await getDatabase()
  let acquired: ProcessingJob | null = null
  await withDatabaseWrite(() =>
    db.withExclusiveTransactionAsync(async (tx) => {
      const previous = await tx.getFirstAsync<ProcessingJob>(
        'SELECT * FROM processing_jobs WHERE noteId = ? AND kind = ? ORDER BY updatedAt DESC LIMIT 1',
        request.noteId,
        request.kind,
      )
      const reusable =
        previous &&
        isReusableJob(previous, request.source, request.model, request.pipeline)
      // A new attempt fences every callback from the previous process/attempt.
      acquired = {
        ...request,
        id: reusable ? previous.id : newProcessingId(),
        status: 'running',
        attemptId: newProcessingId(),
        checkpoints: reusable ? previous.checkpoints : '{}',
        result: reusable ? previous.result : null,
        reason: null,
        updatedAt: Date.now(),
      }
      await tx.runAsync(
        'DELETE FROM processing_jobs WHERE noteId = ? AND kind = ?',
        request.noteId,
        request.kind,
      )
      await tx.runAsync(
        `INSERT INTO processing_jobs (id,noteId,kind,source,model,pipeline,status,attemptId,checkpoints,result,reason,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        acquired.id,
        acquired.noteId,
        acquired.kind,
        acquired.source,
        acquired.model,
        acquired.pipeline,
        acquired.status,
        acquired.attemptId,
        acquired.checkpoints,
        acquired.result,
        null,
        acquired.updatedAt,
      )
    }),
  )
  if (!acquired) throw new Error('Unable to acquire processing job')
  return acquired
}

export const readProcessingCheckpoint = async (
  job: ProcessingJob,
  key: string,
): Promise<unknown | null> => {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ checkpoints: string }>(
    "SELECT checkpoints FROM processing_jobs WHERE id = ? AND attemptId = ? AND status = 'running'",
    job.id,
    job.attemptId,
  )
  if (!row) throw new Error('Processing attempt is no longer active')
  const values = decodeCheckpointMap(row.checkpoints)
  return Object.hasOwn(values, key) ? values[key] : null
}

export const writeProcessingCheckpoint = async (
  job: ProcessingJob,
  key: string,
  value: unknown,
): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ checkpoints: string }>(
        "SELECT checkpoints FROM processing_jobs WHERE id = ? AND attemptId = ? AND status = 'running'",
        job.id,
        job.attemptId,
      )
      if (!row) throw new Error('Processing attempt is no longer active')
      const values = decodeCheckpointMap(row.checkpoints)
      Object.defineProperty(values, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
      await tx.runAsync(
        "UPDATE processing_jobs SET checkpoints = ?, updatedAt = ? WHERE id = ? AND attemptId = ? AND status = 'running'",
        JSON.stringify(values),
        Date.now(),
        job.id,
        job.attemptId,
      )
    }),
  )
}

export const stageProcessingResult = async (
  job: ProcessingJob,
  result: unknown,
): Promise<boolean> => {
  const db = await getDatabase()
  const update = await withDatabaseWrite(() =>
    db.runAsync(
      "UPDATE processing_jobs SET result = ?, status = 'ready', updatedAt = ? WHERE id = ? AND attemptId = ? AND status = 'running'",
      JSON.stringify(result),
      Date.now(),
      job.id,
      job.attemptId,
    ),
  )
  return update.changes === 1
}

export const finishProcessingJob = async (
  job: ProcessingJob,
  status: 'completed' | 'paused' | 'failed' | 'pending' | 'invalidated',
  reason: string | null = null,
): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync(
      `UPDATE processing_jobs SET status = ?, reason = ?, updatedAt = ?, checkpoints = CASE WHEN ? IN ('completed','invalidated') THEN '{}' ELSE checkpoints END,
     result = CASE WHEN ? IN ('completed','invalidated') THEN NULL ELSE result END
     WHERE id = ? AND attemptId = ? AND status IN ('running','ready')`,
      status,
      reason,
      Date.now(),
      status,
      status,
      job.id,
      job.attemptId,
    ),
  )
}

export const invalidateProcessingJobs = async (
  noteId: string,
): Promise<void> => {
  const db = await getDatabase()
  // Deleting a note must also remove its private checkpoint text.
  await withDatabaseWrite(() =>
    db.runAsync('DELETE FROM processing_jobs WHERE noteId = ?', noteId),
  )
}

export const findPendingProcessingResult = async (
  request: JobRequest,
): Promise<string | null> => {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ result: string | null }>(
    "SELECT result FROM processing_jobs WHERE noteId = ? AND kind = ? AND source = ? AND model = ? AND pipeline = ? AND status = 'pending'",
    request.noteId,
    request.kind,
    request.source,
    request.model,
    request.pipeline,
  )
  return row?.result ?? null
}

export const discardPendingProcessingResult = async (
  noteId: string,
  kind: 'proposal' | 'tasks',
  source: string,
): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync(
      "DELETE FROM processing_jobs WHERE noteId = ? AND kind = ? AND source = ? AND status = 'pending'",
      noteId,
      kind,
      source,
    ),
  )
}

export const recoverProcessingJobs = async (): Promise<ProcessingJob[]> => {
  const db = await getDatabase()
  await withDatabaseWrite(() =>
    db.runAsync(
      "UPDATE processing_jobs SET status = 'paused', reason = 'restart' WHERE status IN ('running','ready')",
    ),
  )
  return db.getAllAsync<ProcessingJob>(
    "SELECT * FROM processing_jobs WHERE status IN ('paused','failed','pending') ORDER BY updatedAt DESC",
  )
}
