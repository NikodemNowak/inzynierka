import { AppState } from 'react-native'
import { cancelGeneration } from '../ai/llm'
import type { ProcessingExecutionContext } from '../ai/processingContext'
import { translate } from '../i18n/translate'
import {
  acquireProcessingJob,
  readProcessingCheckpoint,
  writeProcessingCheckpoint,
  stageProcessingResult,
  finishProcessingJob,
  type JobRequest,
} from '../data/processingJobsRepository'
import {
  nativeProcessing,
  supportsBackgroundProcessing,
} from './nativeProcessing'
import { parseSavedProcessingResult } from './savedResults'
import { nativeCapture } from '../stt/nativeCapture'
import {
  isImportContinuationActive,
  reportImportAiProgress,
  type ImportContinuation,
} from './importProcessing'

export class ProcessingPausedError extends Error {
  constructor(public readonly reason: string) {
    super(
      translate(
        'Opracowanie wstrzymano. Zapisany postęp będzie użyty po wznowieniu.',
        'Processing paused. Saved progress will be used when you resume.',
      ),
    )
    this.name = 'ProcessingPausedError'
  }
}

export interface ProcessingRunOptions {
  background?: boolean
  importContinuation?: ImportContinuation
}
interface ActiveAttempt {
  controller: AbortController
  background: boolean
  reason: string
}
const active = new Map<string, ActiveAttempt>()

export const hasBackgroundProcessingLease = (): boolean =>
  [...active.values()].some(
    (attempt) => attempt.background && !attempt.controller.signal.aborted,
  )

export const pauseAllProcessing = async (reason: string): Promise<void> => {
  for (const attempt of active.values()) {
    if (reason === 'background' && attempt.background) continue
    attempt.reason = reason
    attempt.controller.abort()
  }
  // The runtime drains the native completion before releasing its context.
  if ([...active.values()].some((attempt) => attempt.controller.signal.aborted))
    await cancelGeneration(reason)
}

export const pauseNoteProcessing = async (
  noteId: string,
  reason = 'user',
): Promise<void> => {
  const attempt = active.get(noteId)
  if (!attempt) return
  attempt.reason = reason
  attempt.controller.abort()
  await cancelGeneration(reason)
}

