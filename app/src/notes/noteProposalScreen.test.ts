import { createElement, Profiler } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { AppState, Text } from 'react-native'
import { Stack } from 'expo-router'
import type { Note } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'
import type { NoteProcessingResult, ProcessingProgress } from '../ai/noteProcessing'
import { createNoteProposal, type NoteProposal } from '../notes/noteProposals'
import { Button } from '../ui/Button'
import { ProcessingLive } from './ProcessingLive'
import { SummaryWithSources } from './SummaryWithSources'
import { BottomSheet } from '../ui/BottomSheet'
import NoteDetailScreen from '../app/note/[id]'

const mockNote: Note = {
  id: 'proposal-note', title: 'Prezentacja pracy', content: 'Dosłowne źródło notatki.',
  summary: 'Wyniki testów.', tags: ['Nauka'], audioUri: null, durationMs: null,
  createdAt: 1, updatedAt: 1, language: 'pl',
}
const mockNotesState = {
  notes: [mockNote], loaded: true,
  processing: {} as Record<string, ProcessingProgress>, resumableProcessing: {}, processingError: {},
  proposals: {} as Record<string, NoteProposal>,
  proposeWithLlm: jest.fn(async () => true), applyProposal: jest.fn(async () => true),
  clearProposal: jest.fn(async () => true), remove: jest.fn(),
}
let mockFocused = true
let mockReducedMotion = true
let mockRouteId = 'proposal-note'
let mockCommitObserver: (() => void) | undefined
const mockRouter = { canGoBack: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn(), setParams: jest.fn() }
jest.mock('../state/notesStore', () => ({
  useNotesStore: Object.assign((select: (state: typeof mockNotesState) => unknown) => select(mockNotesState), {
    getState: () => mockNotesState,
  }),
}))
jest.mock('../state/tasksStore', () => ({ useTasksStore: { getState: () => ({ tasks: [] }) } }))
jest.mock('../state/modelStore', () => ({ useModelStore: () => true }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: () => 'light' }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl' }) }))
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: mockRouteId }),
  useRouter: () => mockRouter,
}))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../ui/theme', () => {
  const theme = jest.requireActual('../ui/theme') as typeof import('../ui/theme')
  return { ...theme, useTheme: () => ({ colors: theme.colors, isDark: false }) }
})
jest.mock('../ui/Icon', () => ({ Icon: () => null, IconButton: () => null }))
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }))
jest.mock('../ui/Motion', () => ({ useReducedMotion: () => mockReducedMotion }))
jest.mock('../audio/AudioNotePlayer', () => ({ AudioNotePlayer: () => null }))
jest.mock('../tasks/NoteTasks', () => ({ NoteTasks: () => null }))
jest.mock('../tags/NoteTags', () => {
  const React = jest.requireActual('react') as typeof import('react')
  const Native = jest.requireActual('react-native') as typeof import('react-native')
  return { NoteTags: ({ tags }: { tags: string[] }) => React.createElement(Native.Text, { testID: 'category-values' }, tags.join(', ')) }
})
jest.mock('../ai/noteProcessing', () => ({ getModelMissingMessage: () => '' }))
jest.mock('../processing/nativeProcessing', () => ({ supportsBackgroundProcessing: () => false }))

let tree: ReactTestRenderer
const setProposal = (generated: Partial<NoteProcessingResult> = {}) => {
  mockNotesState.proposals = { [mockNote.id]: createNoteProposal(mockNotesState.notes[0], {
    title: mockNote.title, summary: mockNote.summary ?? '', tags: [...mockNote.tags], ...generated,
  }) }
}
const screenElement = () => createElement(Profiler, { id: 'note', onRender: () => mockCommitObserver?.() }, createElement(NoteDetailScreen))
const update = async () => { await act(async () => { tree.update(screenElement()) }) }
const button = (label: string): ReactTestInstance => {
  const result = tree.root.findAllByType(Button).find((item) => item.props.label === label)
  expect(result).toBeDefined()
  return result!
}
const chooser = (): ReactTestInstance => tree.root.findByProps({ accessibilityViewIsModal: true })
const textNodes = (value: string) => chooser().findAllByType(Text).filter((item) => item.props.children === value)
const radios = () => chooser().findAll((item) => item.props.accessibilityRole === 'radio' &&
  typeof item.props.onPress === 'function')
const open = async () => {
  const action = tree.root.findAll((item) => item.props.accessibilityRole === 'button' &&
    typeof item.props.onPress === 'function').find((item) =>
      item.props.accessibilityLabel === 'Opracuj na nowo')
  expect(action).toBeDefined()
  await act(async () => { action!.props.onPress() })
}

