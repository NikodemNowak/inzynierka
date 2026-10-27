import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { AppState, Modal, Text, type AppStateStatus } from 'react-native'
import { NoteTasks } from './NoteTasks'
import { TaskArrival } from './TaskMotion'
import type { Note } from '../domain/note'
import type { TaskProposal } from '../ai/taskProposal'
import { createTaskProposal } from '../ai/taskProposal'
import { Button } from '../ui/Button'
import { FadeText } from './FadeText'
import { ensureModelReady } from '../ai/noteProcessing'
import type { Task } from '../domain/task'
import { discardPendingProcessingResult } from '../data/processingJobsRepository'

const mockNote: Note = {
  id: 'task-motion-note', title: 'A note', content: 'Daniel ma sprawdzić tabelę Norah ma przygotować wykres',
  summary: null, tags: [], audioUri: null, durationMs: null, createdAt: 1, updatedAt: 1, language: 'pl',
}
const mockTasksState = { tasks: [] as Task[], addForNote: jest.fn(async (): Promise<void> => undefined), toggle: jest.fn(), remove: jest.fn() }
const mockNotesState = { notes: [mockNote], processing: {} }
let mockFocused = true
let mockReducedMotion = false
let mockRevealCompletes = true
let mockArrivalCompletes = true

jest.mock('./TaskMotion', () => {
  const actual = jest.requireActual<typeof import('./TaskMotion')>('./TaskMotion')
  const React = jest.requireActual<typeof import('react')>('react')
  return { ...actual, TaskArrival: (props: Parameters<typeof actual.TaskArrival>[0]) => {
    React.useEffect(() => { if (mockArrivalCompletes && props.enter) props.onArrivalComplete?.() }, [props.enter, props.onArrivalComplete])
    return React.createElement(actual.TaskArrival, { ...props, onArrivalComplete: undefined })
  } }
})

jest.mock('../ui/Motion', () => ({ useReducedMotion: () => mockReducedMotion }))
jest.mock('../ui/PulseDot', () => ({ PulseDot: () => null }))
jest.mock('./FadeText', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    FadeText: ({ text, animate, onRevealComplete }: { text: string; animate?: boolean; onRevealComplete?: (text: string) => void }) => {
      React.useEffect(() => { if (mockRevealCompletes && animate) onRevealComplete?.(text) }, [text, animate, onRevealComplete])
      return React.createElement(Text, { accessibilityLabel: text }, text)
    },
  }
})

