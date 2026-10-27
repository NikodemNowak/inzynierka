import { createElement, useLayoutEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Animated, AppState, LayoutAnimation, Text } from 'react-native'
import { LayoutEntry, useLayoutTransition } from './LayoutMotion'

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
