import { NOTE_CATEGORIES, categoryLabel, isCategory } from './categories'

it('keeps the original eight ids first and adds seven new stable ids', () => {
  expect(NOTE_CATEGORIES).toHaveLength(15)
  expect(new Set(NOTE_CATEGORIES).size).toBe(15)
  expect(NOTE_CATEGORIES.slice(0, 8)).toEqual(['Praca', 'Dom', 'Finanse', 'Zdrowie', 'Zakupy', 'Nauka', 'Podróże', 'Pomysły'])
  expect(NOTE_CATEGORIES.slice(8)).toEqual(['Rodzina', 'Znajomi', 'Wydarzenia', 'Urzędy', 'Dziennik', 'Planowanie', 'Hobby'])
})

it('labels every category in both languages and tolerates unknown ids', () => {
  for (const category of NOTE_CATEGORIES) {
    expect(isCategory(category)).toBe(true)
    expect(categoryLabel(category, 'pl')).toBe(category)
    expect(categoryLabel(category, 'en')).toMatch(/^[A-Z][a-z]+$/u)
  }
  expect(categoryLabel('Hobby', 'en')).toBe('Hobbies')
  expect(isCategory('Kino')).toBe(false)
  expect(categoryLabel('Kino', 'en')).toBe('Kino')
})
