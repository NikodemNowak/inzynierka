import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Text } from 'react-native'

jest.mock('../state/settingsStore', () => ({ useSettingsStore: () => 'light' }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl', locale: 'pl-PL' }) }))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))

const { AskCard } = require('./AskCard') as typeof import('./AskCard')

let tree: ReactTestRenderer
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('renders the title and calls onPress', async () => {
  const onPress = jest.fn()
  await act(async () => { tree = create(createElement(AskCard, { onPress })) })
  const texts = tree.root.findAllByType(Text).map((node) => node.props.children)
  expect(texts).toContain('Zapytaj notatki')
  tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0].props.onPress()
  expect(onPress).toHaveBeenCalledTimes(1)
})
