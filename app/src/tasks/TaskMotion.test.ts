import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Animated, AppState, StyleSheet, Text, type AppStateStatus } from 'react-native'
import { TaskArrival, TaskCheck, TaskText, TaskPlaceholder, publishPersistedTaskText, taskEntranceTiming, useTaskMotionActive, useTaskTextReveal, useTaskRevealSequence } from './TaskMotion'
import { RevealText } from '../ui/Motion'
import TasksScreen from '../app/(tabs)/tasks'
import type { Task } from '../domain/task'

const mockTaskState: { tasks: Task[]; toggle: jest.Mock<Promise<void>, [string]> } = {
  tasks: [],
  toggle: jest.fn(async (id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task)
  }),
}
let mockRowsVisible = true
let mockScreenFocused = true
let mockReducedMotion = false
jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native')
  const React = jest.requireActual<typeof import('react')>('react')
  return Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(actual),
    SectionList: { configurable: true, enumerable: true, writable: true,
      value: ({ sections, renderItem }: {
        sections: Array<{ data: Task[]; key: string }>
        renderItem: (args: { item: Task; index: number; section: { data: Task[]; key: string } }) => React.ReactNode
      }) => mockRowsVisible ? React.createElement(actual.View, {}, ...sections.flatMap((section) => section.data.map((item, index) =>
        React.createElement(React.Fragment, { key: item.id }, renderItem({ item, index, section }))))) : null,
    },
  })
})
jest.mock('../state/tasksStore', () => ({ useTasksStore: (select: (state: typeof mockTaskState) => unknown) => select(mockTaskState) }))
jest.mock('../state/notesStore', () => ({ useNotesStore: (select: (state: { notes: [] }) => unknown) => select({ notes: [] }) }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))
jest.mock('../ui/Motion', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native')
  return { useReducedMotion: () => mockReducedMotion,
    RevealText: ({ text }: { text: string }) => React.createElement(Text, { accessibilityLabel: text }, text),
  }
})
jest.mock('../notes/ModelDownloadBanner', () => ({ ModelDownloadBanner: () => null }))
jest.mock('./TasksEmptyState', () => ({ TasksEmptyState: () => null }))
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockScreenFocused }))

jest.mock('../ui/Icon', () => ({ Icon: () => null }))
jest.mock('../ui/theme', () => ({ ...jest.requireActual('../ui/theme'), useTheme: () => ({ colors: { onAction: '#ffffff' } }) }))

beforeEach(() => {
  mockRowsVisible = true
  mockScreenFocused = true
  mockReducedMotion = false
  AppState.currentState = 'active'
  mockTaskState.tasks = [{ id: 'literal-task', noteId: 'source-note', text: 'Send the complete literal report', done: false, createdAt: 1 }]
  mockTaskState.toggle.mockClear()
})

test('task sequencing rejects stale completions, skips motion while hidden and never replays on return', async () => {
  let oldComplete: (key: string) => void = () => undefined
  function Harness({ scope, active = true, reduced = false }: { scope: string; active?: boolean; reduced?: boolean }) {
    const sequence = useTaskRevealSequence(['First', 'Second', 'Third'], 'new-batch', scope, active, reduced)
    oldComplete = sequence.complete
    return createElement(Text, {}, [0, 1, 2].filter(sequence.ready).join(','))
  }
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(Harness, { scope: 'old' })) })
    expect(tree!.root.findByType(Text).props.children).toBe('0')
    const stale = oldComplete
    await act(async () => { tree!.update(createElement(Harness, { scope: 'new' })); stale('First') })
    expect(tree!.root.findByType(Text).props.children).toBe('0')
    await act(async () => { oldComplete('Second') })
    expect(tree!.root.findByType(Text).props.children).toBe('0')
    await act(async () => { tree!.update(createElement(Harness, { scope: 'new', active: false })) })
    expect(tree!.root.findByType(Text).props.children).toBe('0,1,2')
    await act(async () => { tree!.update(createElement(Harness, { scope: 'new' })) })
    expect(tree!.root.findByType(Text).props.children).toBe('0,1,2')
    await act(async () => { tree!.update(createElement(Harness, { scope: 'reduced', reduced: true })) })
    expect(tree!.root.findByType(Text).props.children).toBe('0,1,2')
  } finally { await act(async () => { tree!.unmount() }) }
})

