import type { Note, NoteInput } from '../domain/note'
import type { NoteProcessingResult } from '../ai/noteProcessing'
import * as repository from '../data/notesRepository'
import { processNoteWithLlm } from '../ai/noteProcessing'
import { useNotesStore } from './notesStore'

jest.mock('../data/notesRepository', () => ({
  listNotes: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}))

jest.mock('../ai/noteProcessing', () => ({ processNoteWithLlm: jest.fn() }))
jest.mock('../ai/generationMetrics', () => ({
  recordOperationTiming: jest.fn(),
}))
jest.mock('../ai/llmQueue', () => ({
  enqueueLlm: (job: () => Promise<void>) => job(),
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
})

const toInput = (note: Note): NoteInput => ({
  title: note.title,
  content: note.content,
  summary: note.summary,
  tags: note.tags,
  audioUri: note.audioUri,
  durationMs: note.durationMs,
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

describe('notesStore background processing safeguards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedProcessNoteWithLlm.mockReset()
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
