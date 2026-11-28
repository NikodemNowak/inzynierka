import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Text } from 'react-native'

jest.mock('../state/settingsStore', () => ({ useSettingsStore: () => 'light' }))

const { Group, Row, Separator } = require('./Grouped') as typeof import('./Grouped')

let tree: ReactTestRenderer
const render = async (element: ReturnType<typeof createElement>) => {
  await act(async () => { tree = create(element) })
}
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('a group of three rows renders exactly two separators', async () => {
  await render(createElement(Group, null,
    createElement(Row, { title: 'A' }),
    createElement(Row, { title: 'B' }),
    createElement(Row, { title: 'C' })))
  expect(tree.root.findAllByType(Separator)).toHaveLength(2)
})

test('falsy children produce no extra separators', async () => {
  await render(createElement(Group, null,
    createElement(Row, { title: 'A' }),
    null,
    false,
    createElement(Row, { title: 'B' }),
    undefined))
  expect(tree.root.findAllByType(Separator)).toHaveLength(1)
})

test('a row passes numberOfLines to its title text', async () => {
  await render(createElement(Row, { title: 'Tytuł', numberOfLines: 1 }))
  const title = tree.root.findAllByType(Text).find((node) => node.props.children === 'Tytuł')
  expect(title?.props.numberOfLines).toBe(1)
})

test('a row with a 120 character title is limited by numberOfLines', async () => {
  await render(createElement(Row, { title: 'x'.repeat(120) }))
  const title = tree.root.findAllByType(Text).find((node) => node.props.children === 'x'.repeat(120))
  expect(title?.props.numberOfLines).toBeGreaterThan(0)
})