test('a missing text completion has a finite sequence watchdog and is cancelled on source change', async () => {
  jest.useFakeTimers()
  function Harness({ scope }: { scope: string }) {
    const sequence = useTaskRevealSequence(['First', 'Second'], 'batch', scope, true, false)
    return createElement(Text, {}, [0, 1].filter(sequence.ready).join(','))
  }
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(Harness, { scope: 'old' })) })
    await act(async () => { jest.advanceTimersByTime(6499) })
    expect(tree!.root.findByType(Text).props.children).toBe('0')
    await act(async () => { tree!.update(createElement(Harness, { scope: 'new' })) })
    await act(async () => { jest.advanceTimersByTime(1) })
    expect(tree!.root.findByType(Text).props.children).toBe('0')
    await act(async () => { jest.advanceTimersByTime(6500) })
    expect(tree!.root.findByType(Text).props.children).toBe('0,1')
  } finally { await act(async () => { tree!.unmount() }); jest.useRealTimers() }
})

test('surplus row fade uses the native driver and stops before a replaced source can collapse', async () => {
  const stop = jest.fn()
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop, reset: jest.fn() }))
  const row = (exiting: boolean) => createElement(TaskPlaceholder, { index: 2, count: 1, exiting, active: true, reducedMotion: false,
    children: createElement(Text, {}, 'Waiting material') })
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(row(false)) })
    expect(timing).not.toHaveBeenCalled()
    await act(async () => { tree!.update(row(true)) })
    expect(timing.mock.calls[0][1]).toMatchObject({ delay: 200, duration: 180, useNativeDriver: true, isInteraction: false })
    await act(async () => { tree!.update(row(false)) })
    expect(stop).toHaveBeenCalled()
  } finally { await act(async () => { tree!.unmount() }); timing.mockRestore() }
})

test('v34 gives the next task a perceptible stagger without making the list wait for text', () => {
  const first = taskEntranceTiming(0, true, false)!
  const second = taskEntranceTiming(1, true, false)!
  const third = taskEntranceTiming(2, true, false)!
  expect(second.delay - first.delay).toBeGreaterThanOrEqual(120)
  expect(third.delay - second.delay).toBeGreaterThanOrEqual(120)
  expect(third.delay + third.duration).toBeLessThanOrEqual(720)
})

test('task list keeps native typography and truncation without nesting a reveal view inside Text', async () => {
  mockTaskState.tasks = [{ ...mockTaskState.tasks[0], done: true }]
  let tree: ReactTestRenderer
  await act(async () => { tree = create(createElement(TasksScreen)) })
  const task = tree!.root.findByType(TaskText)
  expect(task.props.numberOfLines).toBe(2)
  expect(StyleSheet.flatten(task.props.style)).toMatchObject({ fontSize: 16, lineHeight: 21, textDecorationLine: 'line-through' })
  for (let parent = task.parent; parent; parent = parent.parent) expect(parent.type).not.toBe(Text)
  expect(task.findByType(RevealText).props).toMatchObject({ numberOfLines: 2, active: true })
  await act(async () => { tree!.unmount() })
})

test('limits even a thousand-row list to four entrances and at most 720ms of native motion', () => {
  const plan = Array.from({ length: 1000 }, (_, index) => taskEntranceTiming(index, true, false)).filter((value) => value !== null)
  expect(plan).toHaveLength(4)
  expect(Math.max(...plan.map((value) => value.duration + value.delay))).toBeLessThanOrEqual(720)
  expect(taskEntranceTiming(-1, true, false)).toBeNull()
  expect(taskEntranceTiming(0.5, true, false)).toBeNull()
  expect(taskEntranceTiming(Infinity, true, false)).toBeNull()
})

