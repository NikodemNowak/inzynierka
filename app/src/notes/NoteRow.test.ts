import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Text } from 'react-native'
import type { Note } from '../domain/note'
import type { LiveSummaryProgress, ProcessingProgress } from '../ai/noteProcessing'

const mockState = {
  processing: {} as Record<string, ProcessingProgress>,
  proposals: {} as Record<string, object>,
}
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }))
jest.mock('../state/notesStore', () => ({
  useNotesStore: (select: (state: typeof mockState) => unknown) => select(mockState),
}))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl', locale: 'pl-PL' }) }))
jest.mock('../ui/Motion', () => ({ useReducedMotion: () => true }))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))

const { NoteRow } = require('./NoteRow') as typeof import('./NoteRow')

const note: Note = {
  id: 'row-note', title: 'Tytuł', content: 'Treść.', summary: 'Streszczenie.', tags: [], audioUri: null,
  durationMs: null, createdAt: 1, updatedAt: 1, language: 'pl',
}
let tree: ReactTestRenderer
const render = async () => {
  await act(async () => { tree = create(createElement(NoteRow, { note, timestamp: 0, onPress: () => undefined })) })
}
const texts = (): string[] => tree.root.findAllByType(Text).map((node) => node.props.children).filter((child): child is string => typeof child === 'string')

beforeEach(() => { mockState.processing = {}; mockState.proposals = {} })
afterEach(async () => { await act(async () => { tree.unmount() }) })

test('shows a marker chip only when a new version is pending', async () => {
  await render()
  expect(texts()).not.toContain('Nowa wersja')
  await act(async () => { tree.unmount() })
  mockState.proposals = { [note.id]: {} }
  await render()
  expect(texts()).toContain('Nowa wersja')
})

test('keeps the progress track mounted while processing, with or without live progress', async () => {
  mockState.processing = { [note.id]: { phase: 'loading' } }
  await render()
  expect(texts()).toContain('Wczytuję model')
  const live: LiveSummaryProgress = { units: [{ id: 1, start: 0, end: 6 }], drafts: [{ text: 'punkt', sourceIds: [1] }] }
  mockState.processing = { [note.id]: { phase: 'summary', live } }
  await act(async () => { tree.update(createElement(NoteRow, { note, timestamp: 0, onPress: () => undefined })) })
  expect(texts()).toContain('Zakreślam')
})

test('shows the summary preview once processing ends', async () => {
  await render()
  expect(texts()).toContain('Streszczenie.')
})
