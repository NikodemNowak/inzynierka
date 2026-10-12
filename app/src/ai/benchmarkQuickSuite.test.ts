import { runBenchmarkSuite } from './benchmarkService'
import { QUICK_SUITE_TEXTS, runQuickSuite } from './benchmarkQuickSuite'

jest.mock('./benchmarkService', () => ({
  runBenchmarkSuite: jest.fn(async () => []),
}))

test('embeds the fixed Polish notes with their nominal word counts', () => {
  for (const text of QUICK_SUITE_TEXTS)
    expect(text.source.trim().split(/\s+/)).toHaveLength(text.words)
  expect(QUICK_SUITE_TEXTS.map((text) => text.words)).toEqual([56, 346, 1116])
})

test('runs every note once on the default arm, in order', async () => {
  const progress = jest.fn()
  await runQuickSuite({ onProgress: progress })
  const calls = jest.mocked(runBenchmarkSuite).mock.calls.map(([options]) => options)
  expect(calls.map((options) => options.fixtureId)).toEqual(QUICK_SUITE_TEXTS.map((text) => text.id))
  for (const options of calls) {
    expect(options).toMatchObject({ arms: ['qwen3'], warmRepeats: 0, language: 'pl', inputMode: 'text' })
  }
})
