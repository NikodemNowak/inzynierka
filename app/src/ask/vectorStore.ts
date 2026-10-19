import { create } from 'zustand'
import { enqueueLlm } from '../ai/llmQueue'
import { getDatabase } from '../db/database'
import { withDatabaseWrite } from '../db/writeQueue'
import type { AskChunk, AskIndex } from './askIndex'
import { documentText, embedText, queryText } from './embedder'

// Sentence vectors for the notes, kept in SQLite and in memory. A vector is
// keyed by its note and a hash of the embedded text, so an edited sentence gets
// a new vector and an unchanged one is never embedded twice.

interface Stored {
  vector: Int8Array
  norm: number
}

export interface VectorIndexState {
  indexing: boolean
  done: number
  total: number
}

export const useVectorIndexStore = create<VectorIndexState>(() => ({ indexing: false, done: 0, total: 0 }))

let memory: Map<string, Stored> | null = null

// FNV-1a over the text, 52 bits so it stays an exact JS number.
const hash = (text: string): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x1505
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = (Math.imul(h2, 33) + code) >>> 0
  }
  return `${h1.toString(36)}${(h2 & 0xfffff).toString(36)}`
}

const normOf = (vector: Int8Array): number => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1

const docFor = (chunk: AskChunk, index: AskIndex): string => documentText(index.notes.get(chunk.noteId)?.title ?? '', chunk.text)
// Chunks live as long as their index, so each key is hashed once.
const keys = new WeakMap<AskChunk, string>()
export const vectorKey = (chunk: AskChunk, index: AskIndex): string => {
  let key = keys.get(chunk)
  if (!key) {
    key = `${chunk.noteId}:${hash(docFor(chunk, index))}`
    keys.set(chunk, key)
  }
  return key
}

const load = async (): Promise<Map<string, Stored>> => {
  if (memory) return memory
  const db = await getDatabase()
  const rows = await db.getAllAsync<{ key: string; vector: Uint8Array }>('SELECT key, vector FROM ask_vectors')
  memory = new Map(rows.map((row) => {
    const vector = new Int8Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength)
    return [row.key, { vector, norm: normOf(vector) }]
  }))
  return memory
}

const BATCH = 16
let running: Promise<void> | null = null

// Embeds every chunk that has no vector yet, a few at a time through the LLM
// queue so note processing and answers are never held up for long.
export const indexMissingVectors = (index: AskIndex, signal?: AbortSignal): Promise<void> => {
  running ??= (async () => {
    const stored = await load()
    const wanted = new Map(index.chunks.map((chunk) => [vectorKey(chunk, index), chunk]))
    const missing = [...wanted.entries()].filter(([key]) => !stored.has(key))
    const stale = [...stored.keys()].filter((key) => !wanted.has(key))
    if (stale.length) {
      const db = await getDatabase()
      await withDatabaseWrite(() => db.withExclusiveTransactionAsync(async (tx) => {
        for (const key of stale) await tx.runAsync('DELETE FROM ask_vectors WHERE key = ?', [key])
      }))
      for (const key of stale) stored.delete(key)
    }
    if (!missing.length) return
    useVectorIndexStore.setState({ indexing: true, done: 0, total: missing.length })
    try {
      for (let i = 0; i < missing.length; i += BATCH) {
        if (signal?.aborted) return
        const batch = missing.slice(i, i + BATCH)
        const vectors = await enqueueLlm(async () => {
          const out: [string, string, Int8Array][] = []
          for (const [key, chunk] of batch) out.push([key, chunk.noteId, await embedText(docFor(chunk, index))])
          return out
        })
        const db = await getDatabase()
        await withDatabaseWrite(() => db.withExclusiveTransactionAsync(async (tx) => {
          for (const [key, noteId, vector] of vectors)
            await tx.runAsync('INSERT OR REPLACE INTO ask_vectors (key, noteId, vector) VALUES (?, ?, ?)', [key, noteId, new Uint8Array(vector.buffer)])
        }))
        for (const [key, , vector] of vectors) stored.set(key, { vector, norm: normOf(vector) })
        useVectorIndexStore.setState({ done: Math.min(missing.length, i + BATCH) })
      }
    } finally {
      useVectorIndexStore.setState({ indexing: false })
    }
  })().finally(() => {
    running = null
  })
  return running
}

// Cosine similarity of the question to every chunk that already has a vector.
// Must run inside an LLM queue job (it embeds the question).
export const semanticSimilarity = async (question: string, index: AskIndex): Promise<Map<number, number>> => {
  const stored = await load()
  const query = await embedText(queryText(question))
  const queryNorm = normOf(query)
  const out = new Map<number, number>()
  for (const chunk of index.chunks) {
    const item = stored.get(vectorKey(chunk, index))
    if (!item) continue
    let dot = 0
    for (let d = 0; d < query.length; d += 1) dot += query[d]! * item.vector[d]!
    out.set(chunk.id, dot / (queryNorm * item.norm))
  }
  return out
}

export const clearVectors = async (): Promise<void> => {
  const db = await getDatabase()
  await withDatabaseWrite(() => db.runAsync('DELETE FROM ask_vectors').then(() => undefined))
  memory = new Map()
}
