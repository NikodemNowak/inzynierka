import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { AccessibilityInfo, Text } from 'react-native'
import { useReducedMotion } from './Motion'

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
