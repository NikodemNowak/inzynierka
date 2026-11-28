jest.mock('../../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl, language: 'pl' }) }))
jest.mock('../../state/settingsStore', () => ({ useSettingsStore: () => 'light' }))

import { formatNoteMeta } from './NoteMeta'

const at = new Date(2026, 10, 4, 13, 10).getTime()

test('shows the date, the time and the first category as text', () => {
  expect(formatNoteMeta(at, ['Praca', 'Nauka'], 'pl')).toBe('4 listopada, 13:10 · Praca')
})

test('leaves out the category when the note has none', () => {
  expect(formatNoteMeta(at, [], 'pl')).toBe('4 listopada, 13:10')
})

test('uses English month names', () => {
  expect(formatNoteMeta(at, ['Praca'], 'en')).toBe('November 4, 1:10 PM · Work')
})
