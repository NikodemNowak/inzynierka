import type { LiveSummaryProgress } from '../ai/noteProcessing'

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }))
jest.mock('../ui/theme', () => ({ type: {}, useTheme: () => ({ colors: {}, isDark: false }) }))
jest.mock('../ui/Icon', () => ({ Icon: () => null }))
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))

const { lastCitedIndex, liveStages, liveTrailFraction } = require('./ProcessingLive') as typeof import('./ProcessingLive')

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

test('stages move from summary to title and mark the recording text done', () => {
  const states = (phase: Parameters<typeof liveStages>[0]) => liveStages(phase).map((stage) => stage.state)
  expect(states('queued')).toEqual(['done', 'active', 'waiting', 'waiting'])
  expect(states('summary')).toEqual(['done', 'active', 'waiting', 'waiting'])
  expect(states('title')).toEqual(['done', 'done', 'done', 'active'])
})
