import { generate, getLoadedModelInfo, measureFormattedPromptTokens, type GenerationResult, type LoadedModelInfo } from './llm';
import { processNoteWithLlm } from './noteProcessing';
import { extractTaskEvidence } from './taskExtraction';
import { parseSummaryDocument } from '../domain/summary';
import { createSummarySources } from './summarySources';
import { summaryDraftSchema, summaryVerificationPageRequest, summaryRelationPageRequest,
  type SummaryCheckTargets, type SummaryDraft, type SummaryVerification } from './summaryProtocol';
import type { SummarySourceUnit } from './summarySources';
import type { FinalTaskEvidence, ProcessingExecutionContext } from './processingContext';
import { projectSourceUnitPlan, type SourceUnitPlan } from './sourceUnits';
import { MODEL_CONFIG } from './modelConfig';

jest.mock('./llm', () => ({
  generate: jest.fn(), isModelLoadedFor: () => true, loadModel: jest.fn(),
  getLoadedModelInfo: jest.fn(() => null), getContextWindowSize: () => 8192,
  measureFormattedPromptTokens: jest.fn(async () => 100),
}));
jest.mock('./modelDownload', () => ({ isModelDownloaded: async () => true, getModelPath: () => '/default.gguf' }));
jest.mock('./taskExtraction', () => ({ extractTaskEvidence: jest.fn() }));
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);
const generated = (value: unknown): GenerationResult => ({ text: JSON.stringify(value), ttftMs: 1,
  tokensPerSecond: 20, wallMs: 2, promptMs: 1, predictedMs: 1, promptTokens: 10, predictedTokens: 10 });
const emptyProof: FinalTaskEvidence = { tasks: [], evidence: [], superseded: [], warnings: [] };
const checked = (pointCount: number, links: readonly (readonly number[])[]): SummaryVerification => ({
  points: Array.from({ length: pointCount }, (_, index) => ({ pointId: index + 1, status: 'supported', issues: [] })),
  units: links.map((pointIds, index) => ({ sourceId: index + 1, status: pointIds.length ? 'covered' : 'context', pointIds, supersededBy: [] })),
});

const fixturePage = (prompt: string, schema: unknown, units: readonly SummarySourceUnit[], draft: SummaryDraft,
  verification: SummaryVerification, proof?: FinalTaskEvidence): SummaryVerification => {
  const payload = JSON.parse(prompt) as { checkTargetsData: SummaryCheckTargets };
  const targets = payload.checkTargetsData;
  if (!targets || !Array.isArray(targets.pointIds) || !Array.isArray(targets.sourceIds) ||
    targets.pointIds.length + targets.sourceIds.length === 0) throw new Error('Malformed summary page targets');
  // The protocol builder rejects duplicate/out-of-scope targets. This mock is
  // bound to a named semantic fixture; it never invents a supported verdict.
  const wire = summaryVerificationPageRequest(units, draft, targets, 'en', proof);
  expect(schema).toEqual(wire.schema);
  expect(JSON.parse(prompt)).toEqual({
    sourceCatalogData: units.map(unit => `[${unit.id}] ${unit.text}`).join('\n'),
    draftData: { format: draft.format, points: draft.points.map((point, index) => ({ pointId: index + 1, ...point })) },
    sourcePointLinksData: units.map(unit => ({ sourceId: unit.id,
      citingPointIds: draft.points.flatMap((point, index) => point.sourceIds.includes(unit.id) ? [index + 1] : []) })),
    checkTargetsData: targets, ...(proof ? { taskEvidenceData: proof } : {}),
  });
  return { points: verification.points.filter(point => targets.pointIds.includes(point.pointId)),
    units: verification.units.filter(unit => targets.sourceIds.includes(unit.sourceId)) };
};

// Only the native model transport is scripted. Protocol parsing, verification,
// source resolution, canonical rendering and note orchestration remain real.
const script = (source: string, title: string, draft: SummaryDraft | null, verification?: SummaryVerification,
  plan?: SourceUnitPlan): void => {
  const units = createSummarySources(source, plan);
  model.mockImplementation(async (prompt, _onToken, options) => {
    const schema = options?.jsonSchema;
    if (JSON.stringify(schema) === JSON.stringify(summaryDraftSchema(units))) {
      expect(JSON.parse(prompt).sourceCatalogData).toBe(units.map(unit => `[${unit.id}] ${unit.text}`).join('\n'));
      return generated(draft ?? { invalid: true });
    }
    if (draft && verification && 'units' in ((schema?.properties ?? {}) as object)) {
      return generated(fixturePage(prompt, schema, units, draft, verification,
        source.trim().split(/\s+/u).length >= 30 ? emptyProof : undefined));
    }
    if (prompt.includes('Give a title') || prompt.includes('Podaj tytuł')) return generated(title);
    if (prompt.includes('purposeId')) return generated({ purposeId: 1, category: 'Praca' });
    throw new Error('Unexpected model request kind');
  });
};