beforeEach(async () => {
  jest.clearAllMocks()
  AppState.currentState = 'active'
  mockFocused = true
  mockReducedMotion = true
  mockRouteId = mockNote.id
  mockCommitObserver = undefined
  mockNotesState.notes = [{ ...mockNote, tags: [...mockNote.tags] }]
  mockNotesState.processing = {}
  mockNotesState.applyProposal.mockReset().mockResolvedValue(true)
  mockNotesState.clearProposal.mockReset().mockResolvedValue(true)
  setProposal()
  await act(async () => { tree = create(createElement(NoteDetailScreen)) })
})
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('completes an incomplete recording before offering any manual AI replacement', async () => {
  mockNotesState.notes = [{ ...mockNote, audioUri: 'file:///recording.wav', transcriptionIncomplete: true }]
  mockNotesState.proposals = {}
  await update()
  const action = tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')
    .find((node) => node.findAllByType(Text).some((text) => text.props.children === 'Uzupełnij i przetwórz'))
  expect(action).toBeDefined()
  await act(async () => { action!.props.onPress() })
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/import', params: { noteId: mockNote.id } })
  expect(mockNotesState.proposeWithLlm).not.toHaveBeenCalled()
  expect(tree.root.findAllByProps({ accessibilityViewIsModal: true })).toHaveLength(0)
})

test('shows one current value per identical field and an explicit no-change state without actionable radios', async () => {
  await open()
  expect(textNodes('Bez zmian')).toHaveLength(3)
  expect(textNodes('Nauka')).toHaveLength(1)
  expect(textNodes('Prezentacja pracy')).toHaveLength(1)
  expect(textNodes('Wyniki testów.')).toHaveLength(1)
  expect(textNodes('Brak zmian. Propozycje są takie same jak obecne wartości.')).toHaveLength(1)
  expect(radios()).toHaveLength(0)
  const apply = button('Zastosuj 0 zmian')
  expect(apply.props.disabled).toBe(true)
  await act(async () => { await apply.props.onPress() })
  expect(mockNotesState.applyProposal).not.toHaveBeenCalled()
  expect(mockNotesState.clearProposal).not.toHaveBeenCalled()
})

test('offers only the genuinely changed field, counts it, and highlights the new words', async () => {
  setProposal({ title: 'Nowy temat', tags: [' nauka ', 'NAUKA'] })
  await update()
  await open()
  expect(textNodes('Bez zmian')).toHaveLength(2)
  expect(textNodes('Nauka')).toHaveLength(1)
  expect(radios()).toHaveLength(2)
  const proposed = radios()[1]
  await act(async () => { proposed.props.onPress() })
  expect(button('Zastosuj 1 zmianę').props.disabled).toBe(false)
  expect(textNodes('Nowy temat').length).toBeGreaterThan(0)
  await act(async () => { await button('Zastosuj 1 zmianę').props.onPress() })
  expect(mockNotesState.applyProposal).toHaveBeenCalledWith(mockNote.id, { title: true, summary: false, tags: false })
})

test('keeps failed fields and warnings distinct from successful identical fields', async () => {
  setProposal({ summary: '', failedFields: ['summary'], warnings: ['Niepełne podsumowanie'] })
  await update()
  await open()
  expect(textNodes('Bez zmian')).toHaveLength(2)
  expect(textNodes('Niedostępne')).toHaveLength(1)
  expect(textNodes('Niepełne podsumowanie')).toHaveLength(1)
  expect(textNodes('Brak zmian. Propozycje są takie same jak obecne wartości.')).toHaveLength(0)
  expect(textNodes('Brak zmian do zastosowania.')).toHaveLength(1)
  expect(radios()).toHaveLength(0)
  expect(button('Zastosuj 0 zmian').props.disabled).toBe(true)
})

test('disables an old selection when raw source identity changes while the chooser is open', async () => {
  setProposal({ title: 'Nowy temat' })
  await update()
  await open()
  await act(async () => { radios()[1].props.onPress() })
  const oldApply = button('Zastosuj 1 zmianę').props.onPress as () => void
  mockNotesState.notes = [{ ...mockNotesState.notes[0], tags: [' nauka '] }]
  await update()
  expect(radios()).toHaveLength(0)
  expect(button('Zastosuj 0 zmian').props.disabled).toBe(true)
  await act(async () => { await button('Zastosuj 0 zmian').props.onPress() })
  expect(mockNotesState.applyProposal).not.toHaveBeenCalled()
  // A previously captured closure still delegates to the store's exact current-source guard.
  mockNotesState.applyProposal.mockResolvedValueOnce(false)
  await act(async () => { oldApply() })
  expect(mockNotesState.applyProposal).toHaveBeenCalledTimes(1)
})

