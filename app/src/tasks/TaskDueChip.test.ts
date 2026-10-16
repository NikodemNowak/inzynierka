import { formatResolvedDue } from './TaskDueChip'

jest.mock('./taskExport', () => ({ offerTaskExport: jest.fn() }))

// Wednesday 14 October 2026, 10:00
const recorded = new Date(2026, 9, 14, 10, 0)

test('shows the resolved date, with time when one was said', () => {
  const withTime = formatResolvedDue('jutro 18:00', recorded, 'pl-PL')
  expect(withTime).toMatch(/15/)
  expect(withTime).toMatch(/18:00/)
  expect(formatResolvedDue('do końca miesiąca', recorded, 'pl-PL')).toMatch(/31/)
  expect(formatResolvedDue('do końca miesiąca', recorded, 'pl-PL')).not.toMatch(/·/)
})

test('keeps words it cannot place as they were said', () => {
  expect(formatResolvedDue('przed obroną', recorded, 'pl-PL')).toBe('przed obroną')
})
