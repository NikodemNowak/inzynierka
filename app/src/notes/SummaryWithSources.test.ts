import { createElement, Profiler } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { SummaryDocument } from '../domain/summary'
import { BottomSheet } from '../ui/BottomSheet'
import { IconButton } from '../ui/Icon'
import { SummaryWithSources, type SummaryWithSourcesProps } from './SummaryWithSources'

let mockLanguage = 'pl'
let mockAppearance = 'light'
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({
  t: (pl: string, en: string) => mockLanguage === 'pl' ? pl : en, language: mockLanguage,
}) }))
jest.mock('../state/settingsStore', () => ({ useSettingsStore: () => mockAppearance }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('../ui/Motion', () => ({ useReducedMotion: () => true }))

const content = '🙂 Brak zajęć. Brak zajęć.'
const document: SummaryDocument = { version: 1, source: content, format: 'bullets', points: [
  { text: 'Brak zajęć.', sources: [{ start: 0, end: 14 }, { start: 15, end: 26 }] },
] }
const props: SummaryWithSourcesProps = {
  noteId: 'one', revision: 1, content, summary: '• Brak zajęć.', document, active: true,
}
let tree: ReactTestRenderer | undefined
const root = () => tree!.root
const actions = () => root().findAll(node => node.props.accessibilityRole === 'button'
  && (node.type === Text || typeof node.type === 'function')
  && typeof node.props.accessibilityLabel === 'string'
  && /^(Pokaż źródło|Show source): /.test(node.props.accessibilityLabel)
  && typeof node.props.onPress === 'function')
const quotes = () => root().findAllByType(Text).filter(node => node.props.testID === 'summary-source-quote')
const press = async (action: ReactTestInstance = actions()[0]) => {
  expect(action).toBeDefined()
  await act(async () => { action.props.onPress() })
}
const render = async (value = props) => {
  await act(async () => { tree = create(createElement(SummaryWithSources, value)) })
}
beforeEach(() => { mockLanguage = 'pl'; mockAppearance = 'light' })
afterEach(async () => { if (tree) await act(async () => { tree!.unmount() }); tree = undefined })

test('opens the real sheet and displays exact repeated UTF-16 quotes in source order', async () => {
  await render()
  expect(actions()[0].props.accessibilityLabel).toBe('Pokaż źródło: Brak zajęć.')
  expect(actions()[0].props.accessibilityHint).toContain('transkrypcji')
  await press()
  expect(root().findByType(BottomSheet).props.visible).toBe(true)
  expect(root().findByType(Modal).props.visible).toBe(true)
  expect(root().findAllByType(ScrollView)).toHaveLength(1)
  expect(quotes().map(node => node.props.children)).toEqual(['🙂 Brak zajęć.', 'Brak zajęć.'])
  expect(root().findByType(BottomSheet).props.title).toBe('Fragment transkrypcji')
})

test.each(['back', 'backdrop', 'close'] as const)('dismisses through the real %s control', async method => {
  await render(); await press()
  await act(async () => {
    if (method === 'back') root().findByType(Modal).props.onRequestClose()
    else if (method === 'close') root().findByType(IconButton).props.onPress()
    else root().findAll(node => node.props.accessibilityLabel === 'Zamknij panel' && typeof node.props.onPress === 'function')[0].props.onPress()
  })
  expect(root().findByType(BottomSheet).props.visible).toBe(false)
  expect(quotes()).toHaveLength(0)
})

test.each([
  ['revision', { revision: 2 }],
  ['route', { noteId: 'two' }],
  ['content', { content: `${content} ` }],
  ['document identity', { document: { ...document } }],
  ['summary', { summary: 'Inny wynik.' }],
  ['focus', { active: false }],
] as const)('hides stale quotes in the first commit after %s changes and never reopens them', async (_, change) => {
  await render(); await press()
  const frames: { visible: boolean; quotes: number }[] = []
  const onRender = () => frames.push({ visible: root().findByType(BottomSheet).props.visible, quotes: quotes().length })
  // Keep the same component instance while recording every update commit.
  await act(async () => { tree!.update(createElement(Profiler, { id: 'sources', onRender }, createElement(SummaryWithSources, props))) })
  await press()
  frames.length = 0
  await act(async () => { tree!.update(createElement(Profiler, { id: 'sources', onRender },
    createElement(SummaryWithSources, { ...props, ...change }))) })
  expect(frames.length).toBeGreaterThan(0)
  expect(frames.every(frame => !frame.visible && frame.quotes === 0)).toBe(true)
  await act(async () => { tree!.update(createElement(Profiler, { id: 'sources', onRender }, createElement(SummaryWithSources, props))) })
  expect(root().findByType(BottomSheet).props.visible).toBe(false)
})

test.each([
  ['legacy', undefined], ['cleared', null],
  ['reversed persisted ranges', { ...document, points: [{ ...document.points[0], sources: [{ start: 15, end: 26 }, { start: 0, end: 14 }] }] }],
  ['wrong source', { ...document, source: 'Inne źródło' }],
  ['split emoji', { ...document, points: [{ ...document.points[0], sources: [{ start: 1, end: 14 }] }] }],
] as const)('keeps %s documents ordinary and without source actions', async (_, value) => {
  await render({ ...props, document: value })
  expect(actions()).toHaveLength(0)
  expect(root().findAllByType(Text).some(node => node.props.children === props.summary)).toBe(true)
  expect(root().findByType(BottomSheet).props.visible).toBe(false)
})

test('uses full minimum44 bullet rows with scalable incumbent text metrics and one visible point', async () => {
  await render()
  const action = actions()[0]
  expect(action.type).not.toBe(Text)
  const style = typeof action.props.style === 'function' ? action.props.style({ pressed: false }) : action.props.style
  expect(StyleSheet.flatten(style)).toMatchObject({ minHeight: 44 })
  expect(StyleSheet.flatten(style).height).toBeUndefined()
  const text = action.findAllByType(Text)
  expect(text.map(node => node.props.children).flat().join('')).toBe('• Brak zajęć.')
  expect(StyleSheet.flatten(text[0].props.style)).toMatchObject({ fontSize: 15, lineHeight: 23 })
  expect(text.every(node => node.props.allowFontScaling !== false && node.props.numberOfLines === undefined)).toBe(true)
})

test('keeps grouped headings accessible and attaches each full row to its own local quote', async () => {
  const grouped: SummaryDocument = { ...document, format: 'grouped', points: [
    { text: 'Pierwsza informacja.', group: 'Plan', sources: [{ start: 0, end: 14 }] },
    { text: 'Druga informacja.', group: 'Terminy', sources: [{ start: 15, end: 26 }] },
    { text: 'Trzecia informacja.', group: 'Plan', sources: [{ start: 15, end: 26 }] },
  ] }
  await render({ ...props, document: grouped, summary: 'Plan\n• Pierwsza informacja.\n• Trzecia informacja.\n\nTerminy\n• Druga informacja.' })
  expect(root().findAllByType(Text).filter(node => node.props.accessibilityRole === 'header').map(node => node.props.children)).toEqual(['Plan', 'Terminy'])
  expect(root().findAllByType(Text).filter(node => node.props.accessibilityRole === 'header')
    .every(node => {
      const style = StyleSheet.flatten(node.props.style)
      return style.fontSize === 15 && style.lineHeight === 23 && style.fontFamily === 'Onest_400Regular'
    })).toBe(true)
  expect(actions().map(node => node.props.accessibilityLabel)).toEqual([
    'Pokaż źródło: Pierwsza informacja.', 'Pokaż źródło: Trzecia informacja.', 'Pokaż źródło: Druga informacja.',
  ])
  await press(actions()[1])
  expect(quotes().map(node => node.props.children)).toEqual(['Brak zajęć.'])
})

test('keeps narrative points as selectable inline Text spans inside one minimum44 container', async () => {
  const paragraph: SummaryDocument = { ...document, format: 'paragraph', points: [
    { text: 'Pierwsza refleksja.', sources: [{ start: 0, end: 14 }] },
    { text: 'Druga refleksja.', sources: [{ start: 15, end: 26 }] },
  ] }
  await render({ ...props, document: paragraph, summary: 'Pierwsza refleksja. Druga refleksja.' })
  expect(actions()).toHaveLength(2)
  const textParent = (node: ReactTestInstance): ReactTestInstance | null => {
    let parent = node.parent
    while (parent && parent.type !== Text) parent = parent.parent
    return parent
  }
  expect(actions().every(node => node.type === Text && textParent(node) !== null)).toBe(true)
  const parent = textParent(actions()[0])!
  expect(parent).toBe(textParent(actions()[1]))
  const textContent = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('')
  expect(textContent(parent)).toBe('Pierwsza refleksja. Druga refleksja.')
  const containers = root().findAllByType(View).filter(node => StyleSheet.flatten(node.props.style)?.minHeight === 44)
  expect(containers).toHaveLength(1)
  expect(containers[0].findAllByType(Text)).toContain(parent)
  expect(actions().every(node => StyleSheet.flatten(node.props.style)?.minHeight === undefined && node.props.allowFontScaling !== false)).toBe(true)
  await press(actions()[1])
  expect(quotes().map(node => node.props.children)).toEqual(['Brak zajęć.'])
})

test('uses native dark tokens in the real sheet and English accessible copy', async () => {
  mockAppearance = 'dark'; mockLanguage = 'en'
  await render(); await press()
  expect(actions()[0].props.accessibilityLabel).toBe('Show source: Brak zajęć.')
  expect(actions()[0].props.accessibilityHint).toContain('transcript')
  expect(root().findByType(BottomSheet).props.title).toBe('Transcript excerpt')
  expect(StyleSheet.flatten(quotes()[0].props.style).color).toBe('#EDEBE6')
  const panel = root().findByProps({ accessibilityViewIsModal: true })
  expect(StyleSheet.flatten(panel.props.style).backgroundColor).toBe('#141416')
  expect(StyleSheet.flatten(root().findAll(node => node.props.accessibilityLabel === 'Close panel' && typeof node.props.onPress === 'function')[0].props.style).backgroundColor).toBe('rgba(0,0,0,0.6)')
})

test('has no source actions while inactive and preserves exact plain content', async () => {
  await render({ ...props, active: false })
  expect(actions()).toHaveLength(0)
  expect(root().findAllByType(Text).some(node => node.props.children === props.summary)).toBe(true)
})
