import { createElement, Profiler } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { AppState, LayoutAnimation, Text } from 'react-native'
import { Stack } from 'expo-router'
import type { Note } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'
import type { NoteProcessingResult, ProcessingProgress } from '../ai/noteProcessing'
import { createNoteProposal, type NoteProposal } from '../notes/noteProposals'
import { Button } from '../ui/Button'
import { ProcessingIndicator, RevealText, SkeletonText } from '../ui/Motion'
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
let mockTitlePending: string | undefined
let mockRouteId = 'proposal-note'
let mockCommitObserver: (() => void) | undefined
const mockRouter = { canGoBack: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn(), setParams: jest.fn() }
jest.mock('../state/notesStore', () => ({
  useNotesStore: Object.assign((select: (state: typeof mockNotesState) => unknown) => select(mockNotesState), {
    getState: () => mockNotesState,
  }),
}))
jest.mock('../state/tasksStore', () => ({ useTasksStore: () => [] }))
jest.mock('../state/modelStore', () => ({ useModelStore: () => true }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: () => 'light' }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl' }) }))
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: mockRouteId, titlePending: mockTitlePending }),
  useRouter: () => mockRouter,
}))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../ui/theme', () => {
  const theme = jest.requireActual('../ui/theme') as typeof import('../ui/theme')
  return { ...theme, useTheme: () => ({ colors: theme.colors, isDark: false }) }
})
jest.mock('../ui/Icon', () => ({ Icon: () => null, IconButton: () => null }))
jest.mock('../ui/Motion', () => {
  const React = jest.requireActual('react') as typeof import('react')
  const Native = jest.requireActual('react-native') as typeof import('react-native')
  return {
    RevealText: jest.fn(({ text }: { text: string }) => React.createElement(Native.Text, null, text)),
    ProcessingIndicator: () => null, SkeletonText: () => React.createElement(Native.View), useReducedMotion: () => mockReducedMotion,
  }
})
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
  mockTitlePending = undefined
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

test('v34 animates the layout when a generated category first arrives', async () => {
  mockReducedMotion = false
  mockNotesState.notes = [{ ...mockNote, tags: [] }]
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  mockNotesState.notes = [{ ...mockNotesState.notes[0], tags: ['Praca'], updatedAt: 2 }]
  await update()
  expect(configure).toHaveBeenCalledWith(expect.objectContaining({ duration: 320, update: expect.objectContaining({ type: 'easeInEaseOut' }) }))
  expect(tree.root.findByProps({ testID: 'category-values' }).props.children).toBe('Praca')
  configure.mockRestore()
})

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

test('shows proposals as static highlighted text and marks main reveals inactive after the note loses focus', async () => {
  setProposal({ title: 'Nowy temat', summary: 'Nowe podsumowanie.' })
  await update()
  await open()
  expect(chooser().findAllByType(RevealText)).toHaveLength(0)
  mockFocused = false
  await update()
  const mainReveals = tree.root.findAllByType(RevealText)
  expect(mainReveals).toHaveLength(2)
  expect(mainReveals.every((item) => item.props.active === false)).toBe(true)
})

test('preserves saved fields during processing and stops decorative motion on lost focus', async () => {
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  mockFocused = false
  await update()
  const skeletons = tree.root.findAllByType(SkeletonText)
  expect(skeletons).toHaveLength(1)
  expect(skeletons.every((item) => item.props.active === false)).toBe(true)
  expect(tree.root.findAllByType(RevealText).map((item) => item.props.text)).toEqual(['Prezentacja pracy', 'Wyniki testów.'])
  expect(tree.root.findByProps({ testID: 'category-values' }).props.children).toBe('Nauka')
  const screen = tree.root.findByType(Stack.Screen)
  const title = screen.props.options.headerTitle as () => ReturnType<typeof createElement>
  const header = title()
  expect(header.type).toBe(ProcessingIndicator)
  expect(header.props).toMatchObject({ active: false, stage: 'processing', label: 'Tworzę podsumowanie…' })
})