jest.mock('../state/tasksStore', () => ({
  useTasksStore: Object.assign((select: (state: typeof mockTasksState) => unknown) => select(mockTasksState), {
    getState: () => mockTasksState,
  }),
}))
jest.mock('../state/notesStore', () => ({
  useNotesStore: Object.assign((select: (state: typeof mockNotesState) => unknown) => select(mockNotesState), {
    getState: () => mockNotesState,
  }),
}))
jest.mock('../state/modelStore', () => ({ useModelStore: () => true }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: { getState: () => ({ backgroundProcessing: false }) } }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl' }) }))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../ui/theme', () => ({
  ...(jest.requireActual('../ui/theme') as typeof import('../ui/theme')),
  useTheme: () => ({ colors: { ink: '#102030', muted: '#506070', action: '#304050', onAction: '#ffffff',
    accent: '#304050', faint: '#708090', line: '#eeeeee', canvas: '#ffffff', danger: '#aa0000', body: '#102030' } }),
}))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: (job: () => Promise<unknown>) => job() }))
jest.mock('../ai/taskProposal', () => ({ createTaskProposal: jest.fn() }))
jest.mock('../ai/noteProcessing', () => ({ ensureModelReady: jest.fn(async () => undefined), getModelMissingMessage: () => '' }))
jest.mock('../ai/generationMetrics', () => ({ recordOperationTiming: jest.fn() }))
jest.mock('../data/processingJobsRepository', () => ({
  findPendingProcessingResult: jest.fn(async () => null), discardPendingProcessingResult: jest.fn(async () => undefined),
}))
jest.mock('../processing/jobRunner', () => ({
  runDurableProcessing: async (_request: unknown, run: (execution: object) => Promise<TaskProposal>, commit: () => Promise<boolean>) => {
    const result = await run({})
    await commit()
    return result
  },
}))

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}
let tree: ReactTestRenderer
const lineTexts = (): string[] => tree.root.findAllByType(Text).map((node) => node.props.children).filter((child): child is string => typeof child === 'string')
const press = async (label: string) => {
  const node = tree.root.findAllByType(Button).find((item) => item.props.label === label)
  expect(node).toBeDefined()
  await act(async () => { node!.props.onPress() })
}
beforeEach(async () => {
  jest.clearAllMocks()
  mockFocused = true
  mockReducedMotion = false
  mockRevealCompletes = true
  mockArrivalCompletes = true
  AppState.currentState = 'active'
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }))
  mockTasksState.tasks = []
  mockNotesState.notes = [mockNote]
  mockTasksState.addForNote.mockReset().mockResolvedValue(undefined)
  jest.mocked(ensureModelReady).mockReset().mockResolvedValue(null)
  jest.mocked(discardPendingProcessingResult).mockReset().mockResolvedValue(undefined)
  jest.mocked(createTaskProposal).mockReset().mockResolvedValue({ tasks: ['Daniel ma sprawdzić tabelę', 'Norah ma przygotować wykres'], warnings: [] })
  await act(async () => { tree = create(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
})
afterEach(async () => { await act(async () => { tree.unmount() }); jest.restoreAllMocks() })

test('announces the real current extraction status only after the user starts analysis', async () => {
  expect(lineTexts()).not.toContain('Sprawdzam rzeczywiste zadania…')
  const generation = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockImplementationOnce((_source, onStatus) => {
    onStatus('Sprawdzam rzeczywiste zadania…')
    return generation.promise
  })
  await press('Zaproponuj zadania')
  expect(lineTexts()).toContain('Sprawdzam rzeczywiste zadania…')
  await act(async () => { generation.resolve({ tasks: [], warnings: [] }) })
  expect(lineTexts()).not.toContain('Sprawdzam rzeczywiste zadania…')
})

test('v34 shows one quiet status line, no placeholder rows, and only the real result afterwards', async () => {
  const generation = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockReturnValueOnce(generation.promise)
  await press('Zaproponuj zadania')
  expect(lineTexts()).toContain('Opracowuję tekst…')
  expect(tree.root.findAll((node) => node.props.accessibilityRole === 'checkbox')).toHaveLength(0)
  await act(async () => { generation.resolve({ tasks: ['Sprawdzić tabelę'], warnings: [] }) })
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(['Sprawdzić tabelę'])
  expect(lineTexts()).not.toContain('Opracowuję tekst…')
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test('v35 releases task text strictly from top to bottom after the preceding reveal completes', async () => {
  mockRevealCompletes = false
  const proposals = ['Pierwsze zadanie', 'Drugie zadanie', 'Trzecie zadanie']
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks: proposals, warnings: [] })
  await press('Zaproponuj zadania')
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(proposals.slice(0, 1))
  expect(tree.root.findAll(item => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')).toHaveLength(3)
  const first = tree.root.findByType(FadeText).props.onRevealComplete
  await act(async () => { first(proposals[0]) })
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(proposals.slice(0, 2))
  await act(async () => { first(proposals[0]) })
  expect(tree.root.findAllByType(FadeText)).toHaveLength(2)
  await act(async () => { tree.root.findAllByType(FadeText)[1].props.onRevealComplete(proposals[1]) })
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(proposals)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test.each(['focus', 'motion'])('a generation crossing %s loss and return shows every real task without waiting for animation callbacks', async mode => {
  const generation = deferred<TaskProposal>()
  const tasks = ['Pierwsze zadanie', 'Drugie zadanie', 'Trzecie zadanie']
  jest.mocked(createTaskProposal).mockReturnValueOnce(generation.promise)
  await press('Zaproponuj zadania')
  if (mode === 'focus') mockFocused = false
  else mockReducedMotion = true
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  mockFocused = true; mockReducedMotion = false
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  await act(async () => { generation.resolve({ tasks, warnings: [] }) })
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(tasks)
  expect(tree.root.findAllByType(FadeText).every(node => !node.props.animate)).toBe(true)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test.each([6, 100])('keeps a %s-task result immediately selectable and lets every row enter on a fast stagger', async count => {
  mockRevealCompletes = false
  const tasks = Array.from({ length: count }, (_, index) => `Rzeczywiste zadanie ${index}`)
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks, warnings: [] })
  await press('Zaproponuj zadania')
  expect(tree.root.findAll(item => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')).toHaveLength(count)
  const entering = tree.root.findAllByType(TaskArrival).filter(row => row.props.enter)
  expect(entering).toHaveLength(count)
  expect(entering.map(row => row.props.index)).toEqual(tasks.map((_, index) => index))
  // A long list skips the slow letter reveal.
  expect(revealed()).toHaveLength(0)
  expect(tree.root.findAllByType(FadeText).map(node => node.props.text)).toEqual(tasks)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test('even immediate plain text waits for the row entrance, then does not replay on focus return', async () => {
  mockRevealCompletes = false; mockArrivalCompletes = false
  const tasks = ['Pierwsze zadanie', 'Drugie zadanie', 'Trzecie zadanie']
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks, warnings: [] })
  await press('Zaproponuj zadania')
  const first = tree.root.findByType(FadeText)
  await act(async () => { first.props.onRevealComplete(tasks[0]) })
  expect(tree.root.findAllByType(FadeText)).toHaveLength(1)
  await act(async () => { tree.root.findAllByType(TaskArrival).find(row => row.props.enter)!.props.onArrivalComplete() })
  expect(tree.root.findAllByType(FadeText)).toHaveLength(2)
  mockFocused = false
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  mockFocused = true
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  expect(tree.root.findAllByType(FadeText).map(row => row.props.text)).toEqual(tasks)
  expect(tree.root.findAllByType(TaskArrival).some(row => row.props.enter)).toBe(false)
})

test('derives loading and processing from real readiness callbacks rather than translated status text', async () => {
  const loaded = deferred<number>()
  const generation = deferred<TaskProposal>()
  jest.mocked(ensureModelReady).mockImplementationOnce(async (progress) => {
    progress({ phase: 'loading', percent: 0 })
    return loaded.promise
  })
  jest.mocked(createTaskProposal).mockImplementationOnce((_source, onStatus) => {
    onStatus('Nieporównywany napis z rzeczywistego callbacku')
    return generation.promise
  })
  await press('Zaproponuj zadania')
  expect(lineTexts()).toContain('Wczytuję model…')
  await act(async () => { loaded.resolve(5); await loaded.promise })
  expect(lineTexts()).toContain('Nieporównywany napis z rzeczywistego callbacku')
  const action = tree.root.findAllByType(Button).find((item) => item.props.label === 'Zaproponuj zadania')!
  expect(action.props.disabled).toBe(true)
  expect(action.props.busy).toBeUndefined()
  expect(tree.root.findAll((item) => item.props.accessibilityRole === 'progressbar')).toHaveLength(0)
  await act(async () => { generation.resolve({ tasks: [], warnings: [] }) })
})

test('shows saving only during the actual awaited write and keeps the selection available without a second spinner', async () => {
  await press('Zaproponuj zadania')
  const write = deferred<void>()
  mockTasksState.addForNote.mockReturnValueOnce(write.promise)
  await press('Dodaj zaznaczone (2)')
  expect(lineTexts()).toContain('Zapisuję zadania…')
  const buttons = tree.root.findAllByType(Button).filter((item) => item.props.label === 'Zapisuję zadania…')
  expect(buttons).toHaveLength(1)
  expect(buttons[0].props.disabled).toBe(true)
  expect(buttons[0].props.busy).toBeUndefined()
  expect(mockTasksState.addForNote).toHaveBeenCalledTimes(1)
  expect(mockTasksState.tasks).toHaveLength(0)
  await act(async () => { write.resolve(); await write.promise })
  expect(lineTexts()).not.toContain('Zapisuję zadania…')
})

test('makes selection available immediately and rejects duplicate add taps while the actual write is pending', async () => {
  await press('Zaproponuj zadania')
  const checks = tree.root.findAll((item) => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')
  expect(checks).toHaveLength(2)
  await act(async () => { checks[1].props.onPress() })
  const write = deferred<void>()
  mockTasksState.addForNote.mockReturnValueOnce(write.promise)
  const add = tree.root.findAllByType(Button).find((item) => item.props.label === 'Dodaj zaznaczone (1)')!
  await act(async () => { add.props.onPress(); add.props.onPress() })
  expect(mockTasksState.addForNote).toHaveBeenCalledTimes(1)
  expect(mockTasksState.addForNote).toHaveBeenCalledWith(mockNote.id, ['Daniel ma sprawdzić tabelę'])
  await act(async () => { write.resolve() })
})

test('keeps failed write feedback visible in the open chooser without pretending tasks were inserted', async () => {
  await press('Zaproponuj zadania')
  mockTasksState.addForNote.mockRejectedValueOnce(new Error('disk full'))
  await press('Dodaj zaznaczone (2)')
  const errors = tree.root.findAll((item) => item.props.accessibilityRole === 'alert' && item.props.children === 'disk full')
  expect(errors.length).toBeGreaterThan(0)
  expect(tree.root.findAll((item) => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')).toHaveLength(2)
})

test('keeps completed proposals inline without opening a modal when focus was lost during analysis', async () => {
  const generation = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockReturnValueOnce(generation.promise)
  await press('Zaproponuj zadania')
  mockFocused = false
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  await act(async () => { generation.resolve({ tasks: ['Daniel ma sprawdzić tabelę'], warnings: [] }) })
  expect(tree.root.findAllByType(Modal).filter((node) => node.props.visible)).toHaveLength(0)
  expect(revealed()).toHaveLength(0)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

const sixTasks = Array.from({ length: 6 }, (_, index) => `Daniel ma sprawdzić tabelę numer ${index + 1}`)
const revealed = () => tree.root.findAllByType(FadeText).filter((node) => node.props.animate === true)

test('fresh long proposals enter without letter reveals, select immediately and do not replay after hiding', async () => {
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks: sixTasks, warnings: [] })
  await press('Zaproponuj zadania')
  expect(tree.root.findAll((item) => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')).toHaveLength(6)
  expect(revealed()).toHaveLength(0)
  expect(tree.root.findAllByType(FadeText).map((item) => item.props.text)).toEqual(sixTasks)
  mockFocused = false
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  mockFocused = true
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  expect(revealed()).toHaveLength(0)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test('reveals only IDs confirmed by a completed durable Add and never pending optimistic rows', async () => {
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks: sixTasks, warnings: [] })
  await press('Zaproponuj zadania')
  const write = deferred<void>()
  mockTasksState.addForNote.mockImplementationOnce(async () => {
    await write.promise
    mockTasksState.tasks = sixTasks.map((text, index) => ({ id: `saved-${index}`, noteId: mockNote.id, text, done: false, createdAt: 2 }))
  })
  await press('Dodaj zaznaczone (6)')
  expect(mockTasksState.tasks).toHaveLength(0)
  await act(async () => { write.resolve(); await write.promise })
  expect(mockTasksState.tasks).toHaveLength(6)
  // Six saved rows fade in on a fast stagger instead of four letter reveals.
  expect(revealed()).toHaveLength(0)
  expect(tree.root.findAllByType(TaskArrival).filter((row) => row.props.count === 6)).toHaveLength(6)
  expect(tree.root.findAllByType(FadeText).map((item) => item.props.text)).toEqual(sixTasks)
})

test('a deferred durable Add crossing hide and return saves tasks without stale text reveal', async () => {
  await press('Zaproponuj zadania')
  const write = deferred<void>()
  mockTasksState.addForNote.mockImplementationOnce(async () => {
    await write.promise
    mockTasksState.tasks = [{ id: 'late-saved', noteId: mockNote.id, text: 'Daniel ma sprawdzić tabelę', done: false, createdAt: 2 }]
  })
  await press('Dodaj zaznaczone (2)')
  mockFocused = false
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  mockFocused = true
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  await act(async () => { write.resolve(); await write.promise })
  expect(mockTasksState.tasks).toHaveLength(1)
  expect(revealed()).toHaveLength(0)
})

test('initial saved tasks and Reduce Motion never start letter clocks', async () => {
  mockTasksState.tasks = [{ id: 'old-saved', noteId: mockNote.id, text: 'Daniel ma sprawdzić tabelę', done: false, createdAt: 1 }]
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  expect(revealed()).toHaveLength(0)
  mockReducedMotion = true
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  await press('Zaproponuj zadania')
  expect(revealed()).toHaveLength(0)
  expect(tree.root.findAllByType(FadeText).some((item) => item.props.text === 'Norah ma przygotować wykres')).toBe(true)
})

test('shows the quiet status line only while actual task processing is visible', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>()
  const stateChanged = (state: AppStateStatus) => { AppState.currentState = state; for (const listener of listeners) listener(state) }
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener)
    return { remove: () => { listeners.delete(listener) } }
  })
  try {
    await act(async () => { tree.unmount(); tree = create(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
    expect(lineTexts()).not.toContain('Sprawdzam rzeczywiste zadania…')
    const generation = deferred<TaskProposal>()
    jest.mocked(createTaskProposal).mockImplementationOnce((_source, onStatus) => {
      onStatus('Sprawdzam rzeczywiste zadania…')
      return generation.promise
    })
    await press('Zaproponuj zadania')
    expect(lineTexts()).toContain('Sprawdzam rzeczywiste zadania…')
    await act(async () => { stateChanged('background') })
    expect(lineTexts()).not.toContain('Sprawdzam rzeczywiste zadania…')
    await act(async () => { generation.resolve({ tasks: [], warnings: [] }) })
  } finally { subscription.mockRestore() }
})

test('replaces the status line with selectable results in the same section', async () => {
  const generation = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockReturnValueOnce(generation.promise)
  await press('Zaproponuj zadania')
  expect(tree.root.findAllByType(Modal).filter((node) => node.props.visible)).toHaveLength(0)
  expect(lineTexts()).toContain('Opracowuję tekst…')
  await act(async () => { generation.resolve({ tasks: ['Daniel ma sprawdzić tabelę'], warnings: [] }) })
  expect(tree.root.findAllByType(Modal).filter((node) => node.props.visible)).toHaveLength(0)
  expect(tree.root.findAll((node) => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')).toHaveLength(1)
  expect(tree.root.findAllByType(Button).some((node) => node.props.label === 'Dodaj zaznaczone (1)')).toBe(true)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})

test('starts only one extraction when Suggest is tapped twice before React rerenders', async () => {
  const generation = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockReturnValue(generation.promise)
  const suggest = tree.root.findByType(Button)
  await act(async () => { suggest.props.onPress(); suggest.props.onPress() })
  expect(createTaskProposal).toHaveBeenCalledTimes(1)
  await act(async () => { generation.resolve({ tasks: [], warnings: [] }) })
})

test('cannot publish or clear another note analysis when an old extraction finishes late', async () => {
  const first = deferred<TaskProposal>()
  const second = deferred<TaskProposal>()
  jest.mocked(createTaskProposal).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await press('Zaproponuj zadania')
  const nextNote = { ...mockNote, id: 'another-note', content: 'Anna ma wysłać raport' }
  mockNotesState.notes = [mockNote, nextNote]
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: nextNote.id, content: nextNote.content })) })
  await press('Zaproponuj zadania')
  await act(async () => { first.resolve({ tasks: ['Daniel ma sprawdzić tabelę'], warnings: [] }) })
  expect(tree.root.findAllByType(FadeText)).toHaveLength(0)
  expect(lineTexts()).toContain('Opracowuję tekst…')
  await act(async () => { second.resolve({ tasks: ['Anna ma wysłać raport'], warnings: [] }) })
  expect(tree.root.findAllByType(FadeText).map((node) => node.props.text)).toEqual(['Anna ma wysłać raport'])
})

test('does not extract tasks from an incomplete recording until transcription is completed', async () => {
  mockNotesState.notes = [{ ...mockNote, transcriptionIncomplete: true }]
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: mockNote.id, content: mockNote.content })) })
  const suggest = tree.root.findByType(Button)
  expect(suggest.props.disabled).toBe(true)
  await act(async () => { suggest.props.onPress() })
  expect(createTaskProposal).not.toHaveBeenCalled()
})

test('keeps selection after a failed discard and ignores duplicate discard taps', async () => {
  await press('Zaproponuj zadania')
  const discard = deferred<void>()
  jest.mocked(discardPendingProcessingResult).mockReturnValueOnce(discard.promise)
  const action = tree.root.findAllByType(Button).find((node) => node.props.label === 'Odrzuć propozycje')!
  await act(async () => { action.props.onPress(); action.props.onPress() })
  expect(discardPendingProcessingResult).toHaveBeenCalledTimes(1)
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
  await act(async () => { discard.resolve() })
  expect(tree.root.findAllByType(FadeText)).toHaveLength(0)
  await press('Zaproponuj zadania')
  jest.mocked(discardPendingProcessingResult).mockRejectedValueOnce(new Error('storage failed'))
  await press('Odrzuć propozycje')
  expect(tree.root.findAllByType(FadeText)).toHaveLength(2)
  expect(tree.root.findAllByType(Text).filter((node) => node.props.accessibilityRole === 'alert' && node.props.children === 'storage failed')).toHaveLength(1)
  await press('Dodaj zaznaczone (2)')
  expect(mockTasksState.addForNote).toHaveBeenCalledTimes(1)
})

test('an old task write cannot clear a different note selection after navigation', async () => {
  await press('Zaproponuj zadania')
  const write = deferred<void>()
  mockTasksState.addForNote.mockReturnValueOnce(write.promise)
  await press('Dodaj zaznaczone (2)')
  const nextNote = { ...mockNote, id: 'different-note', content: 'Anna ma wysłać raport' }
  mockNotesState.notes = [mockNote, nextNote]
  jest.mocked(createTaskProposal).mockResolvedValueOnce({ tasks: ['Anna ma wysłać raport'], warnings: [] })
  await act(async () => { tree.update(createElement(NoteTasks, { noteId: nextNote.id, content: nextNote.content })) })
  await press('Zaproponuj zadania')
  await act(async () => { write.resolve() })
  expect(tree.root.findAllByType(FadeText).map((node) => node.props.text)).toEqual(['Anna ma wysłać raport'])
  expect(tree.root.findAllByType(Button).find((node) => node.props.label === 'Dodaj zaznaczone (1)')!.props.disabled).toBe(false)
})

test('refuses an old selection if the source becomes incomplete before its next render', async () => {
  await press('Zaproponuj zadania')
  mockNotesState.notes = [{ ...mockNote, transcriptionIncomplete: true }]
  await press('Dodaj zaznaczone (2)')
  expect(mockTasksState.addForNote).not.toHaveBeenCalled()
})