test('disables entrances for Reduce Motion or hidden screens without delaying data', () => {
  expect(taskEntranceTiming(0, true, true)).toBeNull()
  expect(taskEntranceTiming(0, false, false)).toBeNull()
})

test.each(['native', 'watchdog'])('row completion through %s is finite, happens once, and rejects an old callback after cancellation', async mode => {
  jest.useFakeTimers()
  let complete: ((result: { finished: boolean }) => void) | undefined
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: jest.fn(callback => { complete = callback }), stop: jest.fn(), reset: jest.fn(),
  }))
  const done = jest.fn()
  const row = (enter: boolean, eventKey: string) => createElement(TaskArrival, { index: 0, active: true, reducedMotion: false,
    enter, eventKey, onArrivalComplete: done, children: createElement(Text, {}, 'Complete literal row') })
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(row(true, 'first')) })
    expect(done).not.toHaveBeenCalled()
    if (mode === 'native') await act(async () => { complete!({ finished: true }) })
    await act(async () => { jest.advanceTimersByTime(360) })
    expect(done).toHaveBeenCalledTimes(1)
    if (mode === 'watchdog') expect((StyleSheet.flatten(tree!.root.findByType(Animated.View).props.style).opacity as { __getValue: () => number }).__getValue()).toBe(1)
    await act(async () => { tree!.update(row(true, 'second')) })
    const cancelled = complete
    await act(async () => { tree!.update(row(false, 'second')) })
    await act(async () => { cancelled!({ finished: true }); jest.advanceTimersByTime(400) })
    expect(done).toHaveBeenCalledTimes(1)
  } finally { await act(async () => { tree!.unmount() }); timing.mockRestore(); jest.useRealTimers() }
})

test('a stable loading slot starts its entrance only when a real task fills it and does not replay on selection', async () => {
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }))
  const row = (text?: string) => createElement(TaskArrival, { index: 1, active: true, reducedMotion: false,
    enter: Boolean(text), eventKey: text, children: createElement(Text, {}, text ?? 'Waiting') })
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(row()) })
    expect(timing).not.toHaveBeenCalled()
    await act(async () => { tree!.update(row('Complete literal task')) })
    expect(timing).toHaveBeenCalledTimes(1)
    expect(timing.mock.calls[0][1]).toMatchObject({ delay: 140, useNativeDriver: true })
    await act(async () => { tree!.update(row('Complete literal task')) })
    expect(timing).toHaveBeenCalledTimes(1)
  } finally { await act(async () => { tree!.unmount() }); timing.mockRestore() }
})

test('uses native drivers and stops an in-flight row animation when the app hides', async () => {
  AppState.currentState = 'active'
  let stateChanged: (state: AppStateStatus) => void = () => undefined
  const remove = jest.fn()
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateChanged = listener
    return { remove }
  })
  const stop = jest.fn()
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop, reset: jest.fn() }))
  function Harness() {
    return createElement(TaskArrival, { index: 0, active: useTaskMotionActive(true), reducedMotion: false,
      children: createElement(Text, { accessibilityLabel: 'Complete literal task' }, 'Complete literal task') })
  }
  let tree: ReactTestRenderer
  await act(async () => { tree = create(createElement(Harness)) })
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true, duration: 260 }))
  expect(tree!.root.findAll((item) => item.props.children === 'Complete literal task').length).toBeGreaterThan(0)
  const calls = timing.mock.calls.length
  await act(async () => { stateChanged('background') })
  expect(stop).toHaveBeenCalled()
  expect(timing).toHaveBeenCalledTimes(calls)
  await act(async () => { tree!.unmount() })
  expect(remove).toHaveBeenCalledTimes(1)
  timing.mockRestore()
  subscription.mockRestore()
})

