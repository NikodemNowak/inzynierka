import { addedWords } from './wordDiff'

test('marks only the words the current version does not have', () => {
  expect(addedWords('Zadania na tydzień', 'Slajdy i zadania na tydzień')).toEqual([
    { text: 'Slajdy i', added: true },
    { text: ' zadania na tydzień', added: false },
  ])
})

test('ignores case and punctuation when comparing', () => {
  expect(addedWords('Do piątku, trzy slajdy.', 'do piątku trzy Slajdy')).toEqual([
    { text: 'do piątku trzy Slajdy', added: false },
  ])
})

test('keeps the text intact and spaces outside highlights', () => {
  const next = 'Literatura i wysłanie rozdziału promotorowi'
  const segments = addedWords('Przegląd literatury i poprawa rozdziału', next)
  expect(segments.map((segment) => segment.text).join('')).toBe(next)
  expect(segments.filter((segment) => segment.added).every((segment) => segment.text === segment.text.trim())).toBe(true)
})

test('inflected forms of the same word are not new', () => {
  expect(addedWords('Omówiliśmy wyniki', 'Omówienie wyników projektu').filter((segment) => segment.added))
    .toEqual([{ text: 'projektu', added: true }])
})
