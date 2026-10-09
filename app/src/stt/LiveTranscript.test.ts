import { createElement } from 'react'
import { Text } from 'react-native'
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer'
import { LiveTranscript } from './LiveTranscript'

let mockReducedMotion = false
jest.mock('../ui/Motion', () => ({
  ...jest.requireActual<typeof import('../ui/Motion')>('../ui/Motion'),
  useReducedMotion: () => mockReducedMotion,
}))
jest.mock('../ui/theme', () => {
  const theme = jest.requireActual<typeof import('../ui/theme')>('../ui/theme')
  return { ...theme, useTheme: () => ({ colors: theme.colors }) }
})

let tree: ReactTestRenderer
const jsonText = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string => {
  if (typeof node === 'string') return node
  if (!node) return ''
  if (Array.isArray(node)) return node.map(jsonText).join('')
  return (node.children ?? []).map(jsonText).join('')
}
const displayedText = () => jsonText(tree.toJSON())
beforeEach(() => { mockReducedMotion = false })
afterEach(async () => { await act(async () => tree.unmount()) })

test('keeps a long literal transcript complete while bounding the animated native text tail', async () => {
  const text = `${'Zażółć gęślą jaźń 😀. '.repeat(150)}Ostatnie słowa.`
  await act(async () => { tree = create(createElement(LiveTranscript, { text })) })
  expect(tree.root.findByProps({ accessible: true }).props.accessibilityLabel).toBe(text)
  expect(displayedText()).toBe(text)
  expect(tree.root.findAllByType(Text).length).toBeLessThanOrEqual(35)
})

test('a revised and shortened live hypothesis replaces the displayed suffix literally', async () => {
  await act(async () => { tree = create(createElement(LiveTranscript, { text: 'Jutro sprawdzę błędny bardzo długi opis.' })) })
  await act(async () => { tree.update(createElement(LiveTranscript, { text: 'Jutro sprawdzę raport.' })) })
  expect(displayedText()).toBe('Jutro sprawdzę raport.')
  expect(tree.root.findByProps({ accessible: true }).props.accessibilityLabel).toBe('Jutro sprawdzę raport.')
})

test('reduced motion makes the current speech fully readable immediately', async () => {
  mockReducedMotion = true
  await act(async () => { tree = create(createElement(LiveTranscript, { text: 'Źródłowa hipoteza 😀.' })) })
  expect(displayedText()).toBe('Źródłowa hipoteza 😀.')
  expect(tree.root.findAllByType(Text).length).toBeLessThanOrEqual(2)
})