test('does not animate checked state under Reduce Motion and preserves the full checkbox state immediately', async () => {
  const timing = jest.spyOn(Animated, 'timing')
  let tree: ReactTestRenderer
  await act(async () => { tree = create(createElement(TaskCheck, { checked: false, active: true, reducedMotion: true, style: {} })) })
  await act(async () => { tree!.update(createElement(TaskCheck, { checked: true, active: true, reducedMotion: true, style: {} })) })
  expect(timing).not.toHaveBeenCalled()
  await act(async () => { tree!.unmount() })
  timing.mockRestore()
})

test('does not replay old completion feedback when returning from a hidden app', async () => {
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }))
  let tree: ReactTestRenderer
  const checkbox = (active: boolean) => createElement(TaskCheck, { checked: true, active, reducedMotion: false, feedback: true, style: {} })
  await act(async () => { tree = create(checkbox(true)) })
  expect(timing).toHaveBeenCalled()
  const calls = timing.mock.calls.length
  await act(async () => { tree!.update(checkbox(false)) })
  await act(async () => { tree!.update(checkbox(true)) })
  expect(timing).toHaveBeenCalledTimes(calls)
  await act(async () => { tree!.unmount() })
  timing.mockRestore()
})

const mountScreen = async () => {
  let listener: (state: AppStateStatus) => void = () => undefined
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listener = callback
    return { remove: jest.fn() }
  })
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }))
  let tree: ReactTestRenderer
  await act(async () => { tree = create(createElement(TasksScreen)) })
  const press = () => tree!.root.findAll((item) => item.props.accessibilityRole === 'checkbox' && typeof item.props.onPress === 'function')[0].props.onPress()
  return { tree: tree!, press, listener: (state: AppStateStatus) => listener(state),
    feedbackCount: () => timing.mock.calls.filter(([, options]) => options.duration === 110).length,
    dispose: async () => { await act(async () => { tree!.unmount() }); timing.mockRestore(); subscription.mockRestore() },
  }
}

test.each(['background', 'focus'] as const)('screen consumes old completion feedback before hidden %s rows remount', async (hidden) => {
  const screen = await mountScreen()
  try {
    await act(async () => { screen.press() })
    expect(mockTaskState.tasks[0].done).toBe(true)
    expect(screen.feedbackCount()).toBe(1)
    mockRowsVisible = false
    await act(async () => {
      if (hidden === 'background') screen.listener('background')
      else mockScreenFocused = false
      screen.tree.update(createElement(TasksScreen))
    })
    mockRowsVisible = true
    await act(async () => {
      if (hidden === 'background') screen.listener('active')
      else mockScreenFocused = true
      screen.tree.update(createElement(TasksScreen))
    })
    expect(screen.feedbackCount()).toBe(1)
  } finally { await screen.dispose() }
})

test.each([false, true])('deferred toggle cannot publish stale feedback across hiding even when returned=%s', async (returned) => {
  let complete: () => void = () => undefined
  const deferred = new Promise<void>((resolve) => { complete = resolve })
  mockTaskState.toggle.mockImplementationOnce(async (id) => {
    await deferred
    mockTaskState.tasks = mockTaskState.tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task)
  })
  const screen = await mountScreen()
  try {
    await act(async () => { screen.press() })
    expect(mockTaskState.tasks[0].done).toBe(false)
    mockRowsVisible = false
    await act(async () => { screen.listener('background'); screen.tree.update(createElement(TasksScreen)) })
    if (returned) await act(async () => { screen.listener('active'); screen.tree.update(createElement(TasksScreen)) })
    await act(async () => { complete(); await deferred })
    expect(mockTaskState.tasks[0].done).toBe(true)
    mockRowsVisible = true
    await act(async () => { screen.listener('active'); screen.tree.update(createElement(TasksScreen)) })
    expect(screen.feedbackCount()).toBe(0)
    expect(mockTaskState.toggle).toHaveBeenCalledTimes(1)
  } finally { await screen.dispose() }
})