test('reflects model, speech structuring and result stages without erasing the note', async () => {
  const header = () => (tree.root.findByType(Stack.Screen).props.options.headerTitle as () => ReturnType<typeof createElement>)()
  mockNotesState.processing = { [mockNote.id]: { phase: 'loading' } }
  await update()
  expect(header().props).toMatchObject({ stage: 'loading', label: 'Wczytuję model…' })
  expect(tree.root.findByType(SkeletonText).props.animate).toBe(false)
  mockNotesState.processing = { [mockNote.id]: { phase: 'processing', detail: 'structure' } }
  await update()
  expect(header().props).toMatchObject({ stage: 'processing', label: 'Porządkuję wypowiedź…' })
  expect(tree.root.findByType(SkeletonText).props.animate).toBe(true)
  expect(tree.root.findAllByType(RevealText).find((item) => item.props.text === mockNote.title)?.props.accessibilityRole).toBe('header')
  expect(mockNotesState.applyProposal).not.toHaveBeenCalled()
})

test('reveals a newly saved title before processing cleanup and removes its generation lettering', async () => {
  mockReducedMotion = false
  mockNotesState.processing = { [mockNote.id]: { phase: 'title' } }
  await update()
  mockNotesState.notes = [{ ...mockNotesState.notes[0], title: 'Testy aplikacji', updatedAt: 2 }]
  await update()
  const title = () => tree.root.findAllByType(RevealText).find((item) => item.props.accessibilityRole === 'header')!
  expect(title().props).toMatchObject({ text: 'Testy aplikacji', animate: true, active: true })
  expect(tree.root.findAllByType(SkeletonText).filter(item => item.props.title === true)).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find((item) => item.props.text === mockNote.summary)?.props.animate).toBe(false)
  mockNotesState.processing = {}
  await update()
  expect(title().props.animate).toBe(true)
})

test('replaces summary loading with the ready source before processing cleanup and keeps it replaced', async () => {
  mockReducedMotion = false
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(1)
  mockNotesState.notes = [{ ...mockNotesState.notes[0], summary: 'Gotowe podsumowanie źródła.', updatedAt: 2 }]
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  const result = () => tree.root.findAllByType(RevealText).find(item => item.props.text === 'Gotowe podsumowanie źródła.')!
  expect(result().props.animate).toBe(true)
  mockNotesState.processing = { [mockNote.id]: { phase: 'tags' } }
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(result().props.animate).toBe(true)
  await act(async () => { result().props.onRevealComplete('Gotowe podsumowanie źródła.') })
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(result().props.animate).toBe(false)
})

test('keeps a summary reveal alive until its own native completion rather than a parent timer', async () => {
  jest.useFakeTimers()
  try {
    mockReducedMotion = false
    mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
    await update()
    const summary = 'Anna przygotuje szczegółowe wyniki testów i porówna wszystkie długie nagrania. '.repeat(6).trim()
    mockNotesState.notes = [{ ...mockNotesState.notes[0], summary, updatedAt: 2 }]
    await update()
    mockNotesState.processing = {}
    await update()
    const result = () => tree.root.findAllByType(RevealText).find(item => item.props.text === summary)!
    expect(result().props.animate).toBe(true)
    await act(async () => { jest.advanceTimersByTime(3200) })
    expect(result().props.animate).toBe(true)
    await act(async () => { result().props.onRevealComplete(summary) })
    expect(result().props.animate).toBe(false)
    expect(result().props.text).toBe(summary)
  } finally { jest.useRealTimers() }
})

test('keeps one saved heading during title generation without a second ghost row', async () => {
  mockNotesState.processing = { [mockNote.id]: { phase: 'title' } }
  await update()
  const titleSkeleton = () => tree.root.findAllByType(SkeletonText).filter(item => item.props.title === true)
  expect(titleSkeleton()).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(item => item.props.accessibilityRole === 'header')?.props.text).toBe(mockNote.title)
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(titleSkeleton()).toHaveLength(0)
})

