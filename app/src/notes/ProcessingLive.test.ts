import type { LiveSummaryProgress } from '../ai/noteProcessing'

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }))
jest.mock('../ui/theme', () => ({ radius: {}, spacing: {}, type: {}, useTheme: () => ({ colors: {}, isDark: false }) }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))

const { lastCitedIndex, liveTrailFraction, liveTranscriptSegments } = require('./ProcessingLive') as typeof import('./ProcessingLive')

const content = 'Hulajnoga w czwartek. Projekt w piątek. Zakupy bez masła. Siatkówka przeniesiona.'
const units = [
  { id: 1, start: 0, end: 21 },
  { id: 2, start: 22, end: 39 },
  { id: 3, start: 40, end: 57 },
  { id: 4, start: 58, end: 81 },
]
const live = (sourceIds: number[][]): LiveSummaryProgress => ({
  units,
  drafts: sourceIds.map((ids, index) => ({ text: `punkt ${index}`, sourceIds: ids })),
})

test('the trail ends at the furthest cited sentence, not the count of points', () => {
  expect(liveTrailFraction(live([]))).toBe(0)
  expect(lastCitedIndex(live([[2]]))).toBe(1)
  expect(liveTrailFraction(live([[1], [3]]))).toBe(0.75)
})

test('cited sentences are marked and the next two are lit', () => {
  const segments = liveTranscriptSegments(content, live([[1]]))
  expect(segments.map((segment) => segment.kind)).toEqual(['cited', 'plain', 'next', 'plain', 'next', 'plain', 'plain'])
  expect(segments.map((segment) => segment.text).join('')).toBe(content)
})

test('before the first point the opening sentences are lit', () => {
  const segments = liveTranscriptSegments(content, live([]))
  expect(segments.filter((segment) => segment.kind === 'next').map((segment) => segment.text))
    .toEqual(['Hulajnoga w czwartek.', 'Projekt w piątek.'])
})

test('spans that do not fit the text leave it unmarked', () => {
  const stale: LiveSummaryProgress = { units: [{ id: 1, start: 0, end: 500 }], drafts: [{ text: 'x', sourceIds: [1] }] }
  expect(liveTranscriptSegments(content, stale)).toEqual([{ text: content, kind: 'plain' }])
})
