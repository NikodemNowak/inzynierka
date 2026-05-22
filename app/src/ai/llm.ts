import { initLlama, releaseAllLlama, type LlamaContext, type TokenData } from 'llama.rn'

let context: LlamaContext | null = null

export const isModelLoaded = (): boolean => context !== null

export const loadModel = async (
  modelPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> => {
  if (context) return
  context = await initLlama(
    {
      model: modelPath,
      n_ctx: 2048,
      n_gpu_layers: 0, // emulator: CPU only (no OpenCL compute)
      use_mmap: true,
    },
    (percent) => onProgress?.(percent),
  )
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
  const startedAt = Date.now()
  let firstTokenAt: number | null = null
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
}

export const unloadModel = async (): Promise<void> => {
  await releaseAllLlama()
  context = null
}
