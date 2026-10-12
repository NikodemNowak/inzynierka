import { generate, measureFormattedPromptTokens } from './llm';
import { classifyNoteCategories } from './noteCategories';
import { processNoteWithLlm } from './noteProcessing';
import { extractTaskEvidence } from './taskExtraction';
import type { FinalTaskEvidence } from './processingContext';
import { projectSourceUnitPlan } from './sourceUnits';
import { setSummaryEngineMode } from './summaryEngine';

// These suites exercise the LLM-verified engine directly.
setSummaryEngineMode('verified');

jest.mock('./llm', () => ({
  generate: jest.fn(),
  isModelLoadedFor: () => true,
  loadModel: jest.fn(async () => undefined),
  measureFormattedPromptTokens: jest.fn(async ({systemPrompt = '', userPrompt}: {systemPrompt?: string; userPrompt: string}) =>
    Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12),
  getContextWindowSize: () => 8192,
  getLoadedModelInfo: () => null,
}));
jest.mock('./modelDownload', () => ({isModelDownloaded: async () => true, getModelPath: () => '/default.gguf'}));
jest.mock('./taskExtraction', () => ({extractTaskEvidence: jest.fn()}));
jest.mock('./noteCategories', () => ({
  ...jest.requireActual<typeof import('./noteCategories')>('./noteCategories'),
  classifyNoteCategories: jest.fn(async () => ['Praca']),
}));
jest.mock('./generationMetrics', () => ({recordGeneration: jest.fn()}));

const emptyProof = (): FinalTaskEvidence => ({tasks: [], evidence: [], superseded: [], warnings: []});
const modelResult = (text: string) => ({text, ttftMs: 1, tokensPerSecond: 20, wallMs: 2,
  promptMs: 1, predictedMs: 1, promptTokens: 10, predictedTokens: 3});
const fields = jest.fn<ReturnType<typeof generate>, Parameters<typeof generate>>();
let events: string[];

beforeEach(() => {
  jest.mocked(generate).mockReset();
  fields.mockReset();
  events = [];
  jest.mocked(generate).mockImplementation(async (prompt, onToken, options) => {
    const properties = (options?.jsonSchema?.properties ?? {}) as Record<string, unknown>;
    if ('rows' in properties) {
      events.push('relations');
      const payload = JSON.parse(prompt) as { sourceData: { source: string; text: string }[]; targetSources: string[] };
      // All 45 units are explicitly descriptive background without a decision
      // or an assignment. Discovery still sees the entire original catalog.
      expect(payload.sourceData).toHaveLength(45);
      return modelResult(JSON.stringify({ ...('format' in properties ? { format: 'bullets' } : {}),
        rows: payload.targetSources.map(source => ({ source, relatedEarlier: [], unresolved: false })) }));
    }
    if (Array.isArray(options?.jsonSchema?.anyOf)) {
      events.push('summary');
      // This suite tests category isolation; explicitly unverified summary data
      // must never become a source for the category or fallback title.
      return modelResult('{"invalid":true}');
    }
    return fields(prompt, onToken, options);
  });
  jest.mocked(classifyNoteCategories).mockClear();
  jest.mocked(classifyNoteCategories).mockResolvedValue(['Praca']);
  jest.mocked(extractTaskEvidence).mockReset().mockResolvedValue(emptyProof());
  jest.mocked(measureFormattedPromptTokens).mockClear();
});

test('classifies a short source using its final cleaned title rather than the model wire value', async () => {
  const source = 'The client report is due on Friday.';
  fields.mockResolvedValue(modelResult('Title: Client report'));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.title).toBe('Client report');
  expect(classifyNoteCategories).toHaveBeenCalledTimes(1);
  expect(jest.mocked(classifyNoteCategories).mock.calls[0]).toEqual([
    source, 'en', expect.objectContaining({taskEvidenceMemo: {}}), source,
    {title: result.title, summary: result.summary},
  ]);
});

test('passes the actual source fallback after both title proposals fail', async () => {
  const source = 'The invoice is due on Thursday.';
  fields.mockResolvedValueOnce(modelResult('Invented conference'))
    .mockResolvedValueOnce(modelResult('{"anchors":[1],"title":"Invented conference"}'));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.failedFields).toContain('title');
  expect(result.title).toBe('The invoice is due on Thursday');
  expect(jest.mocked(classifyNoteCategories).mock.calls[0]?.[4]).toEqual({title: result.title, summary: ''});
});

test('classifies the complete shared source once before task recovery evicts its prefix', async () => {
  const source = Array.from({length: 45}, (_, index) =>
    `The workshop discussion included background item ${index} about instruments lighting voices and examples while everyone shared observations without making a decision or assigning additional work.`).join(' ');
  fields.mockImplementation(async () => {
    events.push('title');
    return modelResult('Workshop discussion');
  });
  jest.mocked(classifyNoteCategories).mockImplementation(async () => {events.push('category'); return ['Praca'];});
  jest.mocked(extractTaskEvidence).mockImplementation(async (_content, _status, _language, _execution, afterInitialPass) => {
    events.push('initial');
    if (!afterInitialPass) throw new Error('The planned source should retain its category continuation');
    await afterInitialPass();
    await afterInitialPass();
    events.push('recovery');
    return emptyProof();
  });
  const sourceUnitPlan = projectSourceUnitPlan(source, source.replace(/\./gu, '..'))!;
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en', { sourceUnitPlan });
  expect(events.slice(0, 3)).toEqual(['initial', 'category', 'recovery']);
  expect(events.slice(3).filter(event => event !== 'relations')).toEqual(['summary', 'summary', 'title']);
  expect(events.slice(3, -3).every(event => event === 'relations')).toBe(true);
  expect(events.filter(event => event === 'relations').length).toBeGreaterThan(0);
  expect(classifyNoteCategories).toHaveBeenCalledTimes(1);
  expect(jest.mocked(classifyNoteCategories).mock.calls[0]).toEqual([
    source, 'en', expect.any(Object), source, undefined, 'tasks',
  ]);
  expect(result.tags).toEqual(['Praca']);
});

test('a category failure is reported once while recovered tasks and summary finish', async () => {
  const source = Array.from({length: 45}, (_, index) =>
    `The workshop discussion included background item ${index} about instruments lighting voices and examples while everyone shared observations without making a decision or assigning additional work.`).join(' ');
  fields.mockResolvedValue(modelResult('Workshop discussion'));
  jest.mocked(classifyNoteCategories).mockRejectedValue(new Error('Incomplete category generation'));
  jest.mocked(extractTaskEvidence).mockImplementation(async (_content, _status, _language, _execution, afterInitialPass) => {
    if (!afterInitialPass) throw new Error('Missing shared-source continuation');
    await afterInitialPass();
    return emptyProof();
  });
  const sourceUnitPlan = projectSourceUnitPlan(source, source.replace(/\./gu, '..'))!;
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en', { sourceUnitPlan });
  expect(classifyNoteCategories).toHaveBeenCalledTimes(1);
  expect(result.tags).toEqual([]);
  expect(result.failedFields?.filter(field => field === 'tags')).toHaveLength(1);
  expect(result.warnings?.filter(warning => warning === 'A category could not be determined.')).toHaveLength(1);
});
