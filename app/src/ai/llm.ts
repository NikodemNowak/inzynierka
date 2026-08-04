import { initLlama, releaseAllLlama, type LlamaContext, type TokenData } from 'llama.rn'
import { enqueueLlm } from './llmQueue'
import { MODEL_CONFIG } from './modelConfig'

let context: LlamaContext | null = null

export const isModelLoaded = (): boolean => context !== null

// The weights are by far the largest allocation in this app (~1 GB on the
// emulator, ~2.5 GB with Qwen3-4B). Holding them after the user is done is what
// gets an app killed by iOS jetsam, so the context is dropped once it has been
// unused for a while; ensureModelReady reloads it on the next request.
const IDLE_UNLOAD_MS = 3 * 60_000
let idleTimer: ReturnType<typeof setTimeout> | null = null

const cancelIdleUnload = (): void => {
  if (idleTimer === null) return
  clearTimeout(idleTimer)
  idleTimer = null
}

const scheduleIdleUnload = (): void => {
  cancelIdleUnload()
  // Queued rather than released directly: llama.rn has a single shared context,
  // so the unload must never land in the middle of another job's generation.
  idleTimer = setTimeout(() => {
    idleTimer = null
    void enqueueLlm(unloadModel)
  }, IDLE_UNLOAD_MS)
}

export const loadModel = async (
  modelPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> => {
  if (context) return
  context = await initLlama(
    {
      model: modelPath,
      n_ctx: MODEL_CONFIG.nCtx,
      n_gpu_layers: MODEL_CONFIG.nGpuLayers,
      use_mmap: true,
    },
    (percent) => onProgress?.(percent),
  )
  // A model that was loaded but never used still occupies the memory.
  scheduleIdleUnload()
}

export interface GenerationResult {
  text: string
  ttftMs: number
  tokensPerSecond: number
}

const STOP = ['<|im_end|>', '<|endoftext|>', '</s>']

export interface GenerationOptions {
  temperature?: number
  nPredict?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  system?: string
}

const DEFAULT_SYSTEM = 'Jesteś zwięzłym asystentem. Odpowiadaj po polsku.'

export const generate = async (
  prompt: string,
  onToken: (token: string) => void,
  options: GenerationOptions = {},
): Promise<GenerationResult> => {
  if (!context) throw new Error('Model not loaded')
  cancelIdleUnload()
  const startedAt = Date.now()
  let firstTokenAt: number | null = null
  try {
    const result = await context.completion(
      {
        messages: [
          { role: 'system', content: options.system ?? DEFAULT_SYSTEM },
          { role: 'user', content: prompt },
        ],
        // Qwen3 non-thinking recommended sampling (temp 0.7 / top_p 0.8 / top_k 20).
        // Low temperature is discouraged: it makes the model copy input and loop.
        n_predict: options.nPredict ?? 256,
        temperature: options.temperature ?? 0.7,
        top_p: options.topP ?? 0.8,
        top_k: options.topK ?? 20,
        min_p: options.minP ?? 0,
        penalty_present: options.presencePenalty ?? 0,
        stop: STOP,
      },
      (data: TokenData) => {
        if (firstTokenAt === null) firstTokenAt = Date.now()
        onToken(data.token)
      },
    )
    return {
      text: result.text,
      ttftMs: (firstTokenAt ?? Date.now()) - startedAt,
      tokensPerSecond: result.timings?.predicted_per_second ?? 0,
    }
  } finally {
    // Re-arm on failure too, so a crashed generation does not pin the weights.
    scheduleIdleUnload()
  }
}

export const unloadModel = async (): Promise<void> => {
  cancelIdleUnload()
  if (!context) return
  await releaseAllLlama()
  context = null
}
