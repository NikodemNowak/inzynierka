import {
  initLlama,
  releaseAllLlama,
  getBackendDevicesInfo,
  addNativeLogListener,
  toggleNativeLog,
  type CompletionParams,
  type CompletionResponseFormat,
  type LlamaContext,
  type TokenData,
  type JinjaFormattedChatResult,
} from 'llama.rn'
import { enqueueLlm } from './llmQueue'
import {
  MODEL_CONFIG,
  type ModelConfig,
  type ModelExecutionProfile,
} from './modelConfig'
import { translate } from '../i18n/translate'

let context: LlamaContext | null = null
let loadedInfo: LoadedModelInfo | null = null
let loading: Promise<void> | null = null
let loadCancelled = false
let active: ActiveGeneration | null = null
let modelLifecycle: Promise<unknown> = Promise.resolve()
let transitioning = false

export interface LoadedModelInfo {
  modelPath: string
  model: ModelConfig
  execution: ModelExecutionProfile
  speculative: boolean
  gpu: boolean
  devices: string[]
  reasonNoGPU: string
  systemInfo: string
  // Backend lines logged while the context was created (Metal tensor API, flash attention).
  nativeInitLog?: string[]
  metadata: Record<string, unknown>
}
export interface ModelLoadOptions {
  modelPath?: string
  execution?: ModelExecutionProfile
  model?: ModelConfig
  speculative?: boolean
  signal?: AbortSignal
}
export type LoadModelOptions = ModelLoadOptions
const NATIVE_LOG_PATTERN = /tensor|flash|metal|simdgroup|bfloat|gpu|ubatch|compute buffer|kv/i
const NATIVE_LOG_LIMIT = 60

// Diagnostic only: it must never fail or slow down loading the model.
const captureNativeInitLog = async (): Promise<() => Promise<string[]>> => {
  const lines: string[] = []
  let subscription: { remove: () => void } | null = null
  try {
    if (typeof addNativeLogListener !== 'function' || typeof toggleNativeLog !== 'function')
      return async () => lines
    subscription = addNativeLogListener((_level, text) => {
      const line = text.trim()
      if (lines.length < NATIVE_LOG_LIMIT && NATIVE_LOG_PATTERN.test(line))
        lines.push(line.slice(0, 200))
    })
    await toggleNativeLog(true)
  } catch {
    /* logging is optional */
  }
  return async () => {
    try {
      await toggleNativeLog(false)
      subscription?.remove()
    } catch {
      /* logging is optional */
    }
    return lines
  }
}

export const isModelLoaded = (): boolean => context !== null
export const getLoadedModelInfo = (): LoadedModelInfo | null => loadedInfo
export const getContextWindowSize = (): number =>
  loadedInfo?.model.nCtx ?? MODEL_CONFIG.nCtx

const IDLE_UNLOAD_MS = 3 * 60_000
let idleTimer: ReturnType<typeof setTimeout> | null = null
const cancelIdleUnload = (): void => {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = null
}
const scheduleIdleUnload = (): void => {
  cancelIdleUnload()
  idleTimer = setTimeout(() => {
    idleTimer = null
    void enqueueLlm(unloadModel).catch(() => undefined)
  }, IDLE_UNLOAD_MS)
}

export class GenerationCancelledError extends Error {
  constructor() {
    super(translate('Generowanie anulowano.', 'Generation cancelled.'))
    this.name = 'GenerationCancelledError'
  }
}
const ensureNotCancelled = (signal?: AbortSignal, cancelled = false): void => {
  if (signal?.aborted || cancelled) throw new GenerationCancelledError()
}
const sameModel = (
  path: string,
  model: ModelConfig,
  execution: ModelExecutionProfile,
  speculative: boolean,
): boolean =>
  loadedInfo !== null &&
  loadedInfo.modelPath === path &&
  loadedInfo.execution === execution &&
  loadedInfo.speculative === speculative &&
  loadedInfo.model.nCtx === model.nCtx &&
  loadedInfo.model.nGpuLayers === model.nGpuLayers &&
  loadedInfo.model.revision === model.revision &&
  loadedInfo.model.sha256 === model.sha256

export const isModelLoadedFor = (
  modelPath: string,
  options: ModelLoadOptions = {},
): boolean =>
  context !== null &&
  sameModel(
    modelPath,
    options.model ?? MODEL_CONFIG,
    options.execution ?? 'foreground',
    options.speculative ?? false,
  )

