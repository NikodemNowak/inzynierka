import { polishTaskTitle } from './taskLines'

const words = new Set(['oddać', 'mercy', 'ładowarki', 'sprawozdanie', 'z', 'sieci', 'komputerowych', 'spotkanie'])

test('drops the placeholder, fixes a typo and the recognizer capital, removes a repeated deadline number', () => {
  expect(polishTaskTitle({ title: 'Spotkanie z ...', due: 'wtorek 14:00' }, words).title).toBe('Spotkanie')
  expect(polishTaskTitle({ title: 'Spotkanie z [osoba]', due: 'wtorek 14:00' }, words).title).toBe('Spotkanie')
  expect(polishTaskTitle({ title: 'Odać mercy ładowarki', due: null }, words).title).toBe('Oddać mercy ładowarki')
  expect(polishTaskTitle({ title: 'Oddać sprawozdanie z sieci Komputerowych 23', due: 'piątek do 23:00' }, words).title).toBe('Oddać sprawozdanie z sieci komputerowych')
})

test('keeps names and numbers that are not the deadline', () => {
  expect(polishTaskTitle({ title: 'Zadzwonić do Kuby', due: 'środa' }, new Set(['zadzwonić', 'do', 'kuby'])).title).toBe('Zadzwonić do Kuby')
  expect(polishTaskTitle({ title: 'Kupić 2 paczki', due: 'jutro' }, new Set(['kupić', 'paczki'])).title).toBe('Kupić 2 paczki')
})
