import {
  initLlama,
  releaseAllLlama,
  getBackendDevicesInfo,
  type LlamaContext,
} from 'llama.rn'
import {
  cancelGeneration,
  generate,
  getLoadedModelInfo,
  loadModel,
  measureFormattedPromptTokens,
  unloadModel,
} from './llm'
import { BENCHMARK_QWEN3 } from './benchmarkProfiles'

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(),
  releaseAllLlama: jest.fn(async () => undefined),
  getBackendDevicesInfo: jest.fn(async () => [
    { type: 'CPU', deviceName: 'CPU' },
  ]),
}))
jest.mock('../i18n/translate', () => ({
  translate: (_pl: string, en: string) => en,
}))

const complete = {
  text: 'Done',
  content: 'Done',
  stopped_eos: true,
  stopped_word: '',
  stopping_word: '',
  stopped_limit: 0,
  truncated: false,
  context_full: false,
  interrupted: false,
  draft_tokens: 8,
  draft_tokens_accepted: 6,
  timings: {
    prompt_n: 12,
    prompt_ms: 50,
    predicted_n: 2,
    predicted_ms: 10,
    predicted_per_second: 20,
  },
}
const fakeContext = () => ({
  gpu: false,
  devices: ['CPU'],
  reasonNoGPU: 'GPU devices disabled by user',
  systemInfo: 'cpu',
  model: { metadata: {} },
  getFormattedChat: jest.fn(
    async (
      ..._args: Parameters<LlamaContext['getFormattedChat']>
    ): ReturnType<LlamaContext['getFormattedChat']> => ({
      type: 'jinja',
      prompt: '<chat>exact</chat>',
      has_media: false,
      additional_stops: ['END'],
    }),
  ),
  tokenize: jest.fn(async () => ({ tokens: [1, 2, 3] })),
  completion: jest.fn(async () => complete),
  stopCompletion: jest.fn(async () => undefined),
})
let native: ReturnType<typeof fakeContext>
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('LLM runtime protocol', () => {
  beforeEach(async () => {
    await unloadModel()
    jest.clearAllMocks()
    native = fakeContext()
    jest
      .mocked(initLlama)
      .mockResolvedValue(
        native as unknown as Awaited<ReturnType<typeof initLlama>>,
      )
  })
  afterEach(async () => {
    await unloadModel()
  })

  it.each([
    [{}, 'complete'],
    [{ truncated: true }, 'truncated'],
    [{ stopped_limit: 1 }, 'stopped_limit'],
    [{ context_full: true }, 'context_full'],
    [{ interrupted: true }, 'interrupted'],
    [{ stopped_eos: false }, 'unknown'],
  ])('preserves native termination %p', async (flags, expected) => {
    await loadModel('/one.gguf')
    native.completion.mockResolvedValue({ ...complete, ...flags })
    const result = await generate('source', () => undefined)
    expect(result.completion?.status).toBe(expected)
    expect(result.draftTokens).toBe(8)
    expect(result.draftTokensAccepted).toBe(6)
  })

  it('counts and submits the same formatted prompt with thinking disabled', async () => {
    await loadModel('/one.gguf')
    expect(
      await measureFormattedPromptTokens({
        systemPrompt: 'system',
        userPrompt: 'source',
      }),
    ).toBe(3)
    await generate('source', () => undefined, { system: 'system' })
    expect(native.getFormattedChat).toHaveBeenCalledWith(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'source' },
      ],
      undefined,
      expect.objectContaining({ enable_thinking: false }),
    )
    expect(native.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '<chat>exact</chat>',
        enable_thinking: false,
        stop: expect.arrayContaining(['END']),
      }),
      expect.any(Function),
    )
  })

  it('rejects a prompt whose reserved output would overflow without submitting it', async () => {
    await loadModel('/one.gguf')
    native.tokenize.mockResolvedValue({
      tokens: Array.from({ length: 8190 }, () => 1),
    })
    await expect(
      generate('source', () => undefined, { nPredict: 256 }),
    ).rejects.toThrow(/context/i)
    expect(native.completion).not.toHaveBeenCalled()
  })

  it('measures the same schema-dependent template and tokens that generate submits', async () => {
    await loadModel('/one.gguf')
    native.getFormattedChat.mockImplementation(async (_messages, _template, options) => ({
      type: 'jinja', has_media: false, additional_stops: [],
      prompt: options?.response_format ? '<schema>exact</schema>' : '<plain>different</plain>',
    }))
    const input = { systemPrompt: 'system', userPrompt: 'source', jsonSchema: { type: 'object' } }
    await measureFormattedPromptTokens(input)
    await generate(input.userPrompt, () => undefined, { system: input.systemPrompt, jsonSchema: input.jsonSchema })
    expect(native.getFormattedChat.mock.calls[0]).toEqual(native.getFormattedChat.mock.calls[1])
    expect(native.tokenize.mock.calls).toEqual([['<schema>exact</schema>'], ['<schema>exact</schema>']])
    expect(native.completion).toHaveBeenCalledWith(expect.objectContaining({ prompt: '<schema>exact</schema>' }), expect.any(Function))
  })

  it.each(['application', 'benchmark'] as const)(
    'processes a six-thousand-token source in the %s Qwen3 context',
    async (profile) => {
      await loadModel('/one.gguf', undefined, profile === 'benchmark'
        ? { model: BENCHMARK_QWEN3 }
        : {})
      native.tokenize.mockResolvedValue({ tokens: Array.from({ length: 6000 }, () => 1) })
      const result = await generate('complete long source', () => undefined, { nPredict: 256 })
      expect(result.completion?.status).toBe('complete')
      expect(result.formattedPromptTokens).toBe(6000)
      expect(native.completion).toHaveBeenCalledTimes(1)
    },
  )

  it('formats schema constraints with the template and retains its grammar and parser', async () => {
    await loadModel('/one.gguf')
    const schema = {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer', enum: [1, 2] } },
      },
      required: ['ids'],
      additionalProperties: false,
    }
    native.getFormattedChat.mockResolvedValue({
      type: 'jinja',
      prompt: '<chat>schema-aware</chat>',
      has_media: false,
      chat_format: 2,
      grammar: 'root ::= "{\\\"ids\\\":[" ("1" | "2") "]}"',
      grammar_lazy: false,
      grammar_triggers: [],
      generation_prompt: '<|im_start|>assistant\n<think>\n\n</think>\n\n',
      preserved_tokens: ['<think>', '</think>'],
      additional_stops: ['SCHEMA_END'],
      chat_parser: 'schema-aware-parser',
    })
    const result = await generate('Choose source IDs', () => undefined, {
      jsonSchema: schema,
    })
    expect(native.getFormattedChat).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.objectContaining({
        enable_thinking: false,
        reasoning_format: 'auto',
        response_format: { type: 'json_schema', json_schema: { schema } },
      }),
    )
    expect(native.tokenize).toHaveBeenCalledWith('<chat>schema-aware</chat>')
    expect(result.formattedPromptTokens).toBe(3)
    expect(native.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '<chat>schema-aware</chat>',
        response_format: { type: 'json_schema', json_schema: { schema } },
        grammar: 'root ::= "{\\\"ids\\\":[" ("1" | "2") "]}"',
        grammar_lazy: false,
        grammar_triggers: [],
        grammar_from_chat_template: true,
        generation_prompt: '<|im_start|>assistant\n<think>\n\n</think>\n\n',
        preserved_tokens: ['<think>', '</think>'],
        chat_format: 2,
        chat_parser: 'schema-aware-parser',
        stop: expect.arrayContaining(['SCHEMA_END']),
      }),
      expect.any(Function),
    )
  })

  it('keeps the schema response format for legacy templates without a Jinja prefill', async () => {
    await loadModel('/one.gguf')
    native.getFormattedChat.mockResolvedValue({
      type: 'llama-chat',
      prompt: '<legacy>exact</legacy>',
      has_media: false,
    })
    const schema = { type: 'object', additionalProperties: false }
    await generate('Choose IDs', () => undefined, { jsonSchema: schema })
    expect(native.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '<legacy>exact</legacy>',
        response_format: { type: 'json_schema', json_schema: { schema } },
      }),
      expect.any(Function),
    )
  })

  it('awaits completion settlement after native stop resolves', async () => {
    await loadModel('/one.gguf')
    const finishing = deferred<typeof complete>()
    native.completion.mockImplementation(() => finishing.promise)
    const operation = generate('source', () => undefined)
    while (!native.completion.mock.calls.length) await Promise.resolve()
    let cancelled = false
    const cancellation = cancelGeneration().then(() => {
      cancelled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(cancelled).toBe(false)
    finishing.resolve({ ...complete, interrupted: true })
    expect((await operation).completion?.status).toBe('interrupted')
    await cancellation
    expect(cancelled).toBe(true)
  })

  it('fences a cancellation during prompt formatting before native completion starts', async () => {
    await loadModel('/one.gguf')
    const formatting =
      deferred<Awaited<ReturnType<LlamaContext['getFormattedChat']>>>()
    native.getFormattedChat.mockImplementation(() => formatting.promise)
    const operation = generate('source', () => undefined)
    const rejected = expect(operation).rejects.toThrow(/cancel/i)
    const cancellation = cancelGeneration()
    formatting.resolve({
      type: 'jinja',
      prompt: 'source',
      has_media: false,
      additional_stops: [],
    })
    await rejected
    await cancellation
    expect(native.completion).not.toHaveBeenCalled()
  })

  it('reloads a different model identity and explicitly selects only CPU devices', async () => {
    await loadModel('/one.gguf')
    await loadModel('/two.gguf', undefined, { execution: 'background-cpu' })
    expect(releaseAllLlama).toHaveBeenCalledTimes(1)
    expect(getBackendDevicesInfo).toHaveBeenCalled()
    expect(initLlama).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: '/two.gguf',
        devices: ['CPU'],
        no_gpu_devices: true,
        n_gpu_layers: 0,
        flash_attn_type: 'off',
        ctx_shift: false,
      }),
      expect.any(Function),
    )
    expect(getLoadedModelInfo()?.execution).toBe('background-cpu')
  })

  it('fails closed if the initialized background context reports GPU use', async () => {
    native.gpu = true
    await expect(
      loadModel('/one.gguf', undefined, { execution: 'background-cpu' }),
    ).rejects.toThrow(/CPU/i)
    expect(getLoadedModelInfo()).toBeNull()
  })

  it('disposes an initialized model cancelled before its native load returns', async () => {
    const initialization = deferred<Awaited<ReturnType<typeof initLlama>>>()
    jest.mocked(initLlama).mockReturnValueOnce(initialization.promise)
    const loaded = loadModel('/cancelled.gguf')
    const rejected = expect(loaded).rejects.toThrow(/cancel/i)
    while (!jest.mocked(initLlama).mock.calls.length) await Promise.resolve()
    const cancelled = cancelGeneration()
    initialization.resolve(
      native as unknown as Awaited<ReturnType<typeof initLlama>>,
    )
    await rejected
    await cancelled
    expect(getLoadedModelInfo()).toBeNull()
    expect(releaseAllLlama).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent model transitions so two contexts never initialize together', async () => {
    await loadModel('/one.gguf')
    const transitions: string[] = []
    jest.mocked(releaseAllLlama).mockImplementation(async () => {
      transitions.push('release')
    })
    jest.mocked(initLlama).mockImplementation(async (options) => {
      transitions.push(options.model)
      return native as unknown as Awaited<ReturnType<typeof initLlama>>
    })
    await Promise.all([loadModel('/two.gguf'), loadModel('/three.gguf')])
    expect(transitions).toEqual([
      'release',
      '/two.gguf',
      'release',
      '/three.gguf',
    ])
  })
})