test('retains the current-versus-new choice for actual category and summary changes', async () => {
  setProposal({ summary: 'Nowe podsumowanie.', tags: ['Praca'] })
  await update()
  await open()
  expect(radios()).toHaveLength(4)
  expect(textNodes('Bez zmian')).toHaveLength(1)
  await act(async () => { radios()[1].props.onPress(); radios()[3].props.onPress() })
  expect(button('Zastosuj 2 zmiany').props.disabled).toBe(false)
  await act(async () => { await button('Zastosuj 2 zmiany').props.onPress() })
  expect(mockNotesState.applyProposal).toHaveBeenCalledWith(mockNote.id, { title: false, summary: true, tags: true })
})

test('shows the proposal as static text with the added words highlighted', async () => {
  setProposal({ title: 'Nowy temat', summary: 'Nowe podsumowanie.' })
  await update()
  await open()
  expect(textNodes('Nowy temat').length).toBeGreaterThan(0)
  expect(textNodes('Nowe podsumowanie.').length).toBeGreaterThan(0)
})

test('shows one processing card with one phase label from the first phase on, without skeletons or a header indicator', async () => {
  const label = () => tree.root.findByType(ProcessingLive)
  const texts = () => tree.root.findAllByType(Text).map(node => node.props.children).filter((child): child is string => typeof child === 'string')
  const phases: [ProcessingProgress['phase'], string][] = [
    ['queued', 'Czekam na model'], ['loading', 'Wczytuję model'], ['processing', 'Zakreślam najważniejsze'],
    ['summary', 'Zakreślam najważniejsze'], ['title', 'Dobieram tytuł'],
  ]
  for (const [phase, expected] of phases) {
    mockNotesState.processing = { [mockNote.id]: { phase } }
    await update()
    expect(label().props.phase).toBe(phase)
    expect(texts()).toContain(expected)
    expect(tree.root.findByType(Stack.Screen).props.options.headerTitle).toBe('Notatka')
  }
  expect(texts()).not.toContain('Pierwszy punkt…')
  expect(texts()).not.toContain('Następny punkt…')
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(texts()).toContain('Pierwszy punkt…')
})

test('keeps the previous content while processing and publishes the result in one step', async () => {
  const title = () => tree.root.findAll(node => node.props.accessibilityRole === 'header' && typeof node.props.children === 'string')
    .map(node => node.props.children)
  const hasText = (value: string) => tree.root.findAllByType(Text).some(node => node.props.children === value)
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(title()).toContain('Prezentacja pracy')
  expect(hasText('Wyniki testów.')).toBe(false)
  mockNotesState.notes = [{ ...mockNotesState.notes[0], title: 'Testy aplikacji', summary: 'Gotowe podsumowanie.', updatedAt: 2 }]
  await update()
  expect(title()).toContain('Prezentacja pracy')
  expect(hasText('Gotowe podsumowanie.')).toBe(false)
  mockNotesState.processing = {}
  await update()
  expect(title()).toContain('Testy aplikacji')
  expect(hasText('Gotowe podsumowanie.')).toBe(true)
  expect(tree.root.findAllByType(ProcessingLive)).toHaveLength(0)
})

test('crossfades from the processing card to the result and then drops the card', async () => {
  jest.useFakeTimers()
  try {
    mockReducedMotion = false
    mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
    await update()
    mockNotesState.notes = [{ ...mockNotesState.notes[0], summary: 'Gotowe podsumowanie.', updatedAt: 2 }]
    mockNotesState.processing = {}
    await update()
    await act(async () => { jest.advanceTimersByTime(50) })
    await act(async () => { jest.advanceTimersByTime(1000) })
    expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Gotowe podsumowanie.')).toBe(true)
    expect(tree.root.findAllByType(ProcessingLive)).toHaveLength(0)
  } finally { jest.useRealTimers() }
})

