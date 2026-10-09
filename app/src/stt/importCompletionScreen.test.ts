import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ImportAudioScreen from '../app/import'
import type { RecordingResult } from './useSpeechRecorder'
import type { Note } from '../domain/note'
import { deleteRecordingFile } from '../audio/audioFiles'
import { clearImportCheckpoint } from './importTranscription'

const mockNote: Note = {
  id: 'capture-saved', title: 'Nagranie', content: 'Tekst częściowy', summary: null,
  tags: [], audioUri: 'file:///capture/000000.wav', durationMs: 26190,
  language: 'pl', transcriptionIncomplete: true, createdAt: 1, updatedAt: 2,
}
const mockRouter = { replace: jest.fn(), back: jest.fn() }
const mockOrder: string[] = []
const mockNotes = {
  notes: [mockNote], add: jest.fn(), remove: jest.fn(),
  applyTranscript: jest.fn(async () => { mockOrder.push('source-committed'); return true }),
  processWithLlm: jest.fn(async () => { mockOrder.push('ai') }),
}
const mockSettings = { noteLanguage: 'en', loaded: true, setNoteLanguage: jest.fn() }
const mockStart = jest.fn(async () => undefined)
let mockTitlePending: string | undefined
let mockNoteId: string | undefined = 'capture-saved'
let mockComplete: (result: RecordingResult) => Promise<void>
jest.mock('./useSpeechRecorder', () => ({ useSpeechRecorder: (complete: typeof mockComplete) => {
  mockComplete = complete
  return { status: 'idle', transcript: '', finalTranscript: '', durationMs: 0,
    volumeLevel: 0, error: null, permissionDenied: false, info: null, start: mockStart, stop: jest.fn() }
} }))
jest.mock('../state/notesStore', () => ({ useNotesStore: Object.assign(
  (select: (state: typeof mockNotes) => unknown) => select(mockNotes), { getState: () => mockNotes },
) }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: Object.assign(
  (select: (state: typeof mockSettings) => unknown) => select(mockSettings),
  { getState: () => ({ ...mockSettings, languagePreference: 'pl' }) },
) }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter,
  useNavigation: () => ({ dispatch: jest.fn() }), useLocalSearchParams: () => ({ noteId: mockNoteId, titlePending: mockTitlePending }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn(), useIsFocused: () => true }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../audio/audioFiles', () => ({ deleteRecordingFile: jest.fn(), saveRecordingFile: jest.fn(), deletePickerCacheFile: jest.fn() }))
jest.mock('../audio/importAudio', () => ({ inspectImportAudio: jest.fn() }))
jest.mock('./importTranscription', () => ({ clearImportCheckpoint: jest.fn(async () => undefined) }))
jest.mock('../processing/importProcessing', () => ({ markImportSourceCommitted: jest.fn() }))
jest.mock('../ui/theme', () => {
  const theme = jest.requireActual('../ui/theme') as typeof import('../ui/theme')
  return { ...theme, useTheme: () => ({ colors: theme.colors }) }
})
jest.mock('../ui/Motion', () => ({ useReducedMotion: () => true, ProcessingIndicator: () => null }))
jest.mock('../ui/BottomSheet', () => ({ BottomSheet: () => null }))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))
jest.mock('../ui/LanguagePicker', () => ({ LanguagePicker: () => null }))
jest.mock('./LiveTranscript', () => ({ LiveTranscript: () => null }))
jest.mock('./PermissionSettingsButton', () => ({ PermissionSettingsButton: () => null }))

let tree: ReactTestRenderer
const result = (needsTranscription = false): RecordingResult => ({
  language: 'pl', transcript: 'Pełny tekst źródłowy', audioUri: mockNote.audioUri,
  durationMs: 26189.6875, needsTranscription,
})
beforeEach(async () => {
  jest.clearAllMocks()
  mockOrder.length = 0
  mockTitlePending = undefined
  mockNoteId = 'capture-saved'
  mockNotes.applyTranscript.mockImplementation(async () => { mockOrder.push('source-committed'); return true })
  await act(async () => { tree = create(createElement(ImportAudioScreen)) })
})
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('automatically transcribes the existing saved audio in its own language exactly once', () => {
  expect(mockStart).toHaveBeenCalledTimes(1)
  expect(mockStart).toHaveBeenCalledWith({ uri: mockNote.audioUri, durationMs: 26190 }, 'pl')
  expect(mockNotes.add).not.toHaveBeenCalled()
})

test('starts AI only after committing a verified transcript into the same note', async () => {
  await act(async () => { await mockComplete(result()) })
  expect(mockNotes.applyTranscript).toHaveBeenCalledWith('capture-saved', {
    updatedAt: 2, content: 'Tekst częściowy', audioUri: mockNote.audioUri,
  }, 'Pełny tekst źródłowy', 26189.6875, false)
  expect(mockOrder).toEqual(['source-committed', 'ai'])
  expect(mockRouter.replace).toHaveBeenCalledWith('/note/capture-saved')
  expect(mockNotes.add).not.toHaveBeenCalled()
  expect(deleteRecordingFile).not.toHaveBeenCalled()
})

test('forwards the explicit new-capture title marker through full-file completion', async () => {
  mockTitlePending = '1'
  await act(async () => { tree.update(createElement(ImportAudioScreen)) })
  await act(async () => { await mockComplete(result()) })
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: mockNote.id, titlePending: '1' } })
  expect(mockOrder).toEqual(['source-committed', 'ai'])
})

test('new imported notes mark their first title generation without changing existing-note retries', async () => {
  await act(async () => { tree.unmount() })
  mockNoteId = undefined
  mockNotes.add.mockResolvedValueOnce(mockNote)
  await act(async () => { tree = create(createElement(ImportAudioScreen)) })
  await act(async () => { await mockComplete(result()) })
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: mockNote.id, titlePending: '1' } })
  expect(mockNotes.applyTranscript).not.toHaveBeenCalled()
  expect(mockNotes.processWithLlm).toHaveBeenCalledWith(mockNote.id)
})

test('keeps partial source and audio when transcription is stopped without running AI', async () => {
  await act(async () => { await mockComplete(result(true)) })
  expect(mockNotes.applyTranscript).toHaveBeenCalledWith('capture-saved', expect.anything(),
    'Pełny tekst źródłowy', 26189.6875, true)
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
  expect(clearImportCheckpoint).not.toHaveBeenCalled()
  expect(deleteRecordingFile).not.toHaveBeenCalled()
  expect(mockNotes.remove).not.toHaveBeenCalled()
})

test('does not overwrite an edited note or start AI after its source revision changed', async () => {
  mockNotes.applyTranscript.mockResolvedValueOnce(false)
  await act(async () => { await mockComplete(result()) })
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
  expect(mockRouter.replace).not.toHaveBeenCalled()
  expect(clearImportCheckpoint).not.toHaveBeenCalled()
  expect(deleteRecordingFile).not.toHaveBeenCalled()
})
