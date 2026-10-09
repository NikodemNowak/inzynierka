import type { Note, NoteInput } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'
import { AppState } from 'react-native'
import { waitForForeground } from '../ai/foreground'
import type { NoteProcessingResult } from '../ai/noteProcessing'
import * as repository from '../data/notesRepository'
import { processNoteWithLlm } from '../ai/noteProcessing'
import { useNotesStore } from './notesStore'
import { recordOperationTiming } from '../ai/generationMetrics'
import { enqueueLlm } from '../ai/llmQueue'
import {
  recoverProcessingJobs,
  invalidateProcessingJobs,
  discardPendingProcessingResult,
} from '../data/processingJobsRepository'
import { createNoteProposal } from '../notes/noteProposals'
import { jobSourceIdentity } from '../processing/jobIdentity'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { runImportProcessing } from '../processing/importProcessing'

jest.mock('../processing/nativeProcessing', () => ({
  supportsBackgroundProcessing: () => true,
  nativeProcessing: {
    begin: jest.fn(async () => true),
    prepareProtectedFiles: jest.fn(async () => undefined),
    finish: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}))

jest.mock('../processing/jobRunner', () => ({
  pauseNoteProcessing: jest.fn(async () => undefined),
  runDurableProcessing: async (
    _request: unknown,
    run: (context: object) => Promise<unknown>,
    commit: (result: unknown) => Promise<boolean>,
  ) => {
    const result = await run({})
    await commit(result)
    return result
  },
}))
jest.mock('../data/processingJobsRepository', () => ({
  recoverProcessingJobs: jest.fn(async () => []),
  invalidateProcessingJobs: jest.fn(async () => undefined),
  discardPendingProcessingResult: jest.fn(async () => undefined),
}))

jest.mock('../data/notesRepository', () => ({
  listNotes: jest.fn(),
  getNote: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}))

jest.mock('../ai/noteProcessing', () => ({ processNoteWithLlm: jest.fn() }))
jest.mock('../ai/foreground', () => ({ waitForForeground: jest.fn() }))
jest.mock('../ai/generationMetrics', () => ({
  recordOperationTiming: jest.fn(),
}))
jest.mock('../ai/llmQueue', () => ({
  enqueueLlm: jest.fn((job: () => Promise<void>) => job()),
}))
jest.mock('../audio/audioFiles', () => ({ deleteRecordingFile: jest.fn() }))
jest.mock('./tasksStore', () => ({
  useTasksStore: { getState: () => ({ removeForNote: jest.fn() }) },
}))
jest.mock('./modelStore', () => ({
  useModelStore: { getState: () => ({ status: 'ready' }) },
}))

const mockedRepository = jest.mocked(repository)
const mockedProcessNoteWithLlm = jest.mocked(processNoteWithLlm)

const makeNote = (id = 'note-regression'): Note => ({
  id,
  title: 'Spotkanie z promotorem',
  content: 'Omówiliśmy wyniki testów i dalszy plan.',
  summary: 'Omówiliśmy wyniki.',
  tags: ['Praca'],
  audioUri: 'file:///notes/one.m4a',
  durationMs: 42_000,
  createdAt: 10,
  updatedAt: 20,
  language: 'pl',
})

const toInput = (note: Note): NoteInput => ({
  title: note.title,
  content: note.content,
  summary: note.summary,
  summaryDocument: note.summaryDocument ?? null,
  tags: note.tags,
  audioUri: note.audioUri,
  durationMs: note.durationMs,
  language: note.language,
})

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const generated: NoteProcessingResult = {
  title: 'Plan dalszych badań',
  summary: 'Przygotować porównanie i prezentację.',
  tags: ['Nauka'],
}

const sourceDocument: SummaryDocument = {
  version: 1, source: 'On Friday I have no classes.', format: 'bullets',
  points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 28 }] }],
}
const sourceNote = (id: string): Note => ({
  ...makeNote(id), content: 'On Friday I have no classes.', summary: '• Friday: no classes.',
  summaryDocument: sourceDocument, language: 'en',
})

