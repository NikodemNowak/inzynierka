import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { AccessibilityInfo, Text } from 'react-native'
import { fadedTextColor, useReducedMotion } from './Motion'

test('fadedTextColor clamps opacity and falls back for non-hex colors', () => {
  expect(fadedTextColor('#102030', 0.5)).toBe('rgba(16, 32, 48, 0.5)')
  expect(fadedTextColor('#102030', 4)).toBe('rgba(16, 32, 48, 1)')
  expect(fadedTextColor('red', -1)).toBe('rgba(73, 87, 106, 0)')
})

test('useReducedMotion follows the system preference and its change event', async () => {
  let notify: (value: boolean) => void = () => undefined
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, listener: (value: boolean) => void) => {
    notify = listener
    return { remove: jest.fn() }
  }) as unknown as typeof AccessibilityInfo.addEventListener)
  const Probe = () => createElement(Text, null, String(useReducedMotion()))
  let tree!: ReturnType<typeof create>
  await act(async () => { tree = create(createElement(Probe)) })
  expect(tree.root.findByType(Text).props.children).toBe('false')
  await act(async () => { notify(true) })
  expect(tree.root.findByType(Text).props.children).toBe('true')
  jest.restoreAllMocks()
})
