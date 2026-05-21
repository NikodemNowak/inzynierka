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

export const generate = async (
  prompt: string,
  onToken: (token: string) => void,
): Promise<GenerationResult> => {
  if (!context) throw new Error('Model not loaded')
  const startedAt = Date.now()
  let firstTokenAt: number | null = null
  const result = await context.completion(
    {
      messages: [
        { role: 'system', content: 'Jesteś zwięzłym asystentem. Odpowiadaj po polsku.' },
        { role: 'user', content: prompt },
      ],
      n_predict: 256,
      temperature: 0.7,
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