describe('notesStore background processing safeguards', () => {
  beforeEach(() => {
    AppState.currentState = 'active'
    jest.clearAllMocks()
    jest.mocked(waitForForeground).mockReset()
    mockedProcessNoteWithLlm.mockReset()
    jest.mocked(discardPendingProcessingResult).mockReset().mockResolvedValue()
    jest.mocked(enqueueLlm).mockImplementation((job) => job())
    mockedRepository.updateNote.mockImplementation(async (id, input) => ({
      ...makeNote(id),
      ...input,
      id,
      updatedAt: 30,
    }))
    mockedRepository.deleteNote.mockResolvedValue()
    useNotesStore.setState({
      notes: [],
      loaded: true,
      processing: {},
      processingError: {},
      proposals: {},
    })
  })

  afterEach(() => {
    AppState.currentState = 'active'
  })

  it('commits newly linked identical text together with its document', async () => {
    const note = { ...sourceNote('metadata-commit'), summaryDocument: null }
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: sourceDocument, tags: [] })
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(note.id, expect.objectContaining({ summary: '• Friday: no classes.', summaryDocument: sourceDocument }))
    expect(useNotesStore.getState().notes[0].summaryDocument).toEqual(sourceDocument)
  })

  it.each([false, true])('rejects a metadata-only revision before %s proposal/automatic commit', async (proposal) => {
    const note = { ...sourceNote(`metadata-revision-${proposal}`), summaryDocument: null }
    const gate = deferred<NoteProcessingResult>()
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockReturnValueOnce(gate.promise)
    const pending = proposal ? useNotesStore.getState().proposeWithLlm(note.id) : useNotesStore.getState().processWithLlm(note.id)
    await Promise.resolve()
    useNotesStore.setState({ notes: [{ ...note, summaryDocument: sourceDocument }] })
    gate.resolve({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: sourceDocument, tags: [] })
    await pending
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[note.id]).toBeUndefined()
  })

  it('retains the original good pair after summary failure while applying a successful title', async () => {
    const note = sourceNote('linked-failed')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce({ title: 'Friday', summary: '', summaryDocument: null, tags: [], failedFields: ['summary'] })
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(note.id, expect.objectContaining({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: sourceDocument }))
  })

  it.each([
    { ...sourceDocument, source: 'On Monday I have no classes.' },
    { ...sourceDocument, points: [{ text: 'Different rendering', sources: [{ start: 0, end: 28 }] }] },
  ])('refuses invalid or foreign links instead of silently committing plain text: %j', async (summaryDocument) => {
    const note = sourceNote('foreign-auto')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument, tags: [] })
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })

  it('passes the exact untrimmed source to generation and commits matching links', async () => {
    const note = { ...sourceNote('exact-source'), content: ' On Friday I have no classes.\r\n', summaryDocument: null }
    const summaryDocument: SummaryDocument = { ...sourceDocument, source: ' On Friday I have no classes.\r\n', points: [{ text: 'Friday: no classes.', sources: [{ start: 1, end: 29 }] }] }
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockImplementationOnce(async (content) => ({ title: 'Friday', summary: '• Friday: no classes.', tags: [], summaryDocument: { ...summaryDocument, source: content } }))
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedProcessNoteWithLlm.mock.calls[0][0]).toBe(' On Friday I have no classes.\r\n')
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(note.id, expect.objectContaining({ summaryDocument }))
  })

  it('clears links explicitly on retranscription and content updates', async () => {
    const note = sourceNote('linked-retranscript')
    useNotesStore.setState({ notes: [note] })
    mockedRepository.getNote.mockResolvedValueOnce(note)
    await useNotesStore.getState().applyTranscript(note.id, { content: note.content, updatedAt: note.updatedAt, audioUri: note.audioUri }, 'On Monday I have no classes.', 43000)
    expect(mockedRepository.updateNote).toHaveBeenLastCalledWith(note.id, expect.objectContaining({ summaryDocument: null }))
    await useNotesStore.getState().update(note.id, { ...toInput(note), summaryDocument: sourceDocument, content: 'On Tuesday I have no classes.' })
    expect(mockedRepository.updateNote).toHaveBeenLastCalledWith(note.id, expect.objectContaining({ summaryDocument: null }))
  })

  it('requires a verified transcript before automatic or manual AI processing', async () => {
    const note = { ...makeNote('incomplete-source'), transcriptionIncomplete: true }
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValue(generated)
    await useNotesStore.getState().processWithLlm(note.id)
    expect(await useNotesStore.getState().proposeWithLlm(note.id)).toBe(false)
    expect(enqueueLlm).not.toHaveBeenCalled()
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().processingError[note.id]).toMatch(/transkrypc/i)
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })

  it.each(['pl', 'en'] as const)('starts %s AI only after the full-file transcript is committed', async (language) => {
    const note = { ...makeNote(`completed-${language}`), language, transcriptionIncomplete: true }
    useNotesStore.setState({ notes: [note] })
    mockedRepository.getNote.mockResolvedValueOnce(note)
    mockedProcessNoteWithLlm.mockResolvedValueOnce(generated)
    const applied = await useNotesStore.getState().applyTranscript(note.id, {
      updatedAt: note.updatedAt, content: note.content, audioUri: note.audioUri,
    }, 'Verified complete source', 1_800_000, false)
    expect(applied).toBe(true)
    expect(useNotesStore.getState().notes[0].transcriptionIncomplete).toBe(false)
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedProcessNoteWithLlm).toHaveBeenCalledWith('Verified complete source', expect.any(Function), expect.any(Function), language, expect.anything())
    expect(useNotesStore.getState().notes[0].summary).toBe(generated.summary)
    expect(useNotesStore.getState().notes[0].durationMs).toBe(1_800_000)
    expect(useNotesStore.getState().notes[0].audioUri).toBe(note.audioUri)
  })

  it('continues an import inline in its held queue when the granted app is hidden', async () => {
    const note = makeNote('continued-import')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValue(generated)
    jest.mocked(enqueueLlm).mockImplementation(() => {
      throw new Error('nested queue deadlock')
    })
    jest.mocked(waitForForeground).mockImplementationOnce(() => {
      throw new Error('valid lease incorrectly waits for foreground')
    })
    await runImportProcessing(
      new AbortController(),
      true,
      async (_report, continuation) => {
        AppState.currentState = 'background'
        await useNotesStore
          .getState()
          .processWithLlm(note.id, { importContinuation: continuation })
      },
    )
    expect(waitForForeground).not.toHaveBeenCalled()
    expect(enqueueLlm).not.toHaveBeenCalled()
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({ title: generated.title }),
    )
  })

  it('reports failed continued AI to its parent instead of finishing the import as successful', async () => {
    const note = makeNote('continued-import-error')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockRejectedValue(new Error('generation stopped'))
    await expect(
      runImportProcessing(
        new AbortController(),
        true,
        async (_report, continuation) => {
          await useNotesStore
            .getState()
            .processWithLlm(note.id, { importContinuation: continuation })
        },
      ),
    ).rejects.toThrow('generation stopped')
    expect(useNotesStore.getState().resumableProcessing[note.id]).toBe('note')
  })

  it('uses the saved English note language for initial generation and proposals', async () => {
    const note: Note = { ...makeNote('english-note'), language: 'en' }
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValue(generated)
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedProcessNoteWithLlm.mock.calls[0][3]).toBe('en')
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({ language: 'en' }),
    )
    await useNotesStore.getState().proposeWithLlm(note.id)
    expect(mockedProcessNoteWithLlm.mock.calls[1][3]).toBe('en')
  })

  it('discards queued generation when only the source note language changes', async () => {
    const note: Note = { ...makeNote('language-race'), language: 'en' }
    const generation = deferred<NoteProcessingResult>()
    mockedProcessNoteWithLlm.mockReturnValue(generation.promise)
    useNotesStore.setState({ notes: [note] })
    const processing = useNotesStore.getState().processWithLlm(note.id)
    useNotesStore.setState({ notes: [{ ...note, language: 'pl' }] })
    generation.resolve(generated)
    await processing
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
  })

  it('defers automatic processing in the background and rechecks whether the note still exists', async () => {
    const note = makeNote('background-save')
    useNotesStore.setState({ notes: [note] })
    AppState.currentState = 'background'
    const foreground = deferred<void>()
    jest.mocked(waitForForeground).mockReturnValueOnce(foreground.promise)
    const processing = useNotesStore.getState().processWithLlm(note.id)
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    useNotesStore.setState({ notes: [] })
    AppState.currentState = 'active'
    foreground.resolve()
    await processing
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
  })

  it('preserves the note and audio when generated text fails validation', async () => {
    const note = makeNote('invalid-summary')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockRejectedValueOnce(
      new Error('Podsumowanie zbyt mocno powtarzało treść.'),
    )
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().notes).toEqual([note])
    expect(useNotesStore.getState().processing[note.id]).toBeUndefined()
    expect(useNotesStore.getState().processingError[note.id]).toContain(
      'powtarzało treść',
    )
  })

  it('records a failed operation when saving a valid generation fails', async () => {
    const note = makeNote('disk-full')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce(generated)
    mockedRepository.updateNote.mockRejectedValueOnce(new Error('disk full'))
    await useNotesStore.getState().processWithLlm(note.id)
    expect(recordOperationTiming).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'note', succeeded: false }),
    )
    expect(useNotesStore.getState().notes[0]).toEqual(note)
  })

  it('keeps existing fields and records partial generation as unsuccessful', async () => {
    const note = makeNote('partial-output')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce({
      ...generated,
      summary: '',
      failedFields: ['summary'],
      warnings: ['Summary unavailable'],
    })
    await useNotesStore.getState().processWithLlm(note.id)
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({ summary: note.summary }),
    )
    expect(recordOperationTiming).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    )
  })

  it('only recovers interrupted jobs on the initial data load', async () => {
    mockedRepository.listNotes.mockResolvedValue([])
    useNotesStore.setState({ loaded: false })
    await useNotesStore.getState().load()
    await useNotesStore.getState().load()
    expect(recoverProcessingJobs).toHaveBeenCalledTimes(1)
  })

  it('restores source-matched generated proposals after a process restart', async () => {
    const note = makeNote('saved-proposal')
    mockedRepository.listNotes.mockResolvedValueOnce([note])
    jest
      .mocked(recoverProcessingJobs)
      .mockResolvedValueOnce([
        {
          id: 'job',
          noteId: note.id,
          kind: 'proposal',
          source: jobSourceIdentity(toInput(note)),
          model: MODEL_CONFIG.url,
          pipeline: PIPELINE_VERSION,
          status: 'pending',
          attemptId: 'old',
          checkpoints: '{}',
          result: JSON.stringify(generated),
          reason: null,
          updatedAt: 40,
        },
      ])
    useNotesStore.setState({ loaded: false, proposals: {} })
    await useNotesStore.getState().load()
    expect(useNotesStore.getState().proposals[note.id]?.generated).toEqual(
      generated,
    )
    expect(
      useNotesStore.getState().resumableProcessing[note.id],
    ).toBeUndefined()
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
  })

  it('does not restore a persisted proposal after its source was edited', async () => {
    const original = makeNote('edited-saved-proposal')
    mockedRepository.listNotes.mockResolvedValueOnce([
      { ...original, content: 'Edited source.' },
    ])
    jest
      .mocked(recoverProcessingJobs)
      .mockResolvedValueOnce([
        {
          id: 'job',
          noteId: original.id,
          kind: 'proposal',
          source: jobSourceIdentity(toInput(original)),
          model: MODEL_CONFIG.url,
          pipeline: PIPELINE_VERSION,
          status: 'pending',
          attemptId: 'old',
          checkpoints: '{}',
          result: JSON.stringify(generated),
          reason: null,
          updatedAt: 40,
        },
      ])
    useNotesStore.setState({ loaded: false, proposals: {} })
    await useNotesStore.getState().load()
    expect(useNotesStore.getState().proposals[original.id]).toBeUndefined()
  })

  it('keeps the durable suggestion if accepting it fails before the note write', async () => {
    const note = makeNote('proposal-write-failure')
    useNotesStore.setState({ notes: [note] })
    mockedProcessNoteWithLlm.mockResolvedValueOnce(generated)
    await useNotesStore.getState().proposeWithLlm(note.id)
    mockedRepository.updateNote.mockRejectedValueOnce(new Error('disk full'))
    await expect(
      useNotesStore
        .getState()
        .applyProposal(note.id, { title: true, summary: true, tags: true }),
    ).rejects.toThrow('disk full')
    expect(invalidateProcessingJobs).not.toHaveBeenCalled()
  })

  it('cancels a queued proposal before any generation and leaves it resumable', async () => {
    const note = makeNote('cancel-queued')
    useNotesStore.setState({ notes: [note] })
    const gate = deferred<void>()
    jest.mocked(enqueueLlm).mockImplementationOnce(async (job) => {
      await gate.promise
      return job()
    })
    const pending = useNotesStore.getState().proposeWithLlm(note.id)
    await useNotesStore.getState().pauseProcessing(note.id)
    gate.resolve()
    await expect(pending).resolves.toBe(false)
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    expect(useNotesStore.getState().resumableProcessing[note.id]).toBe(
      'proposal',
    )
    expect(useNotesStore.getState().processing[note.id]).toBeUndefined()
  })

  it('completes a partial transcript without replacing manually edited fields', async () => {
    const note = { ...makeNote('backfill'), transcriptionIncomplete: true }
    useNotesStore.setState({ notes: [note] })
    mockedRepository.getNote.mockResolvedValueOnce(note)
    expect(
      await useNotesStore
        .getState()
        .applyTranscript(
          note.id,
          {
            updatedAt: note.updatedAt,
            content: note.content,
            audioUri: note.audioUri,
          },
          'Full transcript.',
          43000,
        ),
    ).toBe(true)
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(
      note.id,
      expect.objectContaining({
        title: note.title,
        summary: note.summary,
        tags: note.tags,
        content: 'Full transcript.',
        transcriptionIncomplete: false,
      }),
    )
  })

  it('discards completed transcription if the note changed during import', async () => {
    const original = makeNote('backfill-edit')
    useNotesStore.setState({
      notes: [{ ...original, content: 'Manual correction', updatedAt: 40 }],
    })
    expect(
      await useNotesStore
        .getState()
        .applyTranscript(
          original.id,
          {
            updatedAt: original.updatedAt,
            content: original.content,
            audioUri: original.audioUri,
          },
          'Old transcript.',
          43000,
        ),
    ).toBe(false)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
  })

  it('does not apply initial generation after a user edit changes the source note', async () => {
    const note = makeNote()
    const generation = deferred<NoteProcessingResult>()
    mockedProcessNoteWithLlm.mockReturnValue(generation.promise)
    useNotesStore.setState({ notes: [note] })

    const processing = useNotesStore.getState().processWithLlm(note.id)
    const edited = {
      ...note,
      title: 'Mój tytuł',
      content: `${note.content} Nowy termin.`,
    }
    await useNotesStore.getState().update(note.id, toInput(edited))
    generation.resolve(generated)
    await processing

    expect(mockedRepository.updateNote).toHaveBeenCalledTimes(1)
    expect(mockedRepository.updateNote).toHaveBeenCalledWith(
      note.id,
      toInput(edited),
    )
    expect(useNotesStore.getState().notes[0]).toMatchObject({
      title: 'Mój tytuł',
      content: `${note.content} Nowy termin.`,
    })
  })

  it('shows that processing is queued before the shared LLM job starts', async () => {
    const note = makeNote()
    const generation = deferred<NoteProcessingResult>()
    mockedProcessNoteWithLlm.mockReturnValue(generation.promise)
    useNotesStore.setState({ notes: [note] })

    const processing = useNotesStore.getState().processWithLlm(note.id)

    expect(useNotesStore.getState().processing[note.id]).toEqual({
      phase: 'queued',
    })

    generation.resolve(generated)
    await processing
  })

  it('keeps reprocessing output as a proposal until the user applies selected fields', async () => {
    const note = makeNote()
    mockedProcessNoteWithLlm.mockResolvedValue(generated)
    useNotesStore.setState({ notes: [note] })

    await expect(
      useNotesStore.getState().proposeWithLlm(note.id),
    ).resolves.toBe(true)

    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().notes[0]).toEqual(note)
    expect(useNotesStore.getState().proposals[note.id]?.generated).toEqual(
      generated,
    )

    await useNotesStore.getState().applyProposal(note.id, {
      title: true,
      summary: false,
      tags: false,
    })

    expect(mockedRepository.updateNote).toHaveBeenCalledWith(note.id, {
      ...toInput(note),
      title: generated.title,
    })
  })

  it('keeps the proposal visible until its matching pending result is durably discarded', async () => {
    const note = makeNote('discard-wait')
    const proposal = createNoteProposal(note, generated)
    const write = deferred<void>()
    let pendingResult = true
    jest.mocked(discardPendingProcessingResult).mockImplementationOnce(async (id, kind, source) => {
      expect([id, kind, source]).toEqual([note.id, 'proposal', jobSourceIdentity(toInput(note))])
      await write.promise
      pendingResult = false
    })
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await Promise.resolve()
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
    expect(pendingResult).toBe(true)
    write.resolve()
    await expect(discarding).resolves.toBe(true)
    expect(pendingResult).toBe(false)
    expect(useNotesStore.getState().proposals[note.id]).toBeUndefined()
    expect(useNotesStore.getState().notes).toEqual([note])
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(mockedRepository.deleteNote).not.toHaveBeenCalled()
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
  })

  it('retains a proposal and exposes the durable discard error when persistence fails', async () => {
    const note = makeNote('discard-error')
    const proposal = createNoteProposal(note, generated)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    jest.mocked(discardPendingProcessingResult).mockRejectedValueOnce(new Error('disk full'))
    expect(await useNotesStore.getState().clearProposal(note.id)).toBe(false)
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
    expect(useNotesStore.getState().processingError[note.id]).toBe('disk full')
    expect(useNotesStore.getState().notes).toEqual([note])
  })

  it('does not start a new generation while a durable discard is awaiting persistence', async () => {
    const note = makeNote('discard-generation')
    const proposal = createNoteProposal(note, generated)
    const write = deferred<void>()
    jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(write.promise)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await Promise.resolve()
    await expect(useNotesStore.getState().proposeWithLlm(note.id)).resolves.toBe(false)
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    write.resolve()
    await expect(discarding).resolves.toBe(true)
  })

  it('does not apply selected fields while a durable discard is awaiting persistence', async () => {
    const note = makeNote('discard-apply')
    const proposal = createNoteProposal(note, generated)
    const write = deferred<void>()
    jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(write.promise)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await Promise.resolve()
    await expect(useNotesStore.getState().applyProposal(note.id, { title: true, summary: true, tags: true }))
      .resolves.toBe(false)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    write.resolve()
    await expect(discarding).resolves.toBe(true)
  })

  it('does not erase a replacement proposal after the old source discard completes', async () => {
    const note = makeNote('discard-replacement')
    const proposal = createNoteProposal(note, generated)
    const replacement = createNoteProposal(note, { ...generated, title: 'Another proposal' })
    const write = deferred<void>()
    jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(write.promise)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await Promise.resolve()
    useNotesStore.setState({ proposals: { [note.id]: replacement } })
    write.resolve()
    await expect(discarding).resolves.toBe(false)
    expect(useNotesStore.getState().proposals[note.id]).toBe(replacement)
  })

  it('rejects a discard whose source revision changes before persistence completes', async () => {
    const note = makeNote('discard-source-change')
    const proposal = createNoteProposal(note, generated)
    const write = deferred<void>()
    jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(write.promise)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await Promise.resolve()
    const editing = useNotesStore.getState().update(note.id, { ...toInput(note), content: 'Edited source' })
    write.resolve()
    await expect(discarding).resolves.toBe(false)
    await editing
    expect(useNotesStore.getState().notes[0].content).toBe('Edited source')
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
  })

  it('refuses programmatic selection of a failed proposal field before any note write', async () => {
    const note = makeNote('failed-field-apply')
    const proposal = createNoteProposal(note, { ...generated, failedFields: ['summary'], warnings: ['Summary unavailable'] })
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    await expect(useNotesStore.getState().applyProposal(note.id, { title: true, summary: true, tags: true }))
      .resolves.toBe(false)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
  })

  it.each([true, false])('keeps an equivalent proposal without note writes or job invalidation (selected=%s)', async (selected) => {
    const note = { ...makeNote('equivalent-proposal'), tags: ['Nauka', 'Praca'] }
    const proposal = createNoteProposal(note, {
      title: ` ${note.title} `,
      summary: note.summary ?? '',
      tags: ['PRACA', ' nauka ', 'Nauka'],
    })
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    await expect(useNotesStore.getState().applyProposal(note.id, {
      title: selected, summary: selected, tags: selected,
    })).resolves.toBe(false)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(invalidateProcessingJobs).not.toHaveBeenCalled()
    expect(discardPendingProcessingResult).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
    expect(useNotesStore.getState().notes[0]).toBe(note)
  })

  it('does not write or invalidate jobs when the only actual change is unselected', async () => {
    const note = makeNote('unselected-change')
    const proposal = createNoteProposal(note, { title: 'Changed title', summary: note.summary ?? '', tags: note.tags })
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    await expect(useNotesStore.getState().applyProposal(note.id, { title: false, summary: true, tags: true }))
      .resolves.toBe(false)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(invalidateProcessingJobs).not.toHaveBeenCalled()
    expect(discardPendingProcessingResult).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
  })

  it('does not begin automatic processing or a second discard during a pending discard', async () => {
    const note = makeNote('discard-automatic-race')
    const proposal = createNoteProposal(note, generated)
    const write = deferred<void>()
    jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(write.promise)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    const discarding = useNotesStore.getState().clearProposal(note.id)
    await useNotesStore.getState().processWithLlm(note.id)
    await expect(useNotesStore.getState().clearProposal(note.id)).resolves.toBe(false)
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    expect(discardPendingProcessingResult).toHaveBeenCalledTimes(1)
    write.resolve()
    await expect(discarding).resolves.toBe(true)
  })

  it('rejects an already stale proposal without discarding a different source result', async () => {
    const original = makeNote('discard-stale-source')
    const proposal = createNoteProposal(original, generated)
    const current = { ...original, content: 'A different source.', updatedAt: 40 }
    useNotesStore.setState({ notes: [current], proposals: { [current.id]: proposal } })
    await expect(useNotesStore.getState().clearProposal(current.id)).resolves.toBe(false)
    expect(discardPendingProcessingResult).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[current.id]).toBe(proposal)
    expect(useNotesStore.getState().notes).toEqual([current])
  })

  it('does not discard a replacement when an older chooser submits its original proposal', async () => {
    const note = makeNote('discard-stale-chooser')
    const original = createNoteProposal(note, generated)
    const replacement = createNoteProposal(note, { ...generated, title: 'Replacement' })
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: replacement } })
    await expect(useNotesStore.getState().clearProposal(note.id, original)).resolves.toBe(false)
    expect(discardPendingProcessingResult).not.toHaveBeenCalled()
    expect(useNotesStore.getState().proposals[note.id]).toBe(replacement)
  })

  it('permits retrying a failed durable discard without regenerating or changing the note', async () => {
    const note = makeNote('discard-retry')
    const proposal = createNoteProposal(note, generated)
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    jest.mocked(discardPendingProcessingResult).mockRejectedValueOnce(new Error('disk full'))
    await expect(useNotesStore.getState().clearProposal(note.id)).resolves.toBe(false)
    expect(useNotesStore.getState().proposals[note.id]).toBe(proposal)
    await expect(useNotesStore.getState().clearProposal(note.id)).resolves.toBe(true)
    expect(discardPendingProcessingResult).toHaveBeenCalledTimes(2)
    expect(useNotesStore.getState().processingError[note.id]).toBeUndefined()
    expect(useNotesStore.getState().proposals[note.id]).toBeUndefined()
    expect(useNotesStore.getState().notes).toEqual([note])
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
  })

  it('allows a separate explicit fresh generation after successful discard', async () => {
    const note = makeNote('discard-then-generate')
    const proposal = createNoteProposal(note, { ...generated, failedFields: ['summary'] })
    const fresh = { ...generated, title: 'A fresh proposal', warnings: [] }
    useNotesStore.setState({ notes: [note], proposals: { [note.id]: proposal } })
    await expect(useNotesStore.getState().clearProposal(note.id)).resolves.toBe(true)
    expect(mockedProcessNoteWithLlm).not.toHaveBeenCalled()
    mockedProcessNoteWithLlm.mockResolvedValueOnce(fresh)
    await expect(useNotesStore.getState().proposeWithLlm(note.id)).resolves.toBe(true)
    expect(mockedProcessNoteWithLlm).toHaveBeenCalledTimes(1)
    expect(useNotesStore.getState().proposals[note.id]?.generated).toEqual(fresh)
    expect(useNotesStore.getState().notes).toEqual([note])
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
  })

  it('does not write generated fields when a note is deleted during processing', async () => {
    const note = makeNote()
    const generation = deferred<NoteProcessingResult>()
    mockedProcessNoteWithLlm.mockReturnValue(generation.promise)
    useNotesStore.setState({ notes: [note] })

    const processing = useNotesStore.getState().processWithLlm(note.id)
    await useNotesStore.getState().remove(note.id)
    generation.resolve(generated)
    await processing

    expect(mockedRepository.deleteNote).toHaveBeenCalledWith(note.id)
    expect(mockedRepository.updateNote).not.toHaveBeenCalled()
    expect(useNotesStore.getState().notes).toEqual([])
  })
})
