import { buildAskIndex } from './askIndex'
import { quantize } from './embedder'
import { indexMissingVectors, semanticSimilarity, useVectorIndexStore } from './vectorStore'

const mockRows = new Map<string, { key: string; noteId: string; vector: Uint8Array }>()
jest.mock('../db/database', () => ({
  getDatabase: async () => {
    const tx = {
      runAsync: async (sql: string, args: unknown[]) => {
        if (sql.startsWith('INSERT')) mockRows.set(args[0] as string, { key: args[0] as string, noteId: args[1] as string, vector: args[2] as Uint8Array })
        if (sql.startsWith('DELETE FROM ask_vectors WHERE')) mockRows.delete(args[0] as string)
      },
    }
    return {
      getAllAsync: async () => [...mockRows.values()],
      withExclusiveTransactionAsync: async (run: (t: typeof tx) => Promise<void>) => run(tx),
      runAsync: async () => mockRows.clear(),
    }
  },
}))
jest.mock('../db/writeQueue', () => ({ withDatabaseWrite: <T,>(run: () => Promise<T>) => run() }))
jest.mock('../ai/llmQueue', () => ({ enqueueLlm: <T,>(run: () => Promise<T>) => run() }))
// A toy embedder: one dimension per topic word.
const mockTopics = ['dentyst', 'dentist', 'mleko', 'samoch', 'hotel']
jest.mock('./embedder', () => {
  const actual = jest.requireActual('./embedder')
  return {
    ...actual,
    embedText: jest.fn(async (text: string) => actual.quantize(mockTopics.map((topic) => (text.toLowerCase().includes(topic) ? 1 : 0.01)).concat(new Array(251).fill(0)))),
  }
})

const day = new Date(2026, 9, 14).getTime()
const index = buildAskIndex(
  [
    { id: 'a', title: 'Zęby', content: 'Jutro idę do dentysty na szesnastą.', summary: null, createdAt: day },
    { id: 'b', title: 'Zakupy', content: 'Muszę kupić mleko i chleb.', summary: null, createdAt: day },
  ],
  [],
)

test('int8 vectors keep the cosine order of the floats', () => {
  const a = quantize([0.9, 0.1, 0.3, -0.2])
  const b = quantize([0.8, 0.2, 0.35, -0.1])
  const c = quantize([-0.1, 0.9, -0.3, 0.2])
  const cos = (x: Int8Array, y: Int8Array) => {
    const dot = x.reduce((sum, v, i) => sum + v * y[i]!, 0)
    return dot / (Math.hypot(...x) * Math.hypot(...y))
  }
  expect(cos(a, b)).toBeGreaterThan(0.95)
  expect(cos(a, c)).toBeLessThan(cos(a, b))
  expect(Math.max(...[...a].map(Math.abs))).toBe(127)
})

test('indexes every chunk once and ranks the matching note first', async () => {
  await indexMissingVectors(index)
  expect(mockRows.size).toBe(index.chunks.length)
  expect(useVectorIndexStore.getState()).toMatchObject({ indexing: false, done: index.chunks.length })
  await indexMissingVectors(index)
  expect(mockRows.size).toBe(index.chunks.length)
  const similarity = await semanticSimilarity('Kiedy mam dentystę?', index)
  const best = [...similarity.entries()].sort((x, y) => y[1] - x[1])[0]![0]
  expect(index.chunks.find((chunk) => chunk.id === best)?.noteId).toBe('a')
})

test('vectors of a removed note are dropped', async () => {
  const smaller = buildAskIndex([{ id: 'b', title: 'Zakupy', content: 'Muszę kupić mleko i chleb.', summary: null, createdAt: day }], [])
  await indexMissingVectors(smaller)
  expect([...mockRows.values()].every((row) => row.noteId === 'b')).toBe(true)
})