// Called inside the shared job queue. Reusing requires the same file, backend
// and speculative state: MTP rollback slots must exist at context creation.
export const loadModel = (
  modelPath: string,
  onProgress?: (percent: number) => void,
  options: ModelLoadOptions = {},
): Promise<void> => {
  const operation = modelLifecycle.then(async () => {
    transitioning = true
    try {
      await performModelLoad(modelPath, onProgress, options)
    } finally {
      transitioning = false
    }
  })
  modelLifecycle = operation.catch(() => undefined)
  return operation
}
const disposeLoadedContext = async (): Promise<void> => {
  cancelIdleUnload()
  if (!context) return
  await releaseAllLlama()
  context = null
  loadedInfo = null
}
const performModelLoad = async (
  modelPath: string,
  onProgress?: (percent: number) => void,
  options: ModelLoadOptions = {},
): Promise<void> => {
  ensureNotCancelled(options.signal)
  const model = options.model ?? MODEL_CONFIG
  const execution = options.execution ?? 'foreground'
  const speculative = options.speculative ?? false
  if (sameModel(modelPath, model, execution, speculative)) return
  if (active)
    throw new Error(
      translate(
        'Model jest używany przez generację.',
        'Model is in use by a generation.',
      ),
    )
  if (context) await disposeLoadedContext()
  loadCancelled = false
  const onAbort = (): void => {
    loadCancelled = true
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const operation = (async (): Promise<void> => {
    const cpuOnly = execution === 'background-cpu'
    const cpuDevices = cpuOnly
      ? (await getBackendDevicesInfo())
          .filter((device) => device.type.toUpperCase() === 'CPU')
          .map((device) => device.deviceName)
      : []
    ensureNotCancelled(options.signal, loadCancelled)
    if (cpuOnly && cpuDevices.length === 0) {
      throw new Error(
        translate(
          'Backend CPU jest niedostępny.',
          'CPU backend is unavailable.',
        ),
      )
    }
    const stopNativeLog = await captureNativeInitLog()
    let nativeInitLog: string[] = []
    const next = await initLlama(
      {
        model: modelPath,
        n_ctx: model.nCtx,
        n_parallel: 1,
        ctx_shift: false,
        n_gpu_layers: cpuOnly ? 0 : model.nGpuLayers,
        // Empty devices is discarded by llama.rn 0.12.3; a nonempty CPU list
        // reaches native model params and prevents default GPU enumeration.
        ...(cpuOnly
          ? {
              devices: cpuDevices,
              no_gpu_devices: true,
              flash_attn_type: 'off',
            }
          : {}),
        ...(speculative
          ? {
              speculative: {
                type: 'draft-mtp' as const,
                draft: { n_max: 2, n_min: 1 },
              },
            }
          : { speculative: false }),
        use_mmap: true,
      },
      (percent) => onProgress?.(percent),
    ).then(
      async (created) => {
        nativeInitLog = await stopNativeLog()
        return created
      },
      async (error: unknown) => {
        await stopNativeLog()
        throw error
      },
    )
    const selectedDevices = next.devices ?? []
    if (
      loadCancelled ||
      options.signal?.aborted ||
      (cpuOnly &&
        (next.gpu ||
          selectedDevices.some((device) => !cpuDevices.includes(device))))
    ) {
      await releaseAllLlama()
      ensureNotCancelled(options.signal, loadCancelled)
      throw new Error(
        translate(
          'Nie potwierdzono profilu wyłącznie CPU.',
          'CPU-only backend verification failed.',
        ),
      )
    }
    context = next
    loadedInfo = {
      modelPath,
      model,
      execution,
      speculative,
      gpu: next.gpu,
      devices: [...selectedDevices],
      reasonNoGPU: next.reasonNoGPU,
      systemInfo: next.systemInfo,
      nativeInitLog,
      metadata: next.model.metadata as Record<string, unknown>,
    }
    scheduleIdleUnload()
  })()
  loading = operation
  try {
    await operation
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    if (loading === operation) loading = null
  }
}

export type GenerationStatus =
  | 'complete'
  | 'truncated'
  | 'stopped_limit'
  | 'context_full'
  | 'interrupted'
  | 'unknown'
export interface GenerationCompletion {
  status: GenerationStatus
  truncated: boolean
  stoppedLimit: boolean
  contextFull: boolean
  interrupted: boolean
  stoppedEos: boolean
  stoppingWord: string
}
export interface GenerationResult {
  text: string
  ttftMs: number
  tokensPerSecond: number
  wallMs: number
  promptMs: number
  predictedMs: number
  promptTokens: number
  predictedTokens: number
  completion?: GenerationCompletion
  formattedPromptTokens?: number
  draftTokens?: number
  draftTokensAccepted?: number
  modelInfo?: LoadedModelInfo
}
export interface GenerationOptions {
  jsonSchema?: Readonly<Record<string, unknown>>
  temperature?: number
  nPredict?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  system?: string
  signal?: AbortSignal
}
interface ActiveGeneration {
  cancelled: boolean
  nativeStarted: boolean
  settled: Promise<GenerationResult> | null
  stop: Promise<void> | null
}
const STOP = ['<|im_end|>', '<|endoftext|>', '</s>']
const defaultSystem = (): string =>
  translate(
    'Jesteś zwięzłym asystentem. Odpowiadaj po polsku.',
    'You are a concise assistant. Respond in English.',
  )
const requireContext = (): LlamaContext => {
  if (transitioning)
    throw new Error(
      translate('Model jest w trakcie zmiany.', 'Model context is changing.'),
    )
  if (!context)
    throw new Error(
      translate('Model nie jest wczytany.', 'Model is not loaded.'),
    )
  return context
}
export const tokenizeText = async (text: string): Promise<number[]> =>
  (await requireContext().tokenize(text)).tokens
const responseFormat = (
  jsonSchema?: GenerationOptions['jsonSchema'],
): CompletionResponseFormat | undefined =>
  jsonSchema
    ? { type: 'json_schema', json_schema: { schema: jsonSchema } }
    : undefined
const formatPrompt = (
  userPrompt: string,
  systemPrompt?: string,
  jsonSchema?: GenerationOptions['jsonSchema'],
) =>
  requireContext().getFormattedChat(
    [
      { role: 'system', content: systemPrompt ?? defaultSystem() },
      { role: 'user', content: userPrompt },
    ],
    undefined,
    {
      enable_thinking: false,
      add_generation_prompt: true,
      ...(jsonSchema
        ? {
            response_format: responseFormat(jsonSchema),
            // Parse the template's empty thinking block without enabling thought
            // generation, so the grammar can accept the complete assistant prefix.
            reasoning_format: 'auto' as const,
          }
        : {}),
    },
  )
export const measureFormattedPromptTokens = async (input: {
  systemPrompt?: string
  userPrompt: string
  jsonSchema?: GenerationOptions['jsonSchema']
}): Promise<number> => {
  const formatted = await formatPrompt(input.userPrompt, input.systemPrompt, input.jsonSchema)
  return (await tokenizeText(formatted.prompt)).length
}
const requestStop = (run: ActiveGeneration): void => {
  run.cancelled = true
  if (run.nativeStarted && !run.stop && context) {
    const native = context
    run.stop = Promise.resolve().then(() => native.stopCompletion())
    void run.stop.catch(() => undefined)
  }
}
// Stop acknowledges the request before the native worker necessarily returns.
// Await both before allowing release or a different context to load.
export const cancelGeneration = async (_reason?: string): Promise<void> => {
  if (loading) {
    loadCancelled = true
    await Promise.allSettled([loading])
  }
  const run = active
  if (!run) return
  requestStop(run)
  await Promise.allSettled([
    ...(run.stop ? [run.stop] : []),
    ...(run.settled ? [run.settled] : []),
  ])
}
export const generate = (
  prompt: string,
  onToken: (token: string) => void,
  options: GenerationOptions = {},
): Promise<GenerationResult> => {
  try {
    ensureNotCancelled(options.signal)
    requireContext()
    if (active)
      throw new Error(
        translate(
          'Generowanie już trwa.',
          'Generation is already in progress.',
        ),
      )
  } catch (error) {
    return Promise.reject(error)
  }
  const run: ActiveGeneration = {
    cancelled: false,
    nativeStarted: false,
    settled: null,
    stop: null,
  }
  active = run
  cancelIdleUnload()
  const onAbort = (): void => requestStop(run)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const startedAt = Date.now()
  let firstTokenAt: number | null = null
  const operation = (async (): Promise<GenerationResult> => {
    const native = requireContext()
    const formatted = await formatPrompt(
      prompt,
      options.system,
      options.jsonSchema,
    )
    ensureNotCancelled(options.signal, run.cancelled)
    const formattedPromptTokens = (await native.tokenize(formatted.prompt))
      .tokens.length
    ensureNotCancelled(options.signal, run.cancelled)
    const nPredict = options.nPredict ?? 256
    if (
      !Number.isInteger(nPredict) ||
      nPredict <= 0 ||
      formattedPromptTokens + nPredict + 8 > getContextWindowSize()
    ) {
      throw new Error(
        translate(
          'Prompt i wynik przekraczają kontekst modelu.',
          'Prompt and output exceed the model context.',
        ),
      )
    }
    const parameters: CompletionParams & {
      grammar_from_chat_template?: boolean
    } = {
      prompt: formatted.prompt,
      enable_thinking: false,
      ...(options.jsonSchema
        ? {
            response_format: responseFormat(options.jsonSchema),
            reasoning_format: 'auto' as const,
          }
        : {}),
      n_predict: nPredict,
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.8,
      top_k: options.topK ?? 20,
      min_p: options.minP ?? 0,
      penalty_present: options.presencePenalty ?? 0,
      speculative: loadedInfo?.speculative
        ? { type: 'draft-mtp', draft: { n_max: 2, n_min: 1 } }
        : false,
      stop: [...STOP],
    }
    // Submit the measured prompt once, preserving its Jinja parser and stops.
    if (formatted.type === 'jinja') {
      const jinja = formatted as JinjaFormattedChatResult
      Object.assign(parameters, {
        chat_format: jinja.chat_format,
        grammar: jinja.grammar,
        grammar_lazy: jinja.grammar_lazy,
        grammar_triggers: jinja.grammar_triggers,
        preserved_tokens: jinja.preserved_tokens,
        generation_prompt: jinja.generation_prompt,
        thinking_forced_open: jinja.thinking_forced_open,
        thinking_start_tag: jinja.thinking_start_tag,
        thinking_end_tag: jinja.thinking_end_tag,
        chat_parser: jinja.chat_parser,
      })
      parameters.stop?.push(...(jinja.additional_stops ?? []))
      if (options.jsonSchema && jinja.grammar) {
        parameters.grammar_from_chat_template = true
      }
    }
    const completionPromise = native.completion(
      parameters,
      (data: TokenData) => {
        if (run.cancelled || options.signal?.aborted) return
        if (firstTokenAt === null) firstTokenAt = Date.now()
        onToken(data.token)
      },
    )
    run.nativeStarted = true
    if (run.cancelled || options.signal?.aborted) requestStop(run)
    const result = await completionPromise
    const interrupted =
      result.interrupted || run.cancelled || options.signal?.aborted === true
    const stoppedLimit = Boolean(result.stopped_limit)
    const stoppingWord =
      typeof result.stopping_word === 'string'
        ? result.stopping_word
        : typeof result.stopped_word === 'string'
          ? result.stopped_word
          : ''
    const status: GenerationStatus = interrupted
      ? 'interrupted'
      : result.truncated
        ? 'truncated'
        : result.context_full
          ? 'context_full'
          : stoppedLimit
            ? 'stopped_limit'
            : result.stopped_eos || result.stopping_word || result.stopped_word
              ? 'complete'
              : 'unknown'
    return {
      text: result.content || result.text,
      ttftMs: (firstTokenAt ?? Date.now()) - startedAt,
      tokensPerSecond: result.timings?.predicted_per_second ?? 0,
      wallMs: Date.now() - startedAt,
      promptMs: result.timings?.prompt_ms ?? 0,
      predictedMs: result.timings?.predicted_ms ?? 0,
      promptTokens: result.timings?.prompt_n ?? 0,
      predictedTokens: result.timings?.predicted_n ?? 0,
      formattedPromptTokens,
      draftTokens: result.draft_tokens,
      draftTokensAccepted: result.draft_tokens_accepted,
      ...(loadedInfo ? { modelInfo: loadedInfo } : {}),
      completion: {
        status,
        truncated: result.truncated,
        stoppedLimit,
        contextFull: result.context_full,
        interrupted,
        stoppedEos: result.stopped_eos,
        stoppingWord,
      },
    }
  })()
  run.settled = operation
  return operation.finally(() => {
    options.signal?.removeEventListener('abort', onAbort)
    if (active === run) active = null
    scheduleIdleUnload()
  })
}
export const unloadModel = (): Promise<void> => {
  const operation = modelLifecycle.then(async () => {
    transitioning = true
    try {
      if (active) await cancelGeneration()
      await disposeLoadedContext()
    } finally {
      transitioning = false
    }
  })
  modelLifecycle = operation.catch(() => undefined)
  return operation
}
