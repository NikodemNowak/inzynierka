import { generate } from './llm'
import { processNoteWithLlm } from './noteProcessing'
import { classifyNoteCategories } from './noteCategories'
import { renderSummarySource } from './summarySelection'
import type { SummaryCheckTargets, SummaryDraft } from './summaryProtocol'

jest.mock('./llm', () => ({
  generate: jest.fn(),
  getLoadedModelInfo: () => null,
  measureFormattedPromptTokens: async ({ systemPrompt = '', userPrompt }: {
    systemPrompt?: string
    userPrompt: string
  }) => userPrompt.includes('SOURCE_START\n\nSOURCE_END') ? 100
    : userPrompt.includes('FIELD_TASK_START') ? 2200
      : Math.max(2000, Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12),
  getContextWindowSize: () => 8192,
}))
jest.mock('./modelReady', () => ({ ensureModelReady: jest.fn(async () => undefined) }))
jest.mock('./taskExtraction', () => ({
  extractTaskEvidence: jest.fn(async () => ({ tasks: [], evidence: [], superseded: [], warnings: [] })),
}))
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }))

const model = jest.mocked(generate)
const generated = (text: string) => ({
  text, ttftMs: 1, tokensPerSecond: 20, wallMs: 2,
  promptMs: 1, predictedMs: 1, promptTokens: 30, predictedTokens: 4,
})

beforeEach(() => model.mockReset())

const fixtures = [
  {
    language: 'en' as const,
    title: 'Workshop planning',
    statements: [
      'Workshop planning covers the venue, equipment, budget and programme for the community.',
      'Alice will send the programme to Bob by Friday after checking every session.',
      'The initial workshop budget was 900 dollars before the final supplier estimate.',
      'The final workshop budget is 1450 dollars and replaces the previous estimate.',
      'The north studio reservation was cancelled, so we must use the south studio.',
      'We must not buy new cameras because the existing equipment is sufficient.',
      'We discussed the previous workshop photographs as background examples for the programme.',
      'The next workshop review is November 8 at two in the afternoon.',
    ],
  },
  {
    language: 'pl' as const,
    title: 'Planowanie warsztatów',
    statements: [
      'Planowanie warsztatów obejmuje salę, wyposażenie, budżet oraz program spotkania lokalnej społeczności.',
      'Alicja wyśle program Bartkowi do piątku po sprawdzeniu wszystkich punktów spotkania.',
      'Początkowy budżet warsztatów wynosił 900 złotych przed ostateczną wyceną dostawcy.',
      'Ostateczny budżet warsztatów wynosi 1450 złotych i zastępuje wcześniejszą wycenę.',
      'Rezerwacja północnego studia została odwołana, więc musimy użyć południowego studia.',
      'Nie kupujmy nowych kamer, ponieważ posiadany sprzęt wystarczy do przeprowadzenia warsztatów.',
      'Omówiliśmy zdjęcia poprzednich warsztatów jako przykłady stanowiące tło planowanego programu.',
      'Następny przegląd warsztatów odbędzie się ósmego listopada o godzinie czternastej.',
    ],
  },
]

