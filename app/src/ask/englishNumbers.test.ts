import { englishWordsToDigits } from './englishNumbers'

test.each([
  ['I need to pay two hundred and twelve dollars by the twentieth.', 'I need to pay 212 dollars by the 20th.'],
  ['around fifteen pages instead of twenty five', 'around 15 pages instead of 25'],
  ['the call is at eleven tomorrow', 'the call is at 11 tomorrow'],
  ['meeting at five pm on the twenty second of November', 'meeting at 5 pm on the 22nd of November'],
  ['nineteen thousand five hundred zloty', '19500 zloty'],
  ['one of them has two cartons', 'one of them has two cartons'],
  ['thirty-five minutes', '35 minutes'],
  ['the second chapter', 'the 2nd chapter'],
])('%s', (input, expected) => {
  expect(englishWordsToDigits(input)).toBe(expected)
})
