import { initLlama, type LlamaContext } from 'llama.rn'
import { EMBEDDING_MODEL, embeddingModelPath } from './embeddingModel'

// A small llama.rn context that only produces embeddings. The main model's
// loader releases every native context, so a failed call reopens this one once.

let context: LlamaContext | null = null
let opening: Promise<LlamaContext> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
const IDLE_MS = 90_000

const open = (): Promise<LlamaContext> => {
  if (context) return Promise.resolve(context)
  opening ??= initLlama({ model: embeddingModelPath(), embedding: true, n_ctx: 512, n_batch: 512, n_ubatch: 512, n_gpu_layers: 99, n_parallel: 1 })
    .then((next) => {
      context = next
      return next
    })
    .finally(() => {
      opening = null
    })
  return opening
}

export const releaseEmbedder = async (): Promise<void> => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const current = context
  context = null
  await current?.release().catch(() => undefined)
}

const touch = (): void => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void releaseEmbedder(), IDLE_MS)
}

// Unit-length vector cut to the stored dimensions, as signed bytes (256 B per sentence).
export const quantize = (values: readonly number[]): Int8Array => {
  const cut = values.slice(0, EMBEDDING_MODEL.dims)
  const norm = Math.sqrt(cut.reduce((sum, value) => sum + value * value, 0)) || 1
  // Unit vectors keep each value inside ±1; 127 / 0.5 would clip the rare large one.
  const scale = 127 / Math.max(1e-6, ...cut.map((value) => Math.abs(value / norm)))
  return Int8Array.from(cut, (value) => Math.round((value / norm) * scale))
}

const embedRaw = async (text: string): Promise<number[]> => {
  try {
    return (await (await open()).embedding(text, { embd_normalize: 2 })).embedding
  } catch {
    context = null
    return (await (await open()).embedding(text, { embd_normalize: 2 })).embedding
  }
}

export const embedText = async (text: string): Promise<Int8Array> => {
  const vector = quantize(await embedRaw(text))
  touch()
  return vector
}

// EmbeddingGemma's own prompt formats for retrieval.
export const queryText = (question: string): string => `task: search result | query: ${question}`
export const documentText = (title: string, text: string): string => `title: ${title || 'none'} | text: ${text}`
