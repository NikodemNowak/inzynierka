import { listExtras } from './listExtras'

const next = { id: 'task' }

test('hides both extras when there are no notes', () => {
  expect(listExtras({ noteCount: 0, nextTask: null, query: '' })).toEqual({ ask: false, nextTask: false })
  expect(listExtras({ noteCount: 0, nextTask: next, query: '' })).toEqual({ ask: false, nextTask: false })
})

test('shows the ask card, and the next task only when there is one', () => {
  expect(listExtras({ noteCount: 3, nextTask: null, query: '' })).toEqual({ ask: true, nextTask: false })
  expect(listExtras({ noteCount: 3, nextTask: next, query: '' })).toEqual({ ask: true, nextTask: true })
})

test('hides both extras while a search query is active', () => {
  expect(listExtras({ noteCount: 3, nextTask: next, query: 'budżet' })).toEqual({ ask: false, nextTask: false })
  expect(listExtras({ noteCount: 3, nextTask: next, query: '   ' })).toEqual({ ask: true, nextTask: true })
})