test('completed native feedback is consumed before an active virtualized cell remounts', async () => {
  const completions: Array<((result: { finished: boolean }) => void) | undefined> = []
  const parallel = jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
    start: jest.fn((callback) => { completions.push(callback) }), stop: jest.fn(), reset: jest.fn(),
  }))
  const screen = await mountScreen()
  try {
    await act(async () => { screen.press() })
    expect(mockTaskState.tasks[0].done).toBe(true)
    expect(screen.feedbackCount()).toBe(1)
    await act(async () => { for (const complete of completions) complete?.({ finished: true }) })
    mockRowsVisible = false
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    mockRowsVisible = true
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    expect(screen.feedbackCount()).toBe(1)
  } finally { await screen.dispose(); parallel.mockRestore() }
})

test('global task text ignores initial hydration and rerenders and reveals only four confirmed new IDs once', async () => {
  const screen = await mountScreen()
  try {
    const reveals = () => screen.tree.root.findAllByType(RevealText).filter((node) => node.props.animate === true)
    expect(reveals()).toHaveLength(0)
    const hydrated: Task = { id: 'hydrated-old', noteId: 'source-note', text: 'Old persisted source task', done: false, createdAt: 0 }
    mockTaskState.tasks = [...mockTaskState.tasks, hydrated]
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    expect(reveals()).toHaveLength(0)
    const created = Array.from({ length: 6 }, (_, index): Task => ({ id: `confirmed-${index}`, noteId: 'source-note', text: `Send complete report ${index}`, done: false, createdAt: 2 }))
    mockTaskState.tasks = [...created, ...mockTaskState.tasks]
    await act(async () => { publishPersistedTaskText(created.map((task) => task.id)); screen.tree.update(createElement(TasksScreen)) })
    expect(reveals().map((node) => node.props.text)).toEqual(created.slice(0, 4).map((task) => task.text))
    mockRowsVisible = false
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    mockRowsVisible = true
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    expect(reveals()).toHaveLength(0)
  } finally { await screen.dispose() }
})

test('global confirmed-save notifications received hidden or under Reduce Motion never replay on return', async () => {
  const screen = await mountScreen()
  try {
    await act(async () => { screen.listener('background') })
    mockTaskState.tasks = [...mockTaskState.tasks, { id: 'hidden-confirmed', noteId: 'source-note', text: 'Task saved while hidden', done: false, createdAt: 2 }]
    await act(async () => { publishPersistedTaskText(['hidden-confirmed']); screen.tree.update(createElement(TasksScreen)) })
    await act(async () => { screen.listener('active') })
    expect(screen.tree.root.findAllByType(RevealText).filter((node) => node.props.animate)).toHaveLength(0)
    mockReducedMotion = true
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    await act(async () => { publishPersistedTaskText(['hidden-confirmed']) })
    mockReducedMotion = false
    await act(async () => { screen.tree.update(createElement(TasksScreen)) })
    expect(screen.tree.root.findAllByType(RevealText).filter((node) => node.props.animate)).toHaveLength(0)
  } finally { await screen.dispose() }
})

test('a captured reveal crossing a source revision is rejected and the complete literal text stays visible', async () => {
  let reveal: (ids: readonly string[]) => boolean = () => false
  let captured: () => (ids: readonly string[]) => boolean = () => () => false
  function Harness({ scope }: { scope: string }) {
    const state = useTaskTextReveal(true, false, scope)
    captured = state.prepare
    return createElement(TaskText, { text: 'Preserve the complete literal task', reveal: state.ids.has('saved-id'), active: true, reducedMotion: false,
      onRevealConsumed: () => state.consume('saved-id') })
  }
  let tree: ReactTestRenderer
  await act(async () => { tree = create(createElement(Harness, { scope: 'source-before' })) })
  reveal = captured()
  await act(async () => { tree!.update(createElement(Harness, { scope: 'source-after' })) })
  await act(async () => { expect(reveal(['saved-id'])).toBe(false) })
  expect(tree!.root.findByType(RevealText).props).toMatchObject({ text: 'Preserve the complete literal task', animate: false })
  await act(async () => { tree!.unmount() })
})