beforeEach(() => {
  model.mockReset();
  jest.mocked(extractTaskEvidence).mockReset().mockResolvedValue(emptyProof);
  jest.mocked(getLoadedModelInfo).mockReturnValue(null);
  jest.mocked(measureFormattedPromptTokens).mockReset().mockResolvedValue(100);
});

test('summarizes a short practical note even though its independent task pass is skipped', async () => {
  const source = 'On Friday I have no classes.';
  script(source, 'Friday classes', { format: 'bullets', points: [{ text: 'Friday: no classes.', sourceIds: [1] }] }, checked(1, [[1]]));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.summary).toBe('• Friday: no classes.');
  expect(result.summaryDocument).toEqual({ version: 1, source, format: 'bullets',
    points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 28 }] }] });
  expect(result.failedFields).toBeUndefined();
  expect(extractTaskEvidence).not.toHaveBeenCalled();
});

test('does not publish a failed summary while independently valid title and category survive', async () => {
  const source = 'On Friday I have no classes.';
  script(source, 'Friday classes', null);
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result).toMatchObject({ title: 'Friday classes', tags: ['Praca'], summary: '', summaryDocument: null, failedFields: ['summary'] });
  expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('could not be verified')]));
});

test.each([
  { language: 'pl' as const, source: 'W poniedziałek pokażę aplikację. Ola sprawdzi raport do wtorku. W piątek nie mam zajęć.', title: 'Aplikacja i raport',
    texts: ['Poniedziałek: pokaz aplikacji.', 'Ola: sprawdzenie raportu do wtorku.', 'Piątek: brak zajęć.'],
    expected: '• Poniedziałek: pokaz aplikacji.\n• Ola: sprawdzenie raportu do wtorku.\n• Piątek: brak zajęć.' },
  { language: 'en' as const, source: 'On Monday I will show the application. Ola will check the report by Tuesday. On Friday I have no classes.', title: 'Application and report',
    texts: ['Monday: application demonstration.', 'Ola: report check by Tuesday.', 'Friday: no classes.'],
    expected: '• Monday: application demonstration.\n• Ola: report check by Tuesday.\n• Friday: no classes.' },
])('retains all dense practical $language facts as compact bullets with exact full source', async fixture => {
  script(fixture.source, fixture.title, { format: 'bullets', points: fixture.texts.map((text, index) => ({ text, sourceIds: [index + 1] })) }, checked(3, [[1], [2], [3]]));
  const result = await processNoteWithLlm(fixture.source, () => undefined, undefined, fixture.language);
  expect(result.summary).toBe(fixture.expected);
  expect(result.summaryDocument?.source).toBe(fixture.source);
  expect(parseSummaryDocument(result.summaryDocument, fixture.source, fixture.expected)).not.toBeNull();
  expect(result.failedFields).toBeUndefined();
  expect(extractTaskEvidence).not.toHaveBeenCalled();
});

test('uses concise connected prose for reflection rather than extracting entire sentences', async () => {
  const source = 'Walking by the river helped me slow down. I noticed that quiet time matters more to me than a busy schedule. I still do not know how to make room for it.';
  const draft: SummaryDraft = { format: 'paragraph', points: [
    { text: 'The river walk brought calm.', sourceIds: [1] },
    { text: 'Quiet time matters more than a busy schedule, though making room for it remains unresolved.', sourceIds: [2, 3] },
  ] };
  script(source, 'Quiet time', draft, checked(2, [[1], [2], [2]]));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.summary).toBe('The river walk brought calm. Quiet time matters more than a busy schedule, though making room for it remains unresolved.');
  expect(result.summaryDocument?.format).toBe('paragraph');
  expect(result.summaryDocument?.source).toBe(source);
  expect(result.failedFields).toBeUndefined();
});

test('groups developed topics while preserving conditions, negatives and completed actions', async () => {
  const source = 'The workshop report is due on Friday and Alice will review it on Monday. The final workshop budget is 1450 dollars and we must not buy any new cameras. The garden seedlings need water every morning during the dry week. I have already repaired the garden gate, but the fence may need painting if the rain stops.';
  const draft: SummaryDraft = { format: 'grouped', points: [
    { group: 'Workshop', text: 'Report by Friday; Alice reviews it on Monday.', sourceIds: [1] },
    { group: 'Workshop', text: 'Final budget: 1450 dollars; no new cameras.', sourceIds: [2] },
    { group: 'Garden', text: 'Water seedlings each morning during the dry week.', sourceIds: [3] },
    { group: 'Garden', text: 'Gate repaired; fence painting remains possible if the rain stops.', sourceIds: [4] },
  ] };
  script(source, 'Workshop and garden', draft, checked(4, [[1], [2], [3], [4]]));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.summary).toBe('Workshop\n• Report by Friday; Alice reviews it on Monday.\n• Final budget: 1450 dollars; no new cameras.\n\nGarden\n• Water seedlings each morning during the dry week.\n• Gate repaired; fence painting remains possible if the rain stops.');
  expect(result.summaryDocument?.source).toBe(source);
  expect(result.failedFields).toBeUndefined();
});