test('an explicitly new capture loads title in its own place and consumes that marker at publication', async () => {
  mockTitlePending = '1'
  mockNotesState.notes = [{ ...mockNote, title: 'Nagranie 06.10.2026 16:00', summary: null, tags: [] }]
  mockNotesState.processing = { [mockNote.id]: { phase: 'loading' } }
  await update()
  expect(tree.root.findAllByType(SkeletonText).filter(item => item.props.title === true)).toHaveLength(1)
  expect(tree.root.findAllByType(RevealText).filter(item => item.props.accessibilityRole === 'header')).toHaveLength(0)
  mockNotesState.notes = [{ ...mockNotesState.notes[0], title: 'Testy aplikacji', summary: 'Gotowe źródło.', updatedAt: 2 }]
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(item => item.props.accessibilityRole === 'header')?.props).toMatchObject({ text: 'Testy aplikacji', animate: true })
  expect(mockRouter.setParams).toHaveBeenCalledWith({ titlePending: undefined })
})

test('a stale new-title marker cannot mask a saved title without an active run', async () => {
  mockTitlePending = '1'
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(item => item.props.accessibilityRole === 'header')?.props.text).toBe(mockNote.title)
})

test('an unchanged failed title becomes visible when the other result fields are published', async () => {
  mockTitlePending = '1'
  mockNotesState.notes = [{ ...mockNote, title: 'Nagranie 06.10.2026 16:00', summary: null, tags: [] }]
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  mockNotesState.notes = [{ ...mockNotesState.notes[0], summary: 'Gotowe podsumowanie.', updatedAt: 2 }]
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(item => item.props.accessibilityRole === 'header')?.props).toMatchObject({ text: 'Nagranie 06.10.2026 16:00', animate: false })
})

test('an explicitly pending title is released after failure and cannot hide a saved field after remount', async () => {
  mockTitlePending = '1'
  mockNotesState.processing = { [mockNote.id]: { phase: 'title' } }
  await update()
  expect(tree.root.findAllByType(SkeletonText).filter(item => item.props.title === true)).toHaveLength(1)
  mockTitlePending = undefined
  mockNotesState.processing = {}
  await update()
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(item => item.props.accessibilityRole === 'header')?.props.text).toBe(mockNote.title)
  await act(async () => { tree.unmount() })
  mockNotesState.processing = { [mockNote.id]: { phase: 'title' } }
  await act(async () => { tree = create(screenElement()) })
  expect(tree.root.findAllByType(SkeletonText).filter(item => item.props.title === true)).toHaveLength(0)
})

