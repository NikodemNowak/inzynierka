/// <reference types="node" />
// Node-only file: jest runs it on the PC, the app bundle never imports it.
// LLM regression run: every case in regressionCases.ts goes through the real note
// pipeline (summary, title, tasks) with the model served by llama-server on the PC.
// Not part of `npm test`; run it with `npm run test:llm`.
//
// The server must run the phone's model with a fixed seed and one slot, otherwise two
// runs of the same code differ and the comparison means nothing:
//   llama-server -m Qwen3-4B-Q4_K_M.gguf --port 8481 -c 8192 -ngl 99 --jinja --seed 42 -np 1
//
// Env: LLM_SERVER (default http://127.0.0.1:8481), LLM_REGRESSION_LABEL (default: commit),
// LLM_REGRESSION_BASE (a label to compare with; default baseline, else the previous run),
// LLM_REGRESSION_ONLY (comma-separated case ids).
// Results land in app/.llm-regression/<label>.json with a <label>.md report.
import { execFileSync } from 'child_process'
import http from 'http'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { generate, type GenerationResult } from '../llm'
import { processNoteWithLlm } from '../noteProcessing'
import { setSummaryEngineMode } from '../summaryEngine'
import { createTaskProposal } from '../taskProposal'
import { REGRESSION_CASES } from './regressionCases'
import { compareRuns, formatReport, scoreOutput, stripPunctuation, type CaseResult, type RunFile, type RunOutput } from './regressionScore'

