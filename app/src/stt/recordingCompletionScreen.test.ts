import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import RecordNoteScreen from '../app/record'
import type { RecordingResult } from './useSpeechRecorder'
import { acknowledgeCapture } from '../audio/captureRecovery'

const mockOrder: string[] = []
const mockRouter = { replace: jest.fn(() => { mockOrder.push('navigate') }) }
const mockNotes = {
  add: jest.fn(),
  addRecovered: jest.fn(async () => { mockOrder.push('saved'); return { id: 'capture-saved' } }),
  processWithLlm: jest.fn(async () => { mockOrder.push('ai') }),
}
const mockDraft = { draft: null, load: jest.fn(async () => undefined),
  save: jest.fn(), clear: jest.fn(async () => { mockOrder.push('draft-cleared') }) }
const mockSettings = { noteLanguage: 'pl', loaded: true, setNoteLanguage: jest.fn() }
let mockComplete: (result: RecordingResult) => Promise<void>
jest.mock('./useSpeechRecorder', () => ({
  useSpeechRecorder: (complete: typeof mockComplete) => {
    mockComplete = complete
    return { status: 'idle', transcript: '', finalTranscript: '', durationMs: 0,
      volumeLevel: 0, error: null, permissionDenied: false, info: null,
      start: jest.fn(), stop: jest.fn(), backgroundRecording: true }
  },
}))
jest.mock('../state/notesStore', () => ({ useNotesStore: (select: (state: typeof mockNotes) => unknown) => select(mockNotes) }))
jest.mock('../state/draftStore', () => ({ useDraftStore: (select: (state: typeof mockDraft) => unknown) => select(mockDraft) }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: Object.assign(
  (select: (state: typeof mockSettings) => unknown) => select(mockSettings),
  { getState: () => ({ ...mockSettings, languagePreference: 'pl' }) },
) }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter,
  useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../audio/captureRecovery', () => ({ acknowledgeCapture: jest.fn(async () => { mockOrder.push('acknowledged') }) }))
jest.mock('../ui/theme', () => {
  const theme = jest.requireActual('../ui/theme') as typeof import('../ui/theme')
  return { ...theme, useTheme: () => ({ colors: theme.colors }) }
})
jest.mock('../ui/Motion', () => ({ useReducedMotion: () => true }))
jest.mock('../ui/BottomSheet', () => ({ BottomSheet: () => null }))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))
jest.mock('../ui/LanguagePicker', () => ({ LanguagePicker: () => null }))
jest.mock('./LiveTranscript', () => ({ LiveTranscript: () => null }))
jest.mock('./PermissionSettingsButton', () => ({ PermissionSettingsButton: () => null }))

let tree: ReactTestRenderer
const result = (overrides: Partial<RecordingResult> & { autoTranscribeAudio?: boolean } = {}) => ({
  language: 'pl' as const, sessionId: 'capture-saved', transcript: 'Testy aplikacji',
  audioUri: 'file:///capture/000000.wav', durationMs: 26190, needsTranscription: true,
  autoTranscribeAudio: true, ...overrides,
})
beforeEach(async () => {
  jest.clearAllMocks()
  mockOrder.length = 0
  mockNotes.addRecovered.mockImplementation(async () => { mockOrder.push('saved'); return { id: 'capture-saved' } })
  jest.mocked(acknowledgeCapture).mockImplementation(async () => { mockOrder.push('acknowledged') })
  await act(async () => { tree = create(createElement(RecordNoteScreen)) })
})
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('commits the original note and audio before automatically completing its transcript', async () => {
  await act(async () => { await mockComplete(result()) })
  expect(mockNotes.addRecovered).toHaveBeenCalledWith(expect.objectContaining({
    content: 'Testy aplikacji', transcriptionIncomplete: true,
    audioUri: 'file:///capture/000000.wav',
  }), 'capture-saved')
  expect(mockOrder).toEqual(['saved', 'acknowledged', 'draft-cleared', 'navigate'])
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/import', params: { noteId: 'capture-saved' } })
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
  expect(mockNotes.add).not.toHaveBeenCalled()
})

test('completes clean audio with no recognized words through the same saved note', async () => {
  await act(async () => { await mockComplete(result({ transcript: '' })) })
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/import', params: { noteId: 'capture-saved' } })
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
})

test('keeps unverified interrupted recordings on the note for manual recovery', async () => {
  await act(async () => { await mockComplete(result({ autoTranscribeAudio: false, notice: 'Audio przerwane' })) })
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'capture-saved', recordingNotice: 'Audio przerwane' } })
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
})

test('uses AI directly for an already certified recording', async () => {
  await act(async () => { await mockComplete(result({ needsTranscription: false })) })
  expect(mockNotes.processWithLlm).toHaveBeenCalledWith('capture-saved')
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/note/[id]', params: { id: 'capture-saved' } })
})

test.each([true, false])('marks a newly started capture title as pending through its first continuation (incomplete=%s)', async (incomplete) => {
  const start = tree.root.findAll((node) => node.props.accessibilityLabel === 'Nagraj' && typeof node.props.onPress === 'function')[0]
  if (!start) throw new Error('Start recording control is missing')
  await act(async () => { start.props.onPress() })
  await act(async () => { await mockComplete(result({ needsTranscription: incomplete })) })
  expect(mockRouter.replace).toHaveBeenCalledWith({
    pathname: incomplete ? '/import' : '/note/[id]',
    params: incomplete ? { noteId: 'capture-saved', titlePending: '1' } : { id: 'capture-saved', titlePending: '1' },
  })
})

test.each(['save', 'acknowledge'] as const)('does not advance past a failed %s', async (stage) => {
  if (stage === 'save') mockNotes.addRecovered.mockRejectedValueOnce(new Error('Disk full'))
  else jest.mocked(acknowledgeCapture).mockRejectedValueOnce(new Error('Journal not saved'))
  await act(async () => { await mockComplete(result()) })
  expect(mockRouter.replace).not.toHaveBeenCalled()
  expect(mockNotes.processWithLlm).not.toHaveBeenCalled()
  expect(mockDraft.clear).not.toHaveBeenCalled()
})
