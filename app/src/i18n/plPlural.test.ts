import { plPlural } from './plPlural'

const tasks = (count: number) => plPlural(count, 'zadanie', 'zadania', 'zadań')

test('Polish plural forms follow the 1 / 2-4 / other rule with the 12-14 exception', () => {
  expect(tasks(1)).toBe('zadanie')
  expect(tasks(2)).toBe('zadania')
  expect(tasks(5)).toBe('zadań')
  expect(tasks(12)).toBe('zadań')
  expect(tasks(14)).toBe('zadań')
  expect(tasks(22)).toBe('zadania')
  expect(tasks(24)).toBe('zadania')
  expect(tasks(25)).toBe('zadań')
  expect(plPlural(12, 'zmianę', 'zmiany', 'zmian')).toBe('zmian')
  expect(plPlural(22, 'zmianę', 'zmiany', 'zmian')).toBe('zmiany')
})
