import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Animated, AppState, LayoutAnimation, Text, type AppStateStatus } from 'react-native'
import { LayoutEntry, useLayoutTransition } from './LayoutMotion'
import { usePlaceholderExit } from '../tasks/TaskMotion'

test('makes room for the category before starting its native entrance', async () => {
  AppState.currentState = 'active'
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }))
  function Screen({ category }: { category: string }) {
    const shown = useLayoutTransition(category, category, 'note', true, false)
    return createElement(LayoutEntry, { eventKey: shown, visible: Boolean(shown), active: true, reducedMotion: false,
      children: createElement(Text, {}, shown) })
  }
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(Screen, { category: '' })) })
    await act(async () => { tree!.update(createElement(Screen, { category: 'Praca' })) })
    expect(configure).toHaveBeenCalledTimes(1)
    expect(timing).toHaveBeenCalledTimes(1)
    expect(timing.mock.calls[0][1].delay).toBeGreaterThanOrEqual(configure.mock.calls[0][0].duration)
    expect(timing.mock.calls[0][1]).toMatchObject({ useNativeDriver: true, isInteraction: false })
  } finally { await act(async () => { tree!.unmount() }); configure.mockRestore(); timing.mockRestore() }
})

test('schedules native layout before publishing a changed display value and never replays an identical render', async () => {
  AppState.currentState = 'active'
  const events: string[] = []
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => { events.push('layout') })
  function Screen({ value, scope = 'a', reduced = false }: { value: string; scope?: string; reduced?: boolean }) {
    const shown = useLayoutTransition(value, value, scope, true, reduced)
    useLayoutEffect(() => { events.push(shown) }, [shown])
    return createElement(Text, {}, shown)
  }
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(Screen, { value: 'old' })) })
    events.length = 0
    await act(async () => { tree!.update(createElement(Screen, { value: 'new' })) })
    expect(events).toEqual(['layout', 'new'])
    configure.mockClear()
    await act(async () => { tree!.update(createElement(Screen, { value: 'new' })) })
    expect(configure).not.toHaveBeenCalled()
    await act(async () => { tree!.update(createElement(Screen, { value: 'other note', scope: 'b' })) })
    expect(tree!.root.findByType(Text).props.children).toBe('other note')
    expect(configure).not.toHaveBeenCalled()
    await act(async () => { tree!.update(createElement(Screen, { value: 'reduced result', scope: 'b', reduced: true })) })
    expect(tree!.root.findByType(Text).props.children).toBe('reduced result')
    expect(configure).not.toHaveBeenCalled()
  } finally { await act(async () => { tree!.unmount() }); configure.mockRestore() }
})

test.each([0, 1, 2, 3])('collapses only the surplus of three placeholders for an actual %s-task result', async count => {
  jest.useFakeTimers()
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  function Tail({ loading, scope = 'a', active = true }: { loading: boolean; scope?: string; active?: boolean }) {
    return createElement(Text, {}, usePlaceholderExit(loading, count, scope, active, false).join(','))
  }
  let tree: ReactTestRenderer
  try {
    await act(async () => { tree = create(createElement(Tail, { loading: true })) })
    await act(async () => { tree!.update(createElement(Tail, { loading: false })) })
    const expected = [['0,1,2', '0,1', '0', ''], ['1,2', '1', '', ''], ['2', '', '', ''], ['', '', '', '']][count]
    expect(tree!.root.findByType(Text).props.children).toBe(expected[0])
    await act(async () => { jest.advanceTimersByTime(279 + count * 100) })
    expect(tree!.root.findByType(Text).props.children).toBe(expected[0])
    for (let index = 1; index <= 3; index++) {
      await act(async () => { jest.advanceTimersByTime(index === 1 ? 1 : 400) })
      expect(tree!.root.findByType(Text).props.children).toBe(expected[index])
    }
    expect(configure).toHaveBeenCalledTimes(3 - count)
  } finally { await act(async () => { tree!.unmount() }); configure.mockRestore(); jest.useRealTimers() }
})

test('a hidden or replaced note cancels old placeholder callbacks instead of animating the current screen', async () => {
  jest.useFakeTimers()
  const configure = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined)
  const listeners = new Set<(state: AppStateStatus) => void>()
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener); return { remove: () => { listeners.delete(listener) } }
  })
  function Screen({ loading, scope, active }: { loading: boolean; scope: string; active: boolean }) {
    const value = useLayoutTransition('value', scope, scope, active, false)
    return createElement(Text, {}, value + ':' + usePlaceholderExit(loading, 0, scope, active, false).join(','))
  }
  let tree: ReactTestRenderer
  try {
    AppState.currentState = 'active'
    await act(async () => { tree = create(createElement(Screen, { loading: true, scope: 'a', active: true })) })
    await act(async () => { tree!.update(createElement(Screen, { loading: false, scope: 'a', active: true })) })
    expect(tree!.root.findByType(Text).props.children).toBe('value:0,1,2')
    await act(async () => { tree!.update(createElement(Screen, { loading: false, scope: 'b', active: false })) })
    await act(async () => { jest.advanceTimersByTime(1000) })
    expect(configure).not.toHaveBeenCalled()
    expect(tree!.root.findByType(Text).props.children).toBe('value:')
  } finally { await act(async () => { tree!.unmount() }); subscription.mockRestore(); configure.mockRestore(); jest.useRealTimers() }
})