jest.mock('../llm', () => ({
  generate: jest.fn(),
  isModelLoaded: () => true,
  isModelLoadedFor: () => true,
  loadModel: jest.fn(),
  getLoadedModelInfo: () => null,
  getContextWindowSize: () => 8192,
  measureFormattedPromptTokens: async ({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) =>
    Math.ceil((systemPrompt + userPrompt).length / 3.2) + 12,
}))
jest.mock('../modelDownload', () => ({ isModelDownloaded: async () => true, getModelPath: () => '/default.gguf' }))
jest.mock('../generationMetrics', () => ({ recordGeneration: jest.fn() }))

jest.setTimeout(1_800_000)

const SEED = 42
const SERVER = process.env.LLM_SERVER ?? 'http://127.0.0.1:8481'
const OUT_DIR = join(__dirname, '../../../.llm-regression')
const ONLY = process.env.LLM_REGRESSION_ONLY?.split(',').map((id: string) => id.trim()) ?? null

const git = (...args: string[]): string => {
  try {
    return execFileSync('git', args, { cwd: join(__dirname, '../../..'), encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const COMMIT = `${git('rev-parse', '--short', 'HEAD') || 'unknown'}${git('status', '--porcelain', '--', 'src') ? '-dirty' : ''}`
const LABEL = process.env.LLM_REGRESSION_LABEL ?? COMMIT

type SuiteNote = { id: string; content: string }
const SUITE_NOTES = (require('../../benchmark/suiteData.json') as { notes: SuiteNote[] }).notes

// Plain http: the jest-expo environment replaces fetch.
const request = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => new Promise((resolve, reject) => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const call = http.request(`${SERVER}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (response) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
  })
  call.on('error', reject)
  call.end(payload)
})

const post = async (path: string, body: unknown): Promise<unknown> => {
  for (let attempt = 0; ; attempt += 1) {
    const json = await request('POST', path, body) as { error?: unknown }
    if (!json.error || attempt >= 10) return json
    await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
  }
}

type GenerateOptions = { jsonSchema?: Record<string, unknown>; system?: string; nPredict?: number; temperature?: number; topP?: number; topK?: number }
type Completion = { content: string; stop_type: string; tokens_predicted: number; tokens_evaluated: number; timings: { prompt_ms: number; predicted_ms: number } }

// Same sampling as the phone (llm.ts defaults), plus a fixed seed.
const callServer = async (prompt: string, _tokens: unknown, options?: GenerateOptions): Promise<GenerationResult> => {
  const started = Date.now()
  const templated = await post('/apply-template', {
    messages: [{ role: 'system', content: options?.system ?? '' }, { role: 'user', content: prompt }],
    chat_template_kwargs: { enable_thinking: false, add_generation_prompt: true },
  }) as { prompt: string }
  const completion = await post('/completion', {
    prompt: templated.prompt, seed: SEED, temperature: options?.temperature ?? 0.1, top_p: options?.topP ?? 0.8,
    top_k: options?.topK ?? 20, min_p: 0, n_predict: options?.nPredict ?? 256, cache_prompt: true,
    ...(options?.jsonSchema ? { json_schema: options.jsonSchema } : {}),
  }) as Completion
  const limited = completion.stop_type === 'limit'
  return {
    text: completion.content, ttftMs: 0, tokensPerSecond: 0, wallMs: Date.now() - started,
    promptMs: completion.timings.prompt_ms, predictedMs: completion.timings.predicted_ms,
    promptTokens: completion.tokens_evaluated, predictedTokens: completion.tokens_predicted,
    completion: { status: limited ? 'stopped_limit' : 'complete', truncated: limited, stoppedLimit: limited, contextFull: false, interrupted: false, stoppedEos: !limited, stoppingWord: '' },
  }
}

const textOf = (source: { suite: string } | { text: string }): string => {
  if ('text' in source) return source.text
  const note = SUITE_NOTES.find((item) => item.id === source.suite)
  if (!note) throw new Error(`Unknown suite note ${source.suite}`)
  return note.content.trim()
}

const runs = REGRESSION_CASES
  .filter((item) => !ONLY || ONLY.includes(item.id))
  .flatMap((item) => item.variants.map((variant) => ({ item, variant, key: `${item.id}/${variant}` })))

const results: CaseResult[] = []
let model = 'unknown'

const readRun = (label: string): RunFile | null => {
  const path = join(OUT_DIR, `${label}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as RunFile : null
}

beforeAll(async () => {
  setSummaryEngineMode('points')
  jest.mocked(generate).mockImplementation(callServer)
  const props = await request('GET', '/props') as { model_path?: string }
  model = props.model_path?.split(/[\\/]/u).pop() ?? 'unknown'
  mkdirSync(OUT_DIR, { recursive: true })
  // The previous run stays comparable after this one overwrites latest.json.
  if (existsSync(join(OUT_DIR, 'latest.json'))) copyFileSync(join(OUT_DIR, 'latest.json'), join(OUT_DIR, 'previous.json'))
})

test.each(runs.map((run) => [run.key, run]))('%s', async (_key, { item, variant, key }) => {
  const raw = textOf(item.source)
  const content = variant === 'stripped' ? stripPunctuation(raw) : raw
  const started = Date.now()
  let output: RunOutput | null = null
  let error: string | undefined
  try {
    const execution = { taskEvidenceMemo: {} }
    const note = await processNoteWithLlm(content, () => undefined, undefined, 'pl', execution, true)
    const proposal = await createTaskProposal(content, () => undefined, 'pl', execution)
    output = { title: note.title, summary: note.summary, tasks: proposal.tasks, ms: Date.now() - started }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  results.push({ key, caseId: item.id, variant, output, ...(error ? { error } : {}), checks: scoreOutput(item.checks, output) })
  expect(error).toBeUndefined()
})

test('no regressions against the base run', () => {
  const head: RunFile = { label: LABEL, createdAt: new Date().toISOString(), commit: COMMIT, model, seed: SEED, results }
  const baseLabel = process.env.LLM_REGRESSION_BASE ?? (existsSync(join(OUT_DIR, 'baseline.json')) ? 'baseline' : 'previous')
  const base = readRun(baseLabel)
  const comparable = base && base.model === model && base.seed === SEED ? base : null
  const json = JSON.stringify(head, null, 2)
  writeFileSync(join(OUT_DIR, `${LABEL}.json`), json, 'utf8')
  writeFileSync(join(OUT_DIR, 'latest.json'), json, 'utf8')
  const report = formatReport(comparable, head)
  writeFileSync(join(OUT_DIR, `${LABEL}.md`), report, 'utf8')
  console.log(report)
  if (base && !comparable) console.warn(`Base ${baseLabel} used another model or seed; not compared.`)
  expect(comparable ? compareRuns(comparable, head).regressed : []).toEqual([])
})