export const runDurableProcessing = async <T>(
  request: JobRequest,
  run: (context: ProcessingExecutionContext) => Promise<T>,
  commit: (result: T) => Promise<boolean>,
  options: ProcessingRunOptions = {},
  onFragmentProgress?: ProcessingExecutionContext['onProgress'],
  validateSavedResult?: (value: unknown) => value is T,
): Promise<T> => {
  const parent = options.importContinuation
  if (parent && !isImportContinuationActive(parent))
    throw new ProcessingPausedError('import-ended')
  if (active.has(request.noteId))
    throw new Error(
      translate(
        'Notatka jest już opracowywana.',
        'This note is already being processed.',
      ),
    )
  const attempt: ActiveAttempt = {
    controller: new AbortController(),
    background: parent?.background ?? false,
    reason: 'user',
  }
  let parentCancellation: Promise<void> | undefined
  const parentAborted = () => {
    attempt.reason = 'import-paused'
    attempt.controller.abort()
    parentCancellation = cancelGeneration(attempt.reason).catch(() => undefined)
  }
  parent?.signal.addEventListener('abort', parentAborted, { once: true })
  active.set(request.noteId, attempt)
  let job: Awaited<ReturnType<typeof acquireProcessingJob>>
  try {
    job = await acquireProcessingJob(request)
  } catch (error) {
    parent?.signal.removeEventListener('abort', parentAborted)
    active.delete(request.noteId)
    throw error
  }
  let expiredSubscription: { remove(): void } | undefined
  let committed = false
  let leaseRequested = false
  const assertActive = () => {
    if (attempt.controller.signal.aborted)
      throw new ProcessingPausedError(attempt.reason)
    if (parent && !isImportContinuationActive(parent))
      throw new ProcessingPausedError('import-ended')
  }
  try {
    if (
      (AppState.currentState === 'background' ||
        AppState.currentState === 'inactive') &&
      !(parent?.background && isImportContinuationActive(parent))
    )
      throw new ProcessingPausedError('background')
    const savedResult = parseSavedProcessingResult(
      job.result,
      validateSavedResult,
    )
    if (savedResult === null) {
      const capture = await nativeCapture?.getSnapshot()
      assertActive()
      if (
        capture?.manifest.state === 'recording' ||
        capture?.manifest.state === 'interrupted'
      )
        throw new Error(
          translate(
            'Zakończ bieżące nagranie przed opracowaniem notatki.',
            'Finish the current recording before processing a note.',
          ),
        )
    }
    if (options.background && !parent && savedResult === null) {
      if (!nativeProcessing || !supportsBackgroundProcessing())
        throw new Error(
          translate(
            'Opracowanie w tle nie jest dostępne. Wybierz pracę w otwartej aplikacji.',
            'Background processing is unavailable. Choose processing with the app open.',
          ),
        )
      expiredSubscription = nativeProcessing.addListener(
        'onProcessingExpired',
        (event) => {
          if (event.attemptId !== job.attemptId) return
          attempt.reason = event.reason
          attempt.controller.abort()
          void cancelGeneration(event.reason).catch(() => undefined)
        },
      )
      leaseRequested = true
      attempt.background = await nativeProcessing.begin(
        job.attemptId,
        translate('Opracowanie notatki', 'Processing note'),
        translate('Przygotowanie', 'Preparing'),
      )
      assertActive()
      if (!attempt.background)
        throw new Error(
          translate(
            'iOS nie przyznał teraz pracy w tle. Spróbuj ponownie lub pozostaw aplikację otwartą.',
            'iOS did not grant background processing. Try again or keep the app open.',
          ),
        )
      await nativeProcessing.prepareProtectedFiles()
    }
    assertActive()
    const result =
      savedResult ??
      (await run({
        signal: attempt.controller.signal,
        runtimeOptions: {
          execution: attempt.background ? 'background-cpu' : 'foreground',
          signal: attempt.controller.signal,
        },
        checkpoint: {
          read: async (key) => {
            assertActive()
            return readProcessingCheckpoint(job, key)
          },
          write: async (key, value) => {
            assertActive()
            await writeProcessingCheckpoint(job, key, value)
            assertActive()
          },
        },
        onProgress: (progress) => {
          if (attempt.controller.signal.aborted) return
          onFragmentProgress?.(progress)
          if (parent)
            reportImportAiProgress(
              parent,
              progress.phase,
              progress.completed,
              progress.total,
            )
          else if (attempt.background && nativeProcessing) {
            const fraction =
              progress.total > 0 ? progress.completed / progress.total : 0
            const completed =
              progress.phase === 'fragment'
                ? 1000 + fraction * 6500
                : progress.phase === 'reduction'
                  ? 7500 + fraction * 1700
                  : 1000 + fraction * 8000
            const description =
              progress.phase === 'tasks'
                ? translate('Szukanie zadań', 'Finding tasks')
                : translate('Analiza fragmentów', 'Analyzing sections')
            void nativeProcessing
              .update(
                job.attemptId,
                Math.floor(completed),
                translate('Opracowanie notatki', 'Processing note'),
                `${description} · ${progress.completed}/${progress.total}`,
              )
              .catch(() => undefined)
          }
        },
      }))
    assertActive()
    if (!(await stageProcessingResult(job, result)))
      throw new ProcessingPausedError('source-changed')
    assertActive()
    committed = await commit(result)
    if (committed && parent) reportImportAiProgress(parent, 'persist')
    await finishProcessingJob(
      job,
      committed
        ? request.kind === 'note'
          ? 'completed'
          : 'pending'
        : 'invalidated',
      committed ? null : 'source-changed',
    )
    if (committed && attempt.background) {
      await nativeProcessing
        ?.notifyCompleted(
          'processing-complete',
          translate('Notatka opracowana', 'Note processed'),
          translate(
            'Wynik jest gotowy w aplikacji Notatki.',
            'Your result is ready in Notes.',
          ),
        )
        .catch(() => undefined)
    }
    return result
  } catch (error) {
    await parentCancellation
    const paused =
      attempt.controller.signal.aborted ||
      error instanceof ProcessingPausedError
    const reason = attempt.controller.signal.aborted
      ? attempt.reason
      : error instanceof ProcessingPausedError
        ? error.reason
        : error instanceof Error
          ? error.message
          : String(error)
    await finishProcessingJob(job, paused ? 'paused' : 'failed', reason)
    if (paused) throw new ProcessingPausedError(reason)
    throw error
  } finally {
    parent?.signal.removeEventListener('abort', parentAborted)
    expiredSubscription?.remove()
    if (leaseRequested)
      await nativeProcessing
        ?.finish(job.attemptId, committed)
        .catch(() => undefined)
    if (active.get(request.noteId) === attempt) active.delete(request.noteId)
  }
}