test('distinguishes a verified empty filler result from semantic failure', async () => {
  const source = 'Well, um, that is all.';
  script(source, 'Well', { format: 'bullets', points: [] }, checked(0, [[]]));
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result).toMatchObject({ summary: '', summaryDocument: null });
  expect(result.failedFields ?? []).not.toContain('summary');
  expect(result.warnings ?? []).not.toContain('The summary could not be verified. Your complete transcript has been kept.');
});

test.each(['transport', 'tokenizer', 'checkpoint'] as const)('propagates summary %s infrastructure failure', async kind => {
  const source = 'On Friday I have no classes.';
  script(source, 'Friday classes', { format: 'bullets', points: [{ text: 'Friday: no classes.', sourceIds: [1] }] }, checked(1, [[1]]));
  const error = new Error(`${kind} unavailable`);
  const execution: ProcessingExecutionContext = {};
  if (kind === 'transport') model.mockRejectedValue(error);
  if (kind === 'tokenizer') jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ userPrompt }) => {
    if (userPrompt.startsWith('{"sourceCatalogData"')) throw error;
    return 100;
  });
  if (kind === 'checkpoint') execution.checkpoint = { read: async () => null, write: async () => { throw error; } };
  await expect(processNoteWithLlm(source, () => undefined, undefined, 'en', execution)).rejects.toBe(error);
});

test('rejects cancellation from the summary progress callback before native completion', async () => {
  const controller = new AbortController();
  await expect(processNoteWithLlm('On Friday I have no classes.', progress => {
    if (progress.phase === 'summary') controller.abort();
  }, undefined, 'en', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(model).not.toHaveBeenCalled();
});

test('propagates a loaded-runtime replacement during summary budgeting', async () => {
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ userPrompt }) => {
    if (userPrompt.startsWith('{"sourceCatalogData"')) {
      jest.mocked(getLoadedModelInfo).mockReturnValue({ modelPath: '/replacement.gguf' } as unknown as LoadedModelInfo);
    }
    return 100;
  });
  await expect(processNoteWithLlm('On Friday I have no classes.', () => undefined, undefined, 'en')).rejects.toThrow('Summary runtime changed');
  expect(model).not.toHaveBeenCalled();
});

