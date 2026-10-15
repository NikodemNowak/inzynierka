import { AppState } from 'react-native'
import * as repository from '../data/processingJobsRepository'
import {
  runDurableProcessing,
  pauseAllProcessing,
  ProcessingPausedError,
} from './jobRunner'
import { nativeCapture } from '../stt/nativeCapture'
import { useNotesStore } from '../state/notesStore'
import * as notesRepository from '../data/notesRepository'
import { processNoteWithLlm, type NoteProcessingResult } from '../ai/noteProcessing'
import type { Note, NoteInput } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'
import { jobSourceIdentity, isReusableJob } from './jobIdentity'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { isNoteProcessingResult } from './savedResults'

jest.mock('../data/processingJobsRepository', () => ({
  acquireProcessingJob: jest.fn(),
  readProcessingCheckpoint: jest.fn(),
  writeProcessingCheckpoint: jest.fn(),
  stageProcessingResult: jest.fn(),
  finishProcessingJob: jest.fn(),
  recoverProcessingJobs: jest.fn(),
  invalidateProcessingJobs: jest.fn(),
  discardPendingProcessingResult: jest.fn(),
}))
jest.mock('../data/notesRepository', () => ({ listNotes: jest.fn(), updateNote: jest.fn() }))
jest.mock('../ai/noteProcessing', () => ({ processNoteWithLlm: jest.fn() }))
jest.mock('../ai/generationMetrics', () => ({ recordOperationTiming: jest.fn() }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: (job: () => Promise<void>) => job() }))
jest.mock('../audio/audioFiles', () => ({ deleteRecordingFile: jest.fn() }))
jest.mock('../state/tasksStore', () => ({ useTasksStore: { getState: () => ({ removeForNote: jest.fn() }) } }))
jest.mock('../state/modelStore', () => ({ useModelStore: { getState: () => ({ status: 'ready' }) } }))
jest.mock('./nativeProcessing', () => ({
  nativeProcessing: null,
  supportsBackgroundProcessing: () => false,
}))
jest.mock('../ai/llm', () => ({
  cancelGeneration: jest.fn(async () => undefined),
}))
jest.mock('../stt/nativeCapture', () => ({
  nativeCapture: { getSnapshot: jest.fn(async () => null) },
}))

const db = jest.mocked(repository)
const request = {
  noteId: 'n1',
  kind: 'note' as const,
  source: 'source',
  model: 'qwen',
  pipeline: 'v1',
}
beforeEach(() => {
  jest.clearAllMocks()
  AppState.currentState = 'active'
  db.acquireProcessingJob.mockResolvedValue({
    ...request,
    id: 'job1',
    status: 'running',
    attemptId: 'attempt1',
    checkpoints: '{}',
    result: null,
    reason: null,
    updatedAt: 1,
  })
  db.stageProcessingResult.mockResolvedValue(true)
  jest.mocked(nativeCapture!.getSnapshot).mockResolvedValue(null)
})

const linkedDocument: SummaryDocument = {
  version: 1, source: 'On Friday I have no classes.', format: 'bullets',
  points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 28 }] }],
}
const linkedResult: NoteProcessingResult = { title: 'Friday', summary: '• Friday: no classes.', summaryDocument: linkedDocument, tags: ['Nauka'] }
const reloadNote: Note = {
  id: 'reload-linked', title: 'Classes', content: 'On Friday I have no classes.', summary: '• Friday: no classes.',
  summaryDocument: null, tags: [], audioUri: null, durationMs: null, language: 'en', createdAt: 1, updatedAt: 1,
}

