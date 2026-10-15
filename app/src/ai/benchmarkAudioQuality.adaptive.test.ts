import { evaluateBenchmarkAudioQuality } from './benchmarkAudioQuality'

test('keeps substitution-first ties between repeated words in a long source', () => {
  const padding = 'background '.repeat(180)
  expect(evaluateBenchmarkAudioQuality(`${padding}a b`, `${padding}b a`)).toMatchObject({
    substitutions: 2, deletions: 0, insertions: 0,
  })
})

test('prefers substitutions over a tied deletion and insertion around repeated words', () => {
  const middle = 'background '.repeat(180)
  expect(evaluateBenchmarkAudioQuality(`start ${middle}`, `${middle}finish`)).toMatchObject({
    substitutions: 2, deletions: 0, insertions: 0,
  })
})

test('counts all unrelated words rather than accepting a narrow comparison', () => {
  expect(evaluateBenchmarkAudioQuality('kot '.repeat(200), 'pies '.repeat(200))).toMatchObject({
    substitutions: 200, deletions: 0, insertions: 0, wordErrorRate: 1,
  })
})

test('counts a long missing prefix and preserves matching repeated tail', () => {
  expect(evaluateBenchmarkAudioQuality(`${'brak '.repeat(280)}koniec`, 'koniec')).toMatchObject({
    substitutions: 0, deletions: 280, insertions: 0, wordErrorRate: 280 / 281,
  })
})

test('preserves distinct Polish names and negation inside a long matching source', () => {
  const padding = 'zwykła rozmowa '.repeat(100)
  expect(evaluateBenchmarkAudioQuality(
    `${padding}Łucja nie kupi kamer w piątek.${padding}`,
    `${padding}Łukasz kupi kamer w piątek.${padding}`,
  )).toMatchObject({ substitutions: 1, deletions: 1, insertions: 0 })
})