test('a pending proposal stays visible as a banner that opens the choice or discards it', async () => {
  setProposal({ title: 'Nowy temat' })
  await update()
  const labels = () => tree.root.findAllByType(Button).map(node => node.props.label)
  expect(labels()).toContain('Zobacz')
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'Nowa wersja jest gotowa')).toBe(true)
  await act(async () => { button('Zobacz').props.onPress() })
  expect(tree.root.findAllByProps({ accessibilityViewIsModal: true }).length).toBeGreaterThan(0)
  expect(labels()).not.toContain('Zobacz')
  await act(async () => { await button('Anuluj').props.onPress() })
  expect(labels()).toContain('Zobacz')
  await act(async () => { await button('Odrzuć').props.onPress() })
  expect(mockNotesState.clearProposal).toHaveBeenCalledWith(mockNote.id, mockNotesState.proposals[mockNote.id])
})

test('the banner is hidden while the note is processing and when no proposal exists', async () => {
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(tree.root.findAllByType(Button).map(node => node.props.label)).not.toContain('Zobacz')
  mockNotesState.processing = {}
  mockNotesState.proposals = {}
  await update()
  expect(tree.root.findAllByType(Button).map(node => node.props.label)).not.toContain('Zobacz')
})

test('deleting asks in a bottom sheet instead of a system alert', async () => {
  await act(async () => { button('Usuń notatkę').props.onPress() })
  const sheet = tree.root.findAllByType(BottomSheet).find(item => item.props.title === 'Usunąć notatkę?')
  expect(sheet?.props.visible).toBe(true)
  await act(async () => { await button('Usuń').props.onPress() })
  expect(mockNotesState.remove).toHaveBeenCalledWith(mockNote.id)
  expect(mockRouter.replace).toHaveBeenCalledWith('/')
})

const sourceDocument: SummaryDocument = {
  version: 1, source: mockNote.content, format: 'bullets',
  points: [{ text: 'Wyniki testów.', sources: [{ start: 0, end: 24 }] }],
}
const sourceNote: Note = { ...mockNote, summary: '• Wyniki testów.', summaryDocument: sourceDocument }
const sourceActions = () => tree.root.findAll(node => node.props.accessibilityRole === 'button'
  && typeof node.type === 'function' && typeof node.props.accessibilityLabel === 'string'
  && node.props.accessibilityLabel.startsWith('Pokaż źródło: '), { deep: false })
const sourceQuotes = () => tree.root.findAllByType(Text).filter(node => node.props.testID === 'summary-source-quote')
const pressSource = async () => {
  expect(sourceActions()).toHaveLength(1)
  await act(async () => { sourceActions()[0].props.onPress() })
  expect(tree.root.findByType(SummaryWithSources).findByType(BottomSheet).props.visible).toBe(true)
}

test('opens literal saved content from a source row', async () => {
  mockNotesState.notes = [sourceNote]
  await update()
  await pressSource()
  expect(sourceQuotes().map(node => node.props.children)).toEqual(['Dosłowne źródło notatki.'])
})

test('shows no source rows while a linked summary is being replaced', async () => {
  mockNotesState.notes = [sourceNote]
  await update()
  expect(sourceActions()).toHaveLength(1)
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(tree.root.findAllByType(ProcessingLive)).toHaveLength(1)
})

test.each(['focus', 'revision', 'content', 'document', 'route'] as const)('removes an open source panel in the first screen commit after %s changes', async change => {
  mockNotesState.notes = [sourceNote]
  await update(); await pressSource()
  const frames: number[] = []
  mockCommitObserver = () => frames.push(sourceQuotes().length)
  try {
    if (change === 'focus') mockFocused = false
    if (change === 'revision') mockNotesState.notes = [{ ...sourceNote, updatedAt: 2 }]
    if (change === 'content') mockNotesState.notes = [{ ...sourceNote, content: `${sourceNote.content} ` }]
    if (change === 'document') mockNotesState.notes = [{ ...sourceNote, summaryDocument: { ...sourceDocument,
      points: [{ ...sourceDocument.points[0], sources: [{ start: 0, end: 8 }] }] } }]
    if (change === 'route') {
      mockRouteId = 'other-note'
      mockNotesState.notes = [sourceNote, { ...sourceNote, id: mockRouteId }]
    }
    await update()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(count => count === 0)).toBe(true)
    if (change === 'focus' || change === 'content') expect(sourceActions()).toHaveLength(0)
  } finally { mockCommitObserver = undefined }
})

test('keeps invalid canonical metadata and legacy summaries in the plain renderer', async () => {
  const plain = (value: string) => tree.root.findAllByType(Text).some(node => node.props.children === value)
  mockNotesState.notes = [{ ...mockNote, summaryDocument: sourceDocument }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(plain(mockNote.summary!)).toBe(true)
  mockNotesState.notes = [{ ...sourceNote, summaryDocument: null }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(plain(sourceNote.summary!)).toBe(true)
})