test.each(['checkpoint', 'signal', 'runtimeOptions'].flatMap(owner =>
  ['completion', 'fragment'].map(boundary => ({ owner, boundary })),
))('rejects $owner replacement during adopted-plan reduction at $boundary without further writes or publication', async ({ owner, boundary }) => {
  const loadedModel: LoadedModelInfo = { modelPath: '/default.gguf', model: MODEL_CONFIG,
    execution: 'foreground', speculative: false, gpu: false, devices: [],
    reasonNoGPU: '', systemInfo: 'test runtime', metadata: {} };
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedModel);
  const source = 'I will prepare the detailed workshop report with measurements and observations by Friday Alice will check the complete workshop report on Monday On Friday I have no classes at the university';
  const punctuated = 'I will prepare the detailed workshop report with measurements and observations by Friday. Alice will check the complete workshop report on Monday. On Friday I have no classes at the university.';
  const plan = projectSourceUnitPlan(source, punctuated)!;
  script(source, 'Workshop report', { format: 'bullets', points: [
    { text: 'Workshop report with measurements and observations by Friday.', sourceIds: [1] },
    { text: 'Alice: complete workshop report check on Monday.', sourceIds: [2] },
    { text: 'Friday: no university classes.', sourceIds: [3] },
  ] }, checked(3, [[1], [2], [3]]), plan);
  // Full title/category requests cannot fit; each complete planned statement
  // can. This exercises real plan adoption and multi-fragment facts collection.
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ userPrompt }) =>
    !userPrompt.includes('(fact; importance') && [...userPrompt.matchAll(/^\[\d+\] /gmu)].length > 1 ? 9000 : 100);
  const oldStore = { read: jest.fn(async () => null), write: jest.fn(async (_key: string, _value: unknown) => undefined) };
  const newStore = { read: jest.fn(async () => null), write: jest.fn(async (_key: string, _value: unknown) => undefined) };
  const execution: ProcessingExecutionContext = { checkpoint: oldStore, signal: new AbortController().signal,
    runtimeOptions: { modelPath: '/default.gguf' }, taskEvidenceMemo: {} };
  let replaced = false;
  let writesAtReplacement = -1;
  let callsAtReplacement = -1;
  const replaceOwner = (): void => {
    replaced = true;
    writesAtReplacement = oldStore.write.mock.calls.length;
    callsAtReplacement = model.mock.calls.length;
    if (owner === 'checkpoint') execution.checkpoint = newStore;
    if (owner === 'signal') execution.signal = new AbortController().signal;
    if (owner === 'runtimeOptions') execution.runtimeOptions = { modelPath: '/replacement.gguf' };
  };
  let factStarted!: () => void;
  const started = new Promise<void>(resolve => { factStarted = resolve; });
  let releaseFact!: () => void;
  const completion = new Promise<void>(resolve => { releaseFact = resolve; });
  let factCalls = 0;
  const native = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => {
    if (!options?.jsonSchema && options?.nPredict === 512 && prompt.endsWith(source))
      return { ...generated(null), text: punctuated };
    if (options?.jsonSchema?.required?.toString() === 'facts') {
      const literal = prompt.match(/SOURCE_START\n([\s\S]*?)\nSOURCE_END/)?.[1];
      expect(literal).toBeDefined();
      const ids = [...literal!.matchAll(/^\[(\d+)\] /gmu)].map(match => Number(match[1]));
      expect(ids).toHaveLength(1);
      if (++factCalls === 1 && boundary === 'completion') {
        factStarted();
        await completion;
      }
      return generated({ facts: ids });
    }
    if (options?.jsonSchema?.required?.toString() === 'ids') {
      const ids = [...prompt.matchAll(/^\[([^\]]+)\] \(fact; importance/gmu)].map(match => match[1]);
      expect(ids.length).toBeGreaterThan(0);
      return generated({ ids: ids.slice(0, 1) });
    }
    return native(prompt, onToken, options);
  });
  const publishNote = jest.fn();
  const publishTaskRows = jest.fn();
  const processing = processNoteWithLlm(source, progress => {
    if (boundary === 'fragment' && progress.phase === 'fragment' && !replaced) {
      expect(progress).toMatchObject({ completed: 1, total: 3 });
      replaceOwner();
    }
  }, undefined, 'en', execution).then(result => {
    publishNote(result);
    publishTaskRows(execution.taskEvidenceMemo?.completed?.result.tasks);
    return result;
  });
  if (boundary === 'completion') {
    await started;
    replaceOwner();
    releaseFact();
  }
  await expect(processing).rejects.toThrow('Task evidence runtime changed during processing');
  expect(replaced).toBe(true);
  expect(factCalls).toBe(1);
  expect(model.mock.calls.length).toBe(callsAtReplacement);
  // Structuring checkpoints and the already-completed first fragment remain
  // durable; changing ownership must prevent every subsequent write/pass.
  expect(oldStore.write.mock.calls.length).toBe(writesAtReplacement);
  expect(oldStore.write.mock.calls.filter(([key]) => String(key).startsWith('facts:'))).toHaveLength(boundary === 'fragment' ? 1 : 0);
  expect(newStore.write).not.toHaveBeenCalled();
  expect(extractTaskEvidence).not.toHaveBeenCalled();
  expect(execution.taskEvidenceMemo?.completed).toBeUndefined();
  expect(publishNote).not.toHaveBeenCalled();
  expect(publishTaskRows).not.toHaveBeenCalled();
  expect(getLoadedModelInfo()).toBe(loadedModel);
});

test('retains explicit central-topic evidence in the title request after removing the shared summary envelope', async () => {
  const source = 'The central object is an archive of garden descriptions. A marine biology exhibition was only an incidental example of reusing descriptions in a public display. We also discussed lighting and atmosphere as supporting background.';
  script(source, 'Garden descriptions archive', { format: 'bullets', points: [
    { text: 'Central object: garden descriptions archive.', sourceIds: [1] },
    { text: 'Marine biology exhibition: incidental reuse example; lighting and atmosphere are supporting background.', sourceIds: [2, 3] },
  ] }, checked(2, [[1], [2], [2]]));
  const native = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => {
    if (prompt.includes('Give a title')) {
      expect(prompt).toContain('EXPLICIT_TOPIC_DECLARATION_DATA_JSON');
      expect(prompt).toContain('"quote":"The central object is an archive of garden descriptions."');
    }
    return native(prompt, onToken, options);
  });
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.title).toBe('Garden descriptions archive');
  expect(result.failedFields).toBeUndefined();
});

test('still rewrites a generic note label into an anchored source topic', async () => {
  const source = 'This note is about workshop reports. Alice will prepare the report by Friday with the current measurements and all available observations. We also discussed workshop lighting without changing the report deadline.';
  script(source, 'Note', { format: 'bullets', points: [
    { text: 'Workshop reports.', sourceIds: [1] },
    { text: 'Alice: report with measurements and observations by Friday.', sourceIds: [2] },
    { text: 'Lighting discussed; report deadline unchanged.', sourceIds: [3] },
  ] }, checked(3, [[1], [2], [3]]));
  const native = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => {
    if ('anchors' in ((options?.jsonSchema?.properties ?? {}) as object)) return generated({ anchors: [1], title: 'Workshop reports' });
    return native(prompt, onToken, options);
  });
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.title).toBe('Workshop reports');
  expect(result.failedFields).toBeUndefined();
});

