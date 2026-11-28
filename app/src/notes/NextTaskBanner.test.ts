import { morePhrase } from './NextTaskBanner'

const pl = (pl: string) => pl
const phrase = (count: number) => morePhrase(count, pl)

test('the "more tasks" phrase uses the right Polish form', () => {
  expect(phrase(1)).toBe('+1 zadanie')
  expect(phrase(2)).toBe('+2 zadania')
  expect(phrase(5)).toBe('+5 zadań')
  expect(phrase(12)).toBe('+12 zadań')
  expect(phrase(22)).toBe('+22 zadania')
  expect(phrase(25)).toBe('+25 zadań')
})