test('reveals changed result fields independently and keeps unchanged or manually edited fields plain', async () => {
  mockReducedMotion = false
  mockNotesState.notes = [{ ...mockNotesState.notes[0], title: 'Ręczna zmiana' }]
  await update()
  expect(tree.root.findAllByType(RevealText).every((item) => item.props.animate === false)).toBe(true)
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  mockNotesState.notes = [{ ...mockNotesState.notes[0], summary: 'Nowy zapis wyników.', updatedAt: 2 }]
  await update()
  const reveals = tree.root.findAllByType(RevealText)
  expect(reveals.find((item) => item.props.text === 'Nowy zapis wyników.')?.props.animate).toBe(true)
  expect(reveals.find((item) => item.props.text === 'Ręczna zmiana')?.props.animate).toBe(false)
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

test('activates metadata-only sources after scheduling layout and opens literal saved content', async () => {
  mockReducedMotion = false
  mockNotesState.notes = [{ ...sourceNote, summaryDocument: null }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  const frames: { actions: number; scheduled: number }[] = []
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  mockCommitObserver = () => frames.push({ actions: sourceActions().length, scheduled: configure.mock.calls.length })
  try {
    mockNotesState.notes = [sourceNote]
    await update()
    expect(frames[0].actions).toBe(0)
    expect(frames.some(frame => frame.actions === 1)).toBe(true)
    expect(frames.filter(frame => frame.actions > 0).every(frame => frame.scheduled > 0)).toBe(true)
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({ duration: 320 }))
    await pressSource()
    expect(sourceQuotes().map(node => node.props.children)).toEqual(['Dosłowne źródło notatki.'])
  } finally { mockCommitObserver = undefined; configure.mockRestore() }
})

test('waits for the matching native summary completion before switching to source rows', async () => {
  mockReducedMotion = false
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  mockNotesState.notes = [{ ...sourceNote, updatedAt: 2 }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  const reveal = () => tree.root.findAllByType(RevealText).find(node => node.props.text === sourceNote.summary)!
  expect(reveal().props.animate).toBe(true)
  await act(async () => { reveal().props.onRevealComplete('Stary wynik.') })
  expect(sourceActions()).toHaveLength(0)
  mockNotesState.processing = {}
  await update()
  expect(reveal().props.animate).toBe(true)
  const frames: { sources: number; scheduled: number }[] = []
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  mockCommitObserver = () => frames.push({ sources: sourceActions().length, scheduled: configure.mock.calls.length })
  try {
    await act(async () => { reveal().props.onRevealComplete(sourceNote.summary) })
    expect(frames.some(frame => frame.sources === 1)).toBe(true)
    expect(frames.filter(frame => frame.sources > 0).every(frame => frame.scheduled > 0)).toBe(true)
    expect(tree.root.findAllByType(RevealText).filter(node => node.props.text === sourceNote.summary)).toHaveLength(0)
  } finally { mockCommitObserver = undefined; configure.mockRestore() }
})

test('ReduceMotion makes saved sources immediately actionable without reveal choreography', async () => {
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  try {
    mockNotesState.notes = [{ ...sourceNote, updatedAt: 2 }]
    await update()
    await pressSource()
    expect(configure).not.toHaveBeenCalled()
    expect(tree.root.findAllByType(RevealText).filter(node => node.props.text === sourceNote.summary)).toHaveLength(0)
  } finally { configure.mockRestore() }
})

test('never attaches new metadata to a delayed old summary presentation', async () => {
  mockReducedMotion = false
  mockNotesState.notes = [sourceNote]
  await update()
  await pressSource()
  const frames: { actions: number; quotes: number; reveal: string[] }[] = []
  mockCommitObserver = () => frames.push({ actions: sourceActions().length, quotes: sourceQuotes().length,
    reveal: tree.root.findAllByType(RevealText).map(node => node.props.text) })
  try {
    mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
    await update()
    frames.length = 0
    mockNotesState.notes = [{ ...sourceNote, summary: '• Nowe wyniki.', updatedAt: 2,
      summaryDocument: { ...sourceDocument, points: [{ ...sourceDocument.points[0], text: 'Nowe wyniki.' }] } }]
    await update()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every(frame => frame.actions === 0 && frame.quotes === 0)).toBe(true)
    expect(frames[0].reveal).toContain('• Wyniki testów.')
    expect(tree.root.findAllByType(RevealText).find(node => node.props.text === '• Nowe wyniki.')?.props.animate).toBe(true)
  } finally { mockCommitObserver = undefined }
})

test.each(['focus', 'revision', 'content', 'document', 'route'] as const)('removes an open source panel in the first screen commit after %s changes', async change => {
  mockReducedMotion = false
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

test('preserves the saved reveal and skeleton while a linked summary is waiting for replacement', async () => {
  mockNotesState.notes = [sourceNote]
  await update()
  mockNotesState.processing = { [mockNote.id]: { phase: 'summary' } }
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(node => node.props.text === sourceNote.summary)?.props.animate).toBe(false)
  expect(tree.root.findAllByType(SkeletonText)).toHaveLength(1)
})

test('keeps invalid canonical metadata and legacy summaries in the incumbent plain renderer', async () => {
  mockNotesState.notes = [{ ...mockNote, summaryDocument: sourceDocument }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(node => node.props.text === mockNote.summary)).toBeDefined()
  mockNotesState.notes = [{ ...sourceNote, summaryDocument: null }]
  await update()
  expect(sourceActions()).toHaveLength(0)
  expect(tree.root.findAllByType(RevealText).find(node => node.props.text === sourceNote.summary)).toBeDefined()
})