test('passes a freshly adopted speech plan with the exact original content to summary generation', async () => {
  const source = 'I will prepare the detailed workshop report with measurements and observations by Friday Alice will check the complete workshop report on Monday On Friday I have no classes at the university';
  const punctuated = 'I will prepare the detailed workshop report with measurements and observations by Friday. Alice will check the complete workshop report on Monday. On Friday I have no classes at the university.';
  const plan = projectSourceUnitPlan(source, punctuated)!;
  expect(plan).not.toBeNull();
  script(source, 'Workshop report', { format: 'bullets', points: [
    { text: 'Workshop report with measurements and observations by Friday.', sourceIds: [1] },
    { text: 'Alice: complete workshop report check on Monday.', sourceIds: [2] },
    { text: 'Friday: no university classes.', sourceIds: [3] },
  ] }, checked(3, [[1], [2], [3]]), plan);
  const native = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => {
    if (!options?.jsonSchema && options?.nPredict === 512 && prompt.endsWith(source)) return { ...generated(null), text: punctuated };
    return native(prompt, onToken, options);
  });
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en');
  expect(result.summary).toBe('• Workshop report with measurements and observations by Friday.\n• Alice: complete workshop report check on Monday.\n• Friday: no university classes.');
  expect(result.summaryDocument?.source).toBe(source);
  expect(result.summaryDocument?.points.map(point => point.sources.map(range => source.slice(range.start, range.end)))).toEqual([
    ['I will prepare the detailed workshop report with measurements and observations by Friday'],
    ['Alice will check the complete workshop report on Monday'],
    ['On Friday I have no classes at the university'],
  ]);
  expect(result.failedFields).toBeUndefined();
  const taskExecution = jest.mocked(extractTaskEvidence).mock.calls[0][3];
  expect(taskExecution?.sourceUnitPlan).toEqual(plan);
});