describe('real durable runner and store after application reload', () => {
  const notesDb = jest.mocked(notesRepository)
  const generate = jest.mocked(processNoteWithLlm)
  let savedJob: repository.ProcessingJob
  let committedInputs: NoteInput[]

  beforeEach(() => {
    committedInputs = []
    generate.mockReset().mockResolvedValue(linkedResult)
    useNotesStore.setState({ notes: [], loaded: false, proposals: {}, processing: {}, processingError: {}, resumableProcessing: {} })
    notesDb.listNotes.mockResolvedValue([reloadNote])
    notesDb.updateNote.mockImplementation(async (id, input) => {
      committedInputs.push(input)
      return { ...reloadNote, ...input, id, updatedAt: 2 }
    })
    savedJob = {
      id: 'saved-linked-job', noteId: reloadNote.id, kind: 'note', source: jobSourceIdentity(reloadNote), model: MODEL_CONFIG.url,
      pipeline: PIPELINE_VERSION, status: 'ready', attemptId: 'previous-process', checkpoints: '{"summary:part": {"source":"On Friday I have no classes."}}',
      result: JSON.stringify(linkedResult), reason: null, updatedAt: 1,
    }
    db.recoverProcessingJobs.mockImplementation(async () => [savedJob])
    db.acquireProcessingJob.mockImplementation(async (incoming) => ({
      ...incoming, id: 'acquired-job', status: 'running', attemptId: 'new-process', reason: null, updatedAt: 2,
      checkpoints: isReusableJob(savedJob, incoming.source, incoming.model, incoming.pipeline) ? savedJob.checkpoints : '{}',
      result: isReusableJob(savedJob, incoming.source, incoming.model, incoming.pipeline) ? savedJob.result : null,
    }))
    db.readProcessingCheckpoint.mockImplementation(async (job, key) => {
      const checkpoints = JSON.parse(job.checkpoints) as Record<string, unknown>
      return checkpoints[key] ?? null
    })
  })

  it('resumes a ready linked result through load, runner, store and atomic repository input', async () => {
    await useNotesStore.getState().load()
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(generate).not.toHaveBeenCalled()
    expect(committedInputs).toEqual([{
      title: 'Friday', content: 'On Friday I have no classes.', summary: '• Friday: no classes.', summaryDocument: linkedDocument,
      tags: ['Nauka'], audioUri: null, durationMs: null, language: 'en', transcriptionIncomplete: undefined,
    }])
    expect(useNotesStore.getState().notes[0]).toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
    expect(JSON.parse(db.acquireProcessingJob.mock.calls[0][0].source)).toMatchObject({ content: 'On Friday I have no classes.', summaryDocument: null })
  })

  it.each(['content', 'metadata'] as const)('makes no note commit after a %s-only revision during ready-result acquisition', async (revision) => {
    await useNotesStore.getState().load()
    const acquire = db.acquireProcessingJob.getMockImplementation()!
    db.acquireProcessingJob.mockImplementationOnce(async (incoming) => {
      useNotesStore.setState({ notes: [{ ...reloadNote, ...(revision === 'content' ? { content: 'On Monday I have no classes.' } : { summaryDocument: linkedDocument }) }] })
      return acquire(incoming)
    })
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(committedInputs).toEqual([])
    expect(generate).not.toHaveBeenCalled()
    expect(db.finishProcessingJob).toHaveBeenCalledWith(expect.anything(), 'invalidated', 'source-changed')
  })

  it('cannot commit a self-consistent saved document bound to another transcript even with identical summary text', async () => {
    savedJob.result = JSON.stringify({ ...linkedResult, summaryDocument: { ...linkedDocument, source: 'On Monday I have no classes.' } })
    await useNotesStore.getState().load()
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(generate).not.toHaveBeenCalled()
    expect(committedInputs).toEqual([])
    expect(useNotesStore.getState().notes[0]).toEqual(reloadNote)
  })

  it.each(['source', 'metadata', 'pipeline'] as const)('discards a paused checkpoint/result on a changed %s and generates a fresh pair', async (changed) => {
    savedJob.status = 'paused'
    if (changed === 'source') savedJob.source = jobSourceIdentity({ ...reloadNote, content: 'On Monday I have no classes.' })
    if (changed === 'metadata') savedJob.source = jobSourceIdentity({ ...reloadNote, summaryDocument: linkedDocument })
    if (changed === 'pipeline') savedJob.pipeline = 'source-evidence-v39'
    let observedCheckpoint: unknown
    generate.mockImplementationOnce(async (_content, _progress, _load, _language, execution) => {
      observedCheckpoint = await execution?.checkpoint?.read('summary:part')
      return linkedResult
    })
    await useNotesStore.getState().load()
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(observedCheckpoint).toBeNull()
    expect(committedInputs[0]).toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it('reuses a current paused checkpoint after reload and keeps the old pair when summary fails', async () => {
    const existing = { ...reloadNote, summaryDocument: linkedDocument }
    notesDb.listNotes.mockResolvedValue([existing])
    savedJob.source = jobSourceIdentity(existing)
    savedJob.status = 'paused'
    savedJob.result = null
    let observedCheckpoint: unknown
    generate.mockImplementationOnce(async (_content, _progress, _load, _language, execution) => {
      observedCheckpoint = await execution?.checkpoint?.read('summary:part')
      return { title: 'Retained Friday', summary: '', summaryDocument: null, tags: [], failedFields: ['summary'] }
    })
    await useNotesStore.getState().load()
    await useNotesStore.getState().resumeProcessing(existing.id)
    expect(observedCheckpoint).toEqual({ source: 'On Friday I have no classes.' })
    expect(committedInputs[0]).toMatchObject({ title: 'Retained Friday', summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it('regenerates corrupt present saved metadata instead of publishing the saved text', async () => {
    savedJob.result = JSON.stringify({ ...linkedResult, title: 'Corrupt saved title', summaryDocument: { ...linkedDocument, version: 2 } })
    await useNotesStore.getState().load()
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(committedInputs[0]).toMatchObject({ title: 'Friday', summaryDocument: linkedDocument })
  })

  it('retains existing valid links when a restored pending proposal applies only its title', async () => {
    const existing = { ...reloadNote, summaryDocument: linkedDocument }
    notesDb.listNotes.mockResolvedValue([existing])
    savedJob.source = jobSourceIdentity(existing)
    savedJob.kind = 'proposal'
    savedJob.status = 'pending'
    savedJob.result = JSON.stringify({ ...linkedResult, summary: 'New plain summary', summaryDocument: null })
    await useNotesStore.getState().load()
    expect(useNotesStore.getState().proposals[existing.id].source.summaryDocument).toEqual(linkedDocument)
    expect(await useNotesStore.getState().applyProposal(existing.id, { title: true, summary: false, tags: false })).toBe(true)
    expect(generate).not.toHaveBeenCalled()
    expect(committedInputs[0]).toMatchObject({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it.each(['metadata', 'foreign document'] as const)('does not restore or commit a pending proposal with %s mismatch', async (mismatch) => {
    savedJob.kind = 'proposal'
    savedJob.status = 'pending'
    if (mismatch === 'metadata') notesDb.listNotes.mockResolvedValue([{ ...reloadNote, summaryDocument: linkedDocument }])
    else savedJob.result = JSON.stringify({ ...linkedResult, summaryDocument: { ...linkedDocument, source: 'On Monday I have no classes.' } })
    await useNotesStore.getState().load()
    expect(useNotesStore.getState().proposals[reloadNote.id]).toBeUndefined()
    expect(await useNotesStore.getState().applyProposal(reloadNote.id, { title: true, summary: true, tags: true })).toBe(false)
    expect(committedInputs).toEqual([])
  })

  it('rejects changed source ranges between two linked revisions with identical text and timestamp', async () => {
    const document: SummaryDocument = { version: 1, source: 'Friday. Friday.', format: 'bullets', points: [{ text: 'Friday.', sources: [{ start: 0, end: 7 }] }] }
    const existing: Note = { ...reloadNote, content: 'Friday. Friday.', summary: '• Friday.', summaryDocument: document }
    notesDb.listNotes.mockResolvedValue([existing])
    savedJob.source = jobSourceIdentity(existing)
    savedJob.result = JSON.stringify({ ...linkedResult, summary: '• Friday.', summaryDocument: document })
    await useNotesStore.getState().load()
    const acquire = db.acquireProcessingJob.getMockImplementation()!
    db.acquireProcessingJob.mockImplementationOnce(async (incoming) => {
      useNotesStore.setState({ notes: [{ ...existing, summaryDocument: { ...document, points: [{ text: 'Friday.', sources: [{ start: 8, end: 15 }] }] } }] })
      return acquire(incoming)
    })
    await useNotesStore.getState().resumeProcessing(existing.id)
    expect(committedInputs).toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps the old pair when a ready document is aborted after durable staging', async () => {
    await useNotesStore.getState().load()
    db.stageProcessingResult.mockImplementationOnce(async () => {
      await pauseAllProcessing('user')
      return true
    })
    await useNotesStore.getState().resumeProcessing(reloadNote.id)
    expect(committedInputs).toEqual([])
    expect(useNotesStore.getState().notes[0]).toEqual(reloadNote)
    expect(useNotesStore.getState().resumableProcessing[reloadNote.id]).toBe('note')
    expect(db.finishProcessingJob).toHaveBeenCalledWith(expect.anything(), 'paused', 'user')
  })
})

it('delivers a validated persisted document to the real runner commit callback', async () => {
  db.acquireProcessingJob.mockResolvedValueOnce({ ...request, id: 'linked', status: 'running', attemptId: 'new', checkpoints: '{}', result: JSON.stringify(linkedResult), reason: null, updatedAt: 1 })
  const run = jest.fn(async () => linkedResult)
  const committed: NoteProcessingResult[] = []
  await runDurableProcessing(request, run, async (result) => { committed.push(result); return true }, {}, undefined, isNoteProcessingResult)
  expect(run).not.toHaveBeenCalled()
  expect(committed).toEqual([{ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: linkedDocument, tags: ['Nauka'] }])
})

it('marks success only after durable output is accepted by the note writer', async () => {
  const commit = jest.fn(async () => false)
  await runDurableProcessing(request, async () => 'result', commit)
  expect(db.stageProcessingResult).toHaveBeenCalledWith(
    expect.anything(),
    'result',
  )
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'invalidated',
    'source-changed',
  )
})

it('never commits a generation whose attempt was invalidated on disk', async () => {
  db.stageProcessingResult.mockResolvedValue(false)
  const commit = jest.fn(async () => true)
  await expect(
    runDurableProcessing(request, async () => 'result', commit),
  ).rejects.toThrow()
  expect(commit).not.toHaveBeenCalled()
})

it('preserves checkpoints but rejects late results when interrupted', async () => {
  let finish: (value: string) => void = () => undefined
  const result = new Promise<string>((resolve) => {
    finish = resolve
  })
  let started: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const commit = jest.fn(async () => true)
  const running = runDurableProcessing(
    request,
    async () => {
      started()
      return result
    },
    commit,
  )
  await ready
  await pauseAllProcessing('background')
  finish('late')
  await expect(running).rejects.toBeInstanceOf(ProcessingPausedError)
  expect(commit).not.toHaveBeenCalled()
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'paused',
    'background',
  )
})

it('does not declare success if the note database write fails', async () => {
  await expect(
    runDurableProcessing(
      request,
      async () => 'result',
      async () => {
        throw new Error('disk full')
      },
    ),
  ).rejects.toThrow('disk full')
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'failed',
    'disk full',
  )
})

it('reserves a note before the asynchronous checkpoint acquisition', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  db.acquireProcessingJob.mockImplementationOnce(async () => {
    await gate
    return {
      ...request,
      id: 'job1',
      status: 'running',
      attemptId: 'attempt1',
      checkpoints: '{}',
      result: null,
      reason: null,
      updatedAt: 1,
    }
  })
  const first = runDurableProcessing(
    request,
    async () => 'ok',
    async () => true,
  )
  const second = runDurableProcessing(
    request,
    async () => 'duplicate',
    async () => true,
  )
  const check = expect(second).rejects.toThrow()
  release()
  await first
  await check
})

it('retains a durable task suggestion after the view that requested it is gone', async () => {
  const taskRequest = { ...request, kind: 'tasks' as const }
  db.acquireProcessingJob.mockResolvedValueOnce({
    ...taskRequest,
    id: 'task-job',
    status: 'running',
    attemptId: 'task-attempt',
    checkpoints: '{}',
    result: null,
    reason: null,
    updatedAt: 1,
  })
  await runDurableProcessing(
    taskRequest,
    async () => ['Send report'],
    async () => true,
  )
  expect(db.finishProcessingJob).toHaveBeenCalledWith(
    expect.anything(),
    'pending',
    null,
  )
  expect(db.stageProcessingResult).toHaveBeenCalledWith(expect.anything(), [
    'Send report',
  ])
})

it('reuses a validated persisted suggestion after restart without generating again', async () => {
  const taskRequest = { ...request, kind: 'tasks' as const }
  db.acquireProcessingJob.mockResolvedValueOnce({
    ...taskRequest,
    id: 'task-job',
    status: 'running',
    attemptId: 'new-attempt',
    checkpoints: '{}',
    result: '["Send report"]',
    reason: null,
    updatedAt: 1,
  })
  const run = jest.fn(async () => ['Incorrect repeated result'])
  const found = await runDurableProcessing(
    taskRequest,
    run,
    async () => true,
    {},
    undefined,
    (value): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === 'string'),
  )
  expect(found).toEqual(['Send report'])
  expect(run).not.toHaveBeenCalled()
})

it.each(['recording', 'interrupted'] as const)(
  'does not start model work while native capture is %s',
  async (state) => {
    jest
      .mocked(nativeCapture!.getSnapshot)
      .mockResolvedValue({
        manifest: {
          version: 1,
          sessionId: 'capture-synthetic',
          language: 'pl',
          state,
          startedAt: 1,
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          frames: 0,
          segments: [],
          gaps: [],
          needsTranscription: false,
        },
        directory: 'file:///synthetic/capture',
        volumeLevel: 0,
        cursor: 0,
      })
    const run = jest.fn(async () => ['report'])
    await expect(
      runDurableProcessing(request, run, async () => true),
    ).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  },
)