test.each(fixtures)('preserves complete literal source across independent grounded summary, title and category ($language)', async (fixture) => {
  const source = fixture.statements.join(' ')
  const draft: SummaryDraft = { format: 'bullets', points: [1, 2, 4, 5, 6, 8].map(id => ({
    text: fixture.statements[id - 1], sourceIds: [id],
  })) }
  model.mockImplementation(async (prompt, _token, options) => {
    const properties = (options?.jsonSchema?.properties ?? {}) as Record<string, unknown>
    if (Array.isArray(options?.jsonSchema?.anyOf)) return generated(JSON.stringify(draft))
    if ('units' in properties) {
      const payload = JSON.parse(prompt) as { checkTargetsData: SummaryCheckTargets }
      const targets = payload.checkTargetsData
      return generated(JSON.stringify({ points: targets.pointIds.map(pointId => ({ pointId, status: 'supported', issues: [] })),
        units: targets.sourceIds.map(sourceId => {
          const pointIds = draft.points.flatMap((point, index) => point.sourceIds.includes(sourceId) ? [index + 1] : [])
          return { sourceId, status: sourceId === 3 ? 'superseded' : sourceId === 7 ? 'context' : 'covered',
            pointIds, supersededBy: sourceId === 3 ? [4] : [] }
        }) }))
    }
    return generated('category' in properties ? '{"purposeId":1,"category":"Praca"}' : fixture.title)
  })

  const result = await processNoteWithLlm(source, () => undefined, undefined, fixture.language)
  expect(result.title).toBe(fixture.title)
  expect(result.tags).toEqual(['Praca'])
  expect(result.failedFields).toBeUndefined()
  expect(result.summary).toBe(draft.points.map(point => `• ${point.text}`).join('\n'))
  expect(result.summaryDocument?.source).toBe(source)
  expect(result.summary).not.toContain('900')
  const calls = model.mock.calls
  const numbered = renderSummarySource(source, source)
  const summaryCalls = calls.filter(([, , options]) => Array.isArray(options?.jsonSchema?.anyOf) ||
    'units' in ((options?.jsonSchema?.properties ?? {}) as object))
  for (const [prompt] of summaryCalls) {
    expect(JSON.parse(prompt).sourceCatalogData).toBe(numbered)
  }
  const titleCall = calls.find(([prompt]) => prompt.includes(fixture.language === 'en' ? 'Give a title' : 'Podaj tytuł'))!
  expect(titleCall[0]).toContain(`\nSOURCE_START\n${numbered}\nSOURCE_END`)
  expect(titleCall[2]?.jsonSchema).toBeUndefined()
  expect(titleCall[2]?.nPredict).toBe(40)
  const categoryCall = calls.find(([, , options]) => 'category' in ((options?.jsonSchema?.properties ?? {}) as object))!
  expect(categoryCall[2]?.jsonSchema).toMatchObject({
    required: ['purposeId', 'category'],
    properties: { purposeId: { enum: fixture.statements.map((_, index) => index + 1) },
      category: { enum: expect.arrayContaining(['Praca', 'brak']) } },
  })
  fixture.statements.forEach((statement, index) =>
    expect(categoryCall[0]).toContain(`[${index + 1}] ${statement}`))
  expect(categoryCall[0]).toContain('The FINAL task is category classification')
  expect(categoryCall[2]?.system).toContain(fixture.language === 'en'
    ? 'Extract only information explicitly present in the source'
    : 'Wydobywaj wyłącznie informacje obecne w źródle')
  expect(categoryCall[0]).toContain(`\nSOURCE_START\n${numbered}\nSOURCE_END`)
  expect(calls.filter(([, , options]) => Array.isArray(options?.jsonSchema?.anyOf))).toHaveLength(1)
  expect(calls.filter(([prompt]) => prompt.includes(fixture.language === 'en' ? 'Give a title' : 'Podaj tytuł'))).toHaveLength(1)
  expect(calls.filter(([, , options]) => 'category' in ((options?.jsonSchema?.properties ?? {}) as object))).toHaveLength(1)
})

test('standalone category classification preserves its established full-note request', async () => {
  const source = fixtures[0].statements.join(' ')
  model.mockResolvedValueOnce(generated('Praca'))
  await expect(classifyNoteCategories(source, 'en')).resolves.toEqual(['Praca'])
  const prompt = model.mock.calls[0][0]
  expect(prompt).toContain(`Text:\n"""\n${source}\n"""`)
  expect(model.mock.calls[0][2]?.system).toBe('Choose a topic category for an English note, returning only its exact Polish category ID.')
})

test('category classification restores complete statements from prepared evidence without losing owners, deadlines or negations', async () => {
  const source = fixtures[0].statements.join(' ')
  const fragments = [
    'will send the programme',
    'replaces the previous estimate',
    'reservation was cancelled',
    'buy new cameras',
  ]
  const prepared = fragments.map((quote, index) => {
    const start = source.indexOf(quote)
    return `[facts:metadata:${index}] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`
  }).join('\n')
  model.mockResolvedValueOnce(generated('Praca'))

  await expect(classifyNoteCategories(prepared, 'en', undefined, source)).resolves.toEqual(['Praca'])
  const prompt = model.mock.calls[0][0]
  const numbered = renderSummarySource(prepared, source)
  expect(prompt).toContain(`Text:\n"""\n${numbered}\n"""`)
  for (const index of [1, 3, 4, 5]) expect(prompt).toContain(fixtures[0].statements[index])
  expect(prompt).not.toContain('facts:metadata')
})

test('forged prepared evidence cannot reach category generation', async () => {
  const source = fixtures[0].statements.join(' ')
  const start = source.indexOf('We must not buy new cameras')
  const quote = 'We must buy new cameras'
  const prepared = `[facts:forged] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`
  await expect(classifyNoteCategories(prepared, 'en', undefined, source)).rejects.toThrow('offsets do not match')
  expect(model).not.toHaveBeenCalled()
})
