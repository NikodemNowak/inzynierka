import { processingPresentation } from './processingPresentation'

const pl = (value: string): string => value
const en = (_: string, value: string): string => value

test('warm processing cannot keep the model-loading presentation', () => {
  expect(processingPresentation({ phase: 'loading', percent: 1 }, pl).stage).toBe('loading')
  expect(processingPresentation({ phase: 'processing' }, pl)).toEqual({ label: 'Opracowuję tekst…', stage: 'processing' })
  expect(processingPresentation({ phase: 'processing', detail: 'structure' }, en)).toEqual({ label: 'Structuring speech…', stage: 'processing' })
  expect(processingPresentation({ phase: 'summary' }, pl).label).toBe('Tworzę podsumowanie…')
})

test.each([
  [undefined, 4], [2, undefined], [2, 0], [-1, 4], [5, 4], [0.5, 4], [NaN, 4], [2, Infinity],
])('does not show incomplete or invalid progress counts (%s/%s)', (completed, total) => {
  expect(processingPresentation({ phase: 'fragment', completed, total }, pl).label).toBe('Analizuję fragmenty…')
})

test('shows actual completed work without a time estimate', () => {
  expect(processingPresentation({ phase: 'fragment', completed: 0, total: 4 }, pl).label).toBe('Analizuję fragmenty · 0/4')
  expect(processingPresentation({ phase: 'reduction', completed: 3, total: 4 }, en).label).toBe('Combining information · 3/4')
})