test.each([
  { language: 'pl' as const, title: 'Raport i sadzonki', source: [
    'Raport z warsztatów mam przygotować do piątku, uwzględniając aktualne pomiary, obserwacje i ograniczenia użytej aplikacji.',
    'Alicja sprawdzi raport w poniedziałek, korzystając z zatwierdzonej listy kontrolnej oraz oryginalnych wyników pomiarów.',
    'Końcowy budżet warsztatów wynosi 1450 złotych i nie kupimy żadnych nowych kamer, ponieważ istniejący sprzęt wystarczy.',
    'Spotkanie dotyczące warsztatów odbędzie się 8 listopada o godzinie 14:00, a liczba uczestników nadal pozostaje nieustalona.',
    'Sadzonki w ogrodzie trzeba podlewać każdego ranka podczas suchego tygodnia, żeby ziemia nie wysychała zbyt szybko.',
    'Bramę ogrodu już naprawiłem, ale ogrodzenie może wymagać malowania tylko jeśli deszcz przestanie padać.',
    'Marta może przywieźć dodatkowe sadzonki we wtorek, jeśli dostawca potwierdzi ich dostępność do poniedziałku.',
    'Na zimę nie planujemy nowych nasadzeń, ponieważ wolimy najpierw sprawdzić, czy obecne rośliny dobrze się przyjmą.',
  ].join(' '), texts: [
    'Raport z pomiarami, obserwacjami i ograniczeniami aplikacji do piątku.',
    'Alicja: sprawdzenie raportu w poniedziałek z listą kontrolną i oryginalnymi wynikami.',
    'Końcowy budżet: 1450 zł; istniejący sprzęt wystarczy, bez nowych kamer.',
    'Spotkanie: 8 listopada, 14:00; liczba uczestników nieustalona.',
    'Podlewanie sadzonek co rano w suchym tygodniu, aby ziemia nie wysychała.',
    'Brama naprawiona; możliwe malowanie ogrodzenia, tylko jeśli przestanie padać.',
    'Marta: możliwe sadzonki we wtorek, jeśli dostawca potwierdzi dostępność do poniedziałku.',
    'Bez nowych nasadzeń zimą; najpierw sprawdzenie obecnych roślin.',
  ], groups: ['Warsztaty', 'Ogród'], ranges: [[0, 122], [123, 242], [243, 361], [362, 485], [486, 600], [601, 704], [705, 813], [814, 927]],
    expected: 'Warsztaty\n• Raport z pomiarami, obserwacjami i ograniczeniami aplikacji do piątku.\n• Alicja: sprawdzenie raportu w poniedziałek z listą kontrolną i oryginalnymi wynikami.\n• Końcowy budżet: 1450 zł; istniejący sprzęt wystarczy, bez nowych kamer.\n• Spotkanie: 8 listopada, 14:00; liczba uczestników nieustalona.\n\nOgród\n• Podlewanie sadzonek co rano w suchym tygodniu, aby ziemia nie wysychała.\n• Brama naprawiona; możliwe malowanie ogrodzenia, tylko jeśli przestanie padać.\n• Marta: możliwe sadzonki we wtorek, jeśli dostawca potwierdzi dostępność do poniedziałku.\n• Bez nowych nasadzeń zimą; najpierw sprawdzenie obecnych roślin.' },
  { language: 'en' as const, title: 'Workshop and garden', source: [
    'I will prepare the workshop report by Friday, including current measurements, observations and limitations of the application we used.',
    'Alice will review the report on Monday using the approved checklist and the original results of the measurements.',
    'The final workshop budget is 1450 dollars and we must not buy any new cameras because the existing equipment is sufficient.',
    'The workshop meeting is on November 8 at 14:00, while the number of participants is still undecided.',
    'The garden seedlings need water every morning during the dry week so that the soil does not dry out too quickly.',
    'I have already repaired the garden gate, but the fence may need painting only if the rain stops.',
    'Marta may bring additional seedlings on Tuesday if the supplier confirms their availability by Monday.',
    'We are not planning new planting for winter because we want to check whether the current plants establish themselves first.',
  ].join(' '), texts: [
    'Report with measurements, observations and application limitations by Friday.',
    'Alice: report review on Monday with the checklist and original results.',
    'Final budget: 1450 dollars; existing equipment is sufficient, no new cameras.',
    'Meeting: November 8, 14:00; participant count undecided.',
    'Water seedlings each morning during the dry week to keep the soil moist.',
    'Gate repaired; possible fence painting only if the rain stops.',
    'Marta: possible seedlings on Tuesday if the supplier confirms availability by Monday.',
    'No new winter planting; check the current plants first.',
  ], groups: ['Workshop', 'Garden'], ranges: [[0, 134], [135, 248], [249, 372], [373, 473], [474, 586], [587, 683], [684, 786], [787, 910]],
    expected: 'Workshop\n• Report with measurements, observations and application limitations by Friday.\n• Alice: report review on Monday with the checklist and original results.\n• Final budget: 1450 dollars; existing equipment is sufficient, no new cameras.\n• Meeting: November 8, 14:00; participant count undecided.\n\nGarden\n• Water seedlings each morning during the dry week to keep the soil moist.\n• Gate repaired; possible fence painting only if the rain stops.\n• Marta: possible seedlings on Tuesday if the supplier confirms availability by Monday.\n• No new winter planting; check the current plants first.' },
])('keeps longer grouped $language facts and adaptive summary output budgets', async fixture => {
  const draft: SummaryDraft = { format: 'grouped', points: fixture.texts.map((text, index) => ({
    text, sourceIds: [index + 1], group: fixture.groups[index < 4 ? 0 : 1],
  })) };
  script(fixture.source, fixture.title, draft, checked(8, [[1], [2], [3], [4], [5], [6], [7], [8]]));
  const result = await processNoteWithLlm(fixture.source, () => undefined, undefined, fixture.language);
  expect(result.summary).toBe(fixture.expected);
  expect(result.summaryDocument).toEqual({ version: 1, source: fixture.source, format: 'grouped',
    points: draft.points.map((point, index) => ({ text: point.text, group: point.group,
      sources: [{ start: fixture.ranges[index][0], end: fixture.ranges[index][1] }] })),
  });
  expect(result.summaryDocument?.source).toBe(fixture.source);
  expect(parseSummaryDocument(result.summaryDocument, fixture.source, fixture.expected)).not.toBeNull();
  expect(result.failedFields).toBeUndefined();
  const requests = model.mock.calls.filter(([, , options]) => options?.jsonSchema &&
    (Array.isArray(options.jsonSchema.anyOf) || 'units' in ((options.jsonSchema.properties ?? {}) as object)));
  expect(requests.filter(([, , options]) => Array.isArray(options!.jsonSchema!.anyOf))).toHaveLength(1);
  const pages = requests.filter(([, , options]) => 'units' in ((options!.jsonSchema!.properties ?? {}) as object));
  expect(pages.length).toBeGreaterThan(1);
  const targets = pages.map(([prompt]) => (JSON.parse(prompt) as { checkTargetsData: SummaryCheckTargets }).checkTargetsData);
  expect(targets.flatMap(target => target.pointIds).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(targets.flatMap(target => target.sourceIds).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(requests.every(([, , options]) => options!.nPredict! > 1024)).toBe(true);
  expect(requests.every(([, , options]) => 100 + options!.nPredict! + 24 <= 8192)).toBe(true);
});

test('keeps cancellation, negation and deadline through actual processing with multiple admitted summary windows', async () => {
  const sentences = [
    'The Friday launch is confirmed.',
    'The budget is 20 dollars.',
    'I have already checked the room.',
    'The Friday launch is cancelled.',
    'Lea must not send the description.',
    'Nora will send the measurements by Wednesday.',
  ];
  const source = sentences.join(' ');
  const finalDraft: SummaryDraft = { format: 'bullets', points: [
    { text: 'Friday launch cancelled.', sourceIds: [1, 4] },
    { text: 'Budget: 20 dollars.', sourceIds: [2] },
    { text: 'Room already checked.', sourceIds: [3] },
    { text: 'Lea must not send the description.', sourceIds: [5] },
    { text: 'Nora: measurements by Wednesday.', sourceIds: [6] },
  ] };
  const finalVerification: SummaryVerification = { points: checked(5, []).points, units: [
    { sourceId: 1, status: 'superseded', pointIds: [], supersededBy: [4] },
    { sourceId: 2, status: 'covered', pointIds: [2], supersededBy: [] },
    { sourceId: 3, status: 'covered', pointIds: [3], supersededBy: [] },
    { sourceId: 4, status: 'covered', pointIds: [1], supersededBy: [] },
    { sourceId: 5, status: 'covered', pointIds: [4], supersededBy: [] },
    { sourceId: 6, status: 'covered', pointIds: [5], supersededBy: [] },
  ] };
  // Force two-original local windows. Discovery still measures its whole raw source.
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ systemPrompt = '', userPrompt }) => {
    const payload = userPrompt.startsWith('{') ? JSON.parse(userPrompt) as { sourceCatalogData?: string; draftData?: unknown; reconciliationData?: unknown; repairData?: unknown } : {};
    return payload.sourceCatalogData && !payload.draftData && !payload.reconciliationData && !payload.repairData && payload.sourceCatalogData.split('\n').length > 2
      ? 9000 : Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12;
  });
  script(source, 'Friday launch', finalDraft, finalVerification);
  const ordinaryTransport = model.getMockImplementation()!;
  const units = createSummarySources(source);
  const sourceCatalog = (ids: readonly number[]): string => units.filter(unit => ids.includes(unit.id)).map(unit => `[${unit.id}] ${unit.text}`).join('\n');
  const localFixtures: readonly { ids: readonly number[]; draft: SummaryDraft; verification: SummaryVerification }[] = [
    { ids: [1, 2], draft: { format: 'bullets', points: [{ text: 'Friday launch confirmed.', sourceIds: [1] }, finalDraft.points[1]] }, verification: checked(2, [[1], [2]]) },
    { ids: [3, 4], draft: { format: 'bullets', points: [finalDraft.points[2], { text: 'Friday launch cancelled.', sourceIds: [4] }] }, verification: {
      points: checked(2, []).points, units: [
        { sourceId: 3, status: 'covered', pointIds: [1], supersededBy: [] },
        { sourceId: 4, status: 'covered', pointIds: [2], supersededBy: [] },
      ],
    } },
    { ids: [5, 6], draft: { format: 'bullets', points: finalDraft.points.slice(3) }, verification: {
      points: checked(2, []).points, units: [
        { sourceId: 5, status: 'covered', pointIds: [1], supersededBy: [] },
        { sourceId: 6, status: 'covered', pointIds: [2], supersededBy: [] },
      ],
    } },
  ];
  const correctedFixture = (ids: readonly number[]) => {
    const pointIndices = finalDraft.points.flatMap((point, index) => point.sourceIds.some(id => ids.includes(id)) ? [index] : []);
    return { ids, draft: { format: 'bullets' as const, points: pointIndices.map(index => finalDraft.points[index]) },
      verification: { points: pointIndices.map((index, local) => ({ ...finalVerification.points[index], pointId: local + 1 })),
        units: finalVerification.units.filter(unit => ids.includes(unit.sourceId)).map(unit => ({ ...unit,
          pointIds: unit.pointIds.map(globalPoint => pointIndices.indexOf(globalPoint - 1) + 1),
        })) } };
  };
  const reconciliation = correctedFixture([1, 4]);
  const reviewFixtures = [...localFixtures, reconciliation, correctedFixture([1, 2, 4]), correctedFixture([1, 3, 4])];
  let discoveryCalls = 0, localDraftCalls = 0, reconciliationCalls = 0;
  const governingChecks: string[] = [];
  model.mockImplementation(async (prompt, token, options) => {
    const measured = await measureFormattedPromptTokens({ systemPrompt: options?.system, userPrompt: prompt, jsonSchema: options?.jsonSchema });
    expect(measured + (options?.nPredict ?? 0) + 24).toBeLessThanOrEqual(8192);
    const payload = prompt.startsWith('{') ? JSON.parse(prompt) as Record<string, unknown> : {};
    if (payload.sourceData) {
      expect(localDraftCalls).toBe(0);
      const targetSources = payload.targetSources as string[];
      const ids = targetSources.map(ref => Number(ref.slice(1)));
      const includeFormat = discoveryCalls === 0;
      expect(options?.jsonSchema).toEqual(summaryRelationPageRequest(units, ids, 'en', includeFormat).schema);
      expect(payload).toEqual({ sourceData: sentences.map((text, index) => ({ source: `S${index + 1}`, text })), targetSources });
      discoveryCalls += 1;
      return generated({ ...(includeFormat ? { format: 'bullets' } : {}), rows: targetSources.map(ref => ({
        source: ref, relatedEarlier: ref === 'S4' ? ['S1'] : [], unresolved: false,
      })) });
    }
    if (payload.draftData) {
      const fixture = reviewFixtures.find(candidate => sourceCatalog(candidate.ids) === payload.sourceCatalogData);
      if (!fixture) throw new Error('Verifier scope is outside the named cancellation fixture');
      if (fixture.ids.includes(1) && fixture.ids.includes(4)) {
        expect(payload.sourceCatalogData).toContain('[1] The Friday launch is confirmed.');
        expect(payload.sourceCatalogData).toContain('[4] The Friday launch is cancelled.');
        governingChecks.push(fixture.ids.join(','));
      }
      return generated(fixturePage(prompt, options?.jsonSchema, units.filter(unit => fixture.ids.includes(unit.id)), fixture.draft, fixture.verification, emptyProof));
    }
    if (payload.reconciliationData) {
      expect(payload.sourceCatalogData).toBe(sourceCatalog([1, 4]));
      expect(payload.reconciliationData).toEqual({ format: 'bullets', points: [localFixtures[0].draft.points[0], localFixtures[1].draft.points[1]] });
      expect(options?.jsonSchema).toEqual(summaryDraftSchema(units.filter(unit => [1, 4].includes(unit.id)), 'bullets'));
      reconciliationCalls += 1;
      return generated(reconciliation.draft);
    }
    if (payload.sourceCatalogData) {
      expect(discoveryCalls).toBeGreaterThan(0);
      const fixture = localFixtures.find(candidate => sourceCatalog(candidate.ids) === payload.sourceCatalogData);
      if (!fixture || payload.repairData) throw new Error('Draft request is outside the named local fixtures');
      expect(options?.jsonSchema).toEqual(summaryDraftSchema(units.filter(unit => fixture.ids.includes(unit.id)), 'bullets'));
      localDraftCalls += 1;
      return generated(fixture.draft);
    }
    return ordinaryTransport(prompt, token, options);
  });
  const checkpointData = new Map<string, unknown>();
  const result = await processNoteWithLlm(source, () => undefined, undefined, 'en', { checkpoint: {
    read: async key => checkpointData.get(key) ?? null,
    write: async (key, value) => { checkpointData.set(key, value); },
  } });
  expect(result.summary).toBe('• Friday launch cancelled.\n• Budget: 20 dollars.\n• Room already checked.\n• Lea must not send the description.\n• Nora: measurements by Wednesday.');
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(discoveryCalls).toBeGreaterThan(0);
  expect(localDraftCalls).toBe(3);
  expect(reconciliationCalls).toBe(1);
  expect(governingChecks).toEqual(expect.arrayContaining(['1,2,4', '1,3,4']));
  expect(result.summaryDocument).toEqual({ version: 1, source, format: 'bullets', points: [
    { text: 'Friday launch cancelled.', sources: [{ start: 0, end: 31 }, { start: 91, end: 122 }] },
    { text: 'Budget: 20 dollars.', sources: [{ start: 32, end: 57 }] },
    { text: 'Room already checked.', sources: [{ start: 58, end: 90 }] },
    { text: 'Lea must not send the description.', sources: [{ start: 123, end: 157 }] },
    { text: 'Nora: measurements by Wednesday.', sources: [{ start: 158, end: 203 }] },
  ] });
  const receipt = checkpointData.get('summary:v1:final') as { verification: { sourceIds: number[]; verification: SummaryVerification }[] };
  expect([...new Set(receipt.verification.flatMap(check => check.sourceIds))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(receipt.verification.flatMap(check => check.verification.units).some(unit => unit.sourceId === 6 && unit.status === 'covered')).toBe(true);
});

test.each(['source', 'draft', 'targets'] as const)('rejects a page transport outside its named %s fixture during real processing', async field => {
  const source = 'The budget is 20 dollars. Lea must not send the description.';
  script(source, 'Budget and description', { format: 'bullets', points: [
    { text: 'Budget: 20 dollars.', sourceIds: [1] },
    { text: 'Lea must not send the description.', sourceIds: [2] },
  ] }, checked(2, [[1], [2]]));
  const transport = model.getMockImplementation()!;
  let changed = false;
  model.mockImplementation(async (prompt, token, options) => {
    if ('units' in ((options?.jsonSchema?.properties ?? {}) as object)) {
      const payload = JSON.parse(prompt) as { sourceCatalogData: string; draftData: { points: { text: string }[] }; checkTargetsData: SummaryCheckTargets };
      if (field === 'source') payload.sourceCatalogData = '[1] The budget is 20 dollars.';
      if (field === 'draft') payload.draftData.points[1].text = 'Lea will send the description.';
      if (field === 'targets') payload.checkTargetsData = { pointIds: [99], sourceIds: [1, 2] };
      changed = true;
      return transport(JSON.stringify(payload), token, options);
    }
    return transport(prompt, token, options);
  });
  await expect(processNoteWithLlm(source, () => undefined, undefined, 'en')).rejects.toThrow();
  expect(changed).toBe(true);
});
