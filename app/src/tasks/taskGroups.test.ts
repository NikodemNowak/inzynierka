import { groupTasksByDue } from './taskGroups'

// Thursday 2 October 2026, noon.
const now = new Date(2026, 9, 2, 12)
const created = new Map([['n', new Date(2026, 9, 1, 9).getTime()], ['old', new Date(2026, 8, 20, 9).getTime()]])
const task = (text: string) => ({ text, noteId: 'n' })

test('sorts tasks into today, this week, later, overdue and undated', () => {
  const groups = groupTasksByDue([
    task('Oddać hulajnogę — jutro'),
    task('Sprawdzić literaturę'),
    { text: 'Zapłacić — jutro', noteId: 'old' },
    task('Festiwal — 30 października'),
  ], created, now)
  expect(groups.get('today')!.map((item) => item.task.text)).toEqual(['Oddać hulajnogę — jutro'])
  expect(groups.get('overdue')!.map((item) => item.task.text)).toEqual(['Zapłacić — jutro'])
  expect(groups.get('undated')!.map((item) => item.task.text)).toEqual(['Sprawdzić literaturę'])
  expect(groups.get('later')!.map((item) => item.task.text)).toEqual(['Festiwal — 30 października'])
})

test('a task whose note is unknown stays undated', () => {
  const groups = groupTasksByDue([{ text: 'Coś — jutro', noteId: 'x' }], created, now)
  expect(groups.get('undated')).toHaveLength(1)
})
