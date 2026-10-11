import { generate, getContextWindowSize, getLoadedModelInfo, measureFormattedPromptTokens, type GenerationResult, type LoadedModelInfo } from './llm';
import { generateGroundedSummary } from './groundedSummary';
import type { FinalTaskEvidence, ProcessingCheckpointStore, ProcessingExecutionContext } from './processingContext';
import type { SummaryDraft } from './summaryProtocol';
import { projectSourceUnitPlan } from './sourceUnits';

jest.mock('./llm', () => ({
  generate: jest.fn(), getLoadedModelInfo: jest.fn(() => null), getContextWindowSize: jest.fn(() => 8192),
  measureFormattedPromptTokens: jest.fn(async ({ systemPrompt = '', userPrompt }: { systemPrompt?: string; userPrompt: string }) =>
    Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12),
}));
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }));

const generated = (value: unknown): GenerationResult => ({
  text: JSON.stringify(value), ttftMs: 1, tokensPerSecond: 20, wallMs: 20,
  promptMs: 5, predictedMs: 15, promptTokens: 20, predictedTokens: 20,
});
interface Payload { sourceData?: { source: string; text: string }[]; targetSources?: string[]; checkTargetsData?: { pointIds: number[]; sourceIds: number[] }; sourceCatalogData: string; draftData?: SummaryDraft; repairData?: unknown; reconciliationData?: SummaryDraft; requiredUnitsData?: readonly { readonly id: number; readonly text: string }[] }
const catalog = (payload: Payload): { id: number; text: string }[] =>
  payload.sourceCatalogData.split('\n').map(line => {
    const match = /^\[(\d+)\] (.*)$/u.exec(line)!;
    return { id: Number(match[1]), text: match[2] };
  });
const supported = (payload: Payload): unknown => ({
  points: payload.draftData!.points.flatMap((_, index) => !payload.checkTargetsData || payload.checkTargetsData.pointIds.includes(index + 1) ? [{ pointId: index + 1, status: 'supported', issues: [] }] : []),
  units: catalog(payload).filter(unit => !payload.checkTargetsData || payload.checkTargetsData.sourceIds.includes(unit.id)).map(unit => {
    const pointIds = payload.draftData!.points.flatMap((point, index) => point.sourceIds.includes(unit.id) ? [index + 1] : []);
    return { sourceId: unit.id, status: pointIds.length ? 'covered' : 'context', pointIds, supersededBy: [] };
  }),
});
const relations = (payload: Payload, groups: number[][] = [], format: SummaryDraft['format'] = 'bullets', unresolved = false): unknown => ({
  ...(payload.targetSources?.[0] === payload.sourceData?.[0].source ? { format } : {}),
  rows: payload.targetSources!.map(source => ({ source, unresolved, relatedEarlier: groups
    .filter(group => group.includes(Number(source.slice(1)))).flatMap(group => group.filter(id => id < Number(source.slice(1))).map(id => `S${id}`)) })),
});
const model = jest.mocked(generate);
const tokenCount = jest.mocked(measureFormattedPromptTokens);
const source = 'W poniedziałek pokażę aplikację. W piątek nie mam zajęć.';
const completeDraft: SummaryDraft = { format: 'bullets', points: [
  { text: 'Poniedziałek: pokaz aplikacji.', sourceIds: [1] },
  { text: 'Piątek: brak zajęć.', sourceIds: [2] },
] };
const installModel = (draft: SummaryDraft = completeDraft): void => {
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    return generated(options?.jsonSchema?.properties && 'units' in (options.jsonSchema.properties as object)
      ? supported(payload) : draft);
  });
};
const store = (): ProcessingCheckpointStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, read: async key => data.get(key) ?? null, write: async (key, value) => { data.set(key, value); } };
};
beforeEach(() => {
  model.mockReset();
  jest.mocked(getLoadedModelInfo).mockReturnValue(null);
  jest.mocked(getContextWindowSize).mockReturnValue(8192);
  tokenCount.mockImplementation(async ({ systemPrompt = '', userPrompt }) => Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12);
  installModel();
});

test('keeps distinct facts including the final negative and exact original ranges', async () => {
  const result = await generateGroundedSummary(source, 'pl');
  expect(result).toMatchObject({ summary: '• Poniedziałek: pokaz aplikacji.\n• Piątek: brak zajęć.', incomplete: false, warnings: [] });
  expect(result.summaryDocument?.points.map(point => point.sources)).toEqual([
    [{ start: 0, end: 32 }], [{ start: 33, end: 56 }],
  ]);
  // The exact same whole-source final review is already valid in this call,
  // even when no persistent checkpoint store was supplied.
  expect(model).toHaveBeenCalledTimes(2);
});

test('repairs a missing non-essence fact once and independently rechecks it', async () => {
  const content = 'W poniedziałek pokażę aplikację. Potem opowiem o projekcie.';
  const full: SummaryDraft = { format: 'bullets', points: [
    { text: 'Poniedziałek: pokaz aplikacji.', sourceIds: [1] },
    { text: 'Potem: opowieść o projekcie.', sourceIds: [2] },
  ] };
  let repaired = false;
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (payload.draftData!.points.length === 1) return generated({
        points: [{ pointId: 1, status: 'supported', issues: [] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
          { sourceId: 2, status: 'missing', pointIds: [], supersededBy: [] }],
      });
      expect(repaired).toBe(true);
      return generated(supported(payload));
    }
    if (payload.repairData) { repaired = true; return generated(full); }
    return generated({ ...full, points: full.points.slice(0, 1) });
  });
  expect(await generateGroundedSummary(content, 'pl')).toMatchObject({ incomplete: false, summary: expect.stringContaining('opowieść o projekcie') });
});

test('P0-4b completes a missing essence unit literally without a repair generation', async () => {
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (payload.draftData!.points.length === 1) return generated({
        points: [{ pointId: 1, status: 'supported', issues: [] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
          { sourceId: 2, status: 'missing', pointIds: [], supersededBy: [] }],
      });
      return generated(supported(payload));
    }
    return generated({ format: 'bullets', points: [{ text: 'Poniedziałek: pokaz aplikacji.', sourceIds: [1] }] });
  });
  const result = await generateGroundedSummary(source, 'pl');
  expect(result).toMatchObject({ incomplete: false });
  expect(result.summary).toContain('W piątek nie mam zajęć.');
  expect(result.summaryDocument?.points.map(point => point.text)).toEqual(['Poniedziałek: pokaz aplikacji.', 'W piątek nie mam zajęć.']);
  // Deterministic completion: draft, first verify, single re-verify. No repair
  // generation was needed because the appended point is the literal source unit.
  expect(model).toHaveBeenCalledTimes(3);
  expect(model.mock.calls.some(([prompt]) => Boolean((JSON.parse(prompt) as Payload).repairData))).toBe(false);
});

test.each(['superseded', 'reviewSpans'] as const)('P0-4b leaves a %s-guarded essence unit incomplete instead of resurrecting it', async guard => {
  const content = 'The original budget was 900 dollars. Correction: the final budget is 1450 dollars.';
  const earlier = 'The original budget was 900 dollars.';
  const later = 'Correction: the final budget is 1450 dollars.';
  const laterStart = content.indexOf(later);
  const proof: FinalTaskEvidence = {
    tasks: [], evidence: [], warnings: [],
    superseded: guard === 'superseded' ? [{
      earlier: { id: 'old', start: 0, end: earlier.length, quote: earlier, kind: 'cancelled', importance: 2 },
      later: { id: 'new', start: laterStart, end: laterStart + later.length, quote: later, kind: 'fact', importance: 2 },
    }] : [],
    ...(guard === 'reviewSpans' ? { reviewSpans: [{ start: laterStart, end: laterStart + later.length, quote: later, reason: 'Unresolved correction' }] } : {}),
  };
  model.mockImplementation(async (_prompt, _onToken, options) => {
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) return generated({
      points: [{ pointId: 1, status: 'supported', issues: [] }],
      units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
        { sourceId: 2, status: 'missing', pointIds: [], supersededBy: [] }],
    });
    return generated({ format: 'bullets', points: [{ text: 'Original budget: 900 dollars.', sourceIds: [1] }] });
  });
  const result = await generateGroundedSummary(content, 'en', undefined, proof);
  expect(result).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(result.summary).toBe('');
  // Draft plus one verification; the guarded unit was never appended, so the
  // unchanged draft reuses its cached verdict and no repair generation ran.
  expect(model).toHaveBeenCalledTimes(2);
});

test('P0-4b does not append missing non-essence small talk and stays fail-closed', async () => {
  const content = 'Raport jest gotowy. Kawa była dobra.';
  const single: SummaryDraft = { format: 'bullets', points: [{ text: 'Raport gotowy.', sourceIds: [1] }] };
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (payload.draftData!.points.length === 1) return generated({
        points: [{ pointId: 1, status: 'supported', issues: [] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
          { sourceId: 2, status: 'missing', pointIds: [], supersededBy: [] }],
      });
      return generated(supported(payload));
    }
    return generated(single);
  });
  const result = await generateGroundedSummary(content, 'en');
  // Small talk outside the essence set is never appended literally; the model
  // repair could not close the gap, so acceptance stays fail-closed.
  expect(result).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(result.summary).toBe('');
});

test('P0-4b never completes an essence unit already cited by a draft point', async () => {
  // PC preview f1-346 r2: unit 2 was cited by a supported point while its unit
  // verdict stayed uncertain, and the old completion appended a duplicate
  // literal point. The cited guard keeps the draft unchanged and fail-closed.
  const repairPrompts: Payload[] = [];
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      return generated({
        points: [{ pointId: 1, status: 'supported', issues: [] }, { pointId: 2, status: 'supported', issues: [] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
          { sourceId: 2, status: 'uncertain', pointIds: [], supersededBy: [] }],
      });
    }
    if (payload.repairData) repairPrompts.push(payload);
    return generated(completeDraft);
  });
  const result = await generateGroundedSummary(source, 'pl');
  expect(result).toMatchObject({ incomplete: true, summaryDocument: null });
  for (const [prompt] of model.mock.calls) {
    const payload = JSON.parse(prompt) as Payload;
    if (payload.draftData) expect(payload.draftData.points).toHaveLength(2);
  }
  // No duplicate literal point: the single repair was generative, without a
  // requiredUnitsData list naming the already-cited unit.
  expect(repairPrompts).toHaveLength(1);
  expect(repairPrompts[0]).not.toHaveProperty('requiredUnitsData');
});

test('P0-4b names uncited essence units to the generative repair when verification is null', async () => {
  // PC preview f1-346 r1: a null verification skipped the essence path and the
  // repair echoed the identical draft. The repair must now carry the uncited
  // essence unit explicitly; literal completion stays disabled.
  const repairCalls: { readonly payload: Payload; readonly system: string }[] = [];
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      return generated(payload.draftData!.points.some(point => point.sourceIds.includes(2))
        ? supported(payload) : { invalid: true });
    }
    if (payload.repairData) repairCalls.push({ payload, system: options!.system ?? '' });
    return generated(payload.repairData ? completeDraft : { format: 'bullets', points: [{ text: 'Poniedziałek: pokaz aplikacji.', sourceIds: [1] }] });
  });
  const result = await generateGroundedSummary(source, 'pl');
  expect(result).toMatchObject({ incomplete: false });
  expect(result.summary).toContain('Piątek: brak zajęć.');
  expect(repairCalls).toHaveLength(1);
  expect(repairCalls[0].payload.requiredUnitsData).toEqual([{ id: 2, text: 'W piątek nie mam zajęć.' }]);
  expect(repairCalls[0].system).toContain('Te jednostki muszą być obecne w co najmniej jednym punkcie.');
  // No literal completion: the final point text came from the model repair.
  expect(result.summaryDocument?.points.map(point => point.text)).toEqual(['Poniedziałek: pokaz aplikacji.', 'Piątek: brak zajęć.']);
});

test('P0-4b labels appended essence points with Polish category groups in grouped drafts', async () => {
  const content = 'Raport jest gotowy. Ustaliliśmy termin spotkania.';
  const draft: SummaryDraft = { format: 'grouped', points: [{ text: 'Raport gotowy.', sourceIds: [1], group: 'Praca' }] };
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (payload.draftData!.points.length === 1) return generated({
        points: [{ pointId: 1, status: 'supported', issues: [] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
          { sourceId: 2, status: 'missing', pointIds: [], supersededBy: [] }],
      });
      return generated(supported(payload));
    }
    return generated(draft);
  });
  const result = await generateGroundedSummary(content, 'pl');
  expect(result.incomplete).toBe(false);
  expect(result.summaryDocument?.format).toBe('grouped');
  expect(result.summaryDocument?.points).toHaveLength(2);
  expect(result.summaryDocument?.points[1]).toMatchObject({ text: 'Ustaliliśmy termin spotkania.', group: 'Ustalenia' });
  expect(result.summary).toContain('Ustalenia');
});

test('never publishes a repeatedly unverified answer or retries without a bound', async () => {
  model.mockResolvedValue(generated({ wrong: true }));
  expect(await generateGroundedSummary(source, 'pl')).toMatchObject({ summary: '', summaryDocument: null, incomplete: true });
  expect(model.mock.calls.length).toBeLessThanOrEqual(4);
});

test('accepts explicitly checked filler as a successful empty result', async () => {
  installModel({ format: 'bullets', points: [] });
  expect(await generateGroundedSummary('Um, well.', 'en')).toEqual({ summary: '', summaryDocument: null, incomplete: false, warnings: [] });
});

test.each(['tasks', 'evidence', 'reviewSpans'] as const)('does not accept empty output with unresolved or active %s', async field => {
  installModel({ format: 'bullets', points: [] });
  const proof: FinalTaskEvidence = {
    tasks: field === 'tasks' ? ['Prepare report.'] : [],
    evidence: field === 'evidence' ? [{ id: '1', start: 0, end: 15, quote: 'Prepare report.', kind: 'active', importance: 1 }] : [],
    superseded: [], warnings: [],
    reviewSpans: field === 'reviewSpans' ? [{ start: 0, end: 15, quote: 'Prepare report.', reason: 'Unresolved actor' }] : [],
  };
  expect(await generateGroundedSummary('Prepare report.', 'en', undefined, proof)).toMatchObject({ incomplete: true, summaryDocument: null });
});

test('rejects an intact source sentence that cannot fit, without clipping', async () => {
  jest.mocked(getContextWindowSize).mockReturnValue(1100);
  expect(await generateGroundedSummary('A'.repeat(9000) + '.', 'en')).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(model).not.toHaveBeenCalled();
});

test.each(['draft', 'review'] as const)('propagates abort after %s generation', async phase => {
  const controller = new AbortController();
  model.mockImplementation(async (prompt, _onToken, options) => {
    const review = 'units' in ((options!.jsonSchema!.properties ?? {}) as object);
    if (review === (phase === 'review')) controller.abort();
    return generated(review ? supported(JSON.parse(prompt) as Payload) : completeDraft);
  });
  await expect(generateGroundedSummary(source, 'pl', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

test('propagates tokenizer and checkpoint failures', async () => {
  tokenCount.mockRejectedValueOnce(new Error('tokenizer unavailable'));
  await expect(generateGroundedSummary(source, 'pl')).rejects.toThrow('tokenizer unavailable');
  await expect(generateGroundedSummary(source, 'pl', { checkpoint: {
    read: async () => { throw new Error('database unavailable'); }, write: async () => undefined,
  } })).rejects.toThrow('database unavailable');
});

test('rejects changed runtime ownership during awaited token measurement', async () => {
  const execution: ProcessingExecutionContext = { runtimeOptions: { modelPath: 'initial.gguf' } };
  tokenCount.mockImplementationOnce(async () => { execution.runtimeOptions = { modelPath: 'changed.gguf' }; return 1; });
  await expect(generateGroundedSummary(source, 'pl', execution)).rejects.toThrow(/runtime changed/i);
});

test('rejects a different loaded context object even when metadata are equal', async () => {
  const loaded = { modelPath: 'test.gguf', model: {}, execution: {}, speculative: false, gpu: false, devices: [] } as unknown as LoadedModelInfo;
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded);
  tokenCount.mockImplementationOnce(async () => { jest.mocked(getLoadedModelInfo).mockReturnValue({ ...loaded }); return 1; });
  await expect(generateGroundedSummary(source, 'pl')).rejects.toThrow(/runtime changed/i);
});

test('resumes a valid draft after a review interruption without duplicating it', async () => {
  const checkpoint = store();
  let fail = true;
  let drafts = 0;
  model.mockImplementation(async (prompt, _onToken, options) => {
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (fail) { fail = false; throw new Error('interrupted review'); }
      return generated(supported(JSON.parse(prompt) as Payload));
    }
    drafts += 1;
    return generated(completeDraft);
  });
  await expect(generateGroundedSummary(source, 'pl', { checkpoint })).rejects.toThrow('interrupted review');
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(drafts).toBe(1);
});

test('Task9 correction-aware paged verification reuses exact effective requests on cold, same-run and reloaded resume', async () => {
  const statements = [
    'The original equipment budget was 900 dollars.',
    'Alice will prepare the workshop report by Friday.',
    'Bob will contact the supplier by Tuesday.',
    'Correction: the final equipment budget is 1450 dollars.',
    'The north studio is canceled; use the south studio.',
    'We must not buy new cameras.',
    'The review is on November 8 at 14:30.',
    'The budget applies only if the council approves.',
    'Workshop planning is for the local community.',
    'On Friday I have no classes.',
  ];
  const content = statements.join(' ');
  const draft: SummaryDraft = { format: 'bullets', points: [
    { text: 'Final equipment budget: 1450 dollars, only if the council approves.', sourceIds: [1, 4, 8] },
    { text: 'Alice: workshop report by Friday.', sourceIds: [2] },
    { text: 'Bob: supplier contact by Tuesday.', sourceIds: [3] },
    { text: 'North studio canceled; use the south studio.', sourceIds: [5] },
    { text: 'No new cameras.', sourceIds: [6] },
    { text: 'Review: November 8 at 14:30.', sourceIds: [7] },
    { text: 'Workshop planning for the local community.', sourceIds: [9] },
    { text: 'Friday: no classes.', sourceIds: [10] },
  ] };
  const proof: FinalTaskEvidence = { tasks: [statements[1], statements[2]],
    evidence: [statements[1], statements[2]].map(quote => ({ id: `task:${content.indexOf(quote)}`,
      start: content.indexOf(quote), end: content.indexOf(quote) + quote.length, quote, task: quote,
      kind: 'active', importance: 2, change: false })), superseded: [], warnings: [] };
  model.mockImplementation(async (prompt, _token, options) => {
    const payload = JSON.parse(prompt) as Payload & { taskEvidenceData?: FinalTaskEvidence };
    expect(payload.sourceCatalogData).toBe(statements.map((text, index) => `[${index + 1}] ${text}`).join('\n'));
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      expect(payload.taskEvidenceData).toEqual(proof);
      const verdict = supported(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      return generated({ ...verdict, units: verdict.units.map(unit => unit.sourceId === 1
        ? { ...unit, status: 'superseded', pointIds: [], supersededBy: [4] } : unit) });
    }
    return generated(draft);
  });
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint };
  const cold = await generateGroundedSummary(content, 'en', execution, proof);
  const firstCalls = model.mock.calls.length;
  const firstReviews = model.mock.calls.filter(([prompt]) => Boolean((JSON.parse(prompt) as Payload).draftData));
  const firstReceipt = checkpoint.data.get('summary:v1:final') as { attemptedCalls: number; repairUsed: boolean };
  expect(firstReceipt).toMatchObject({ attemptedCalls: firstCalls, repairUsed: false });
  const sameRun = await generateGroundedSummary(content, 'en', execution, proof);
  const afterSameRun = model.mock.calls.length;
  const reloaded: ProcessingCheckpointStore = { read: async key => checkpoint.data.get(key) ?? null,
    write: async (key, value) => { checkpoint.data.set(key, value); } };
  const reloadedProof = JSON.parse(JSON.stringify(proof)) as FinalTaskEvidence;
  const fresh = await generateGroundedSummary(content, 'en', { checkpoint: reloaded }, reloadedProof);
  expect(cold).toMatchObject({ incomplete: false, warnings: [], summaryDocument: { source: content } });
  expect(cold.summary).toBe('• Final equipment budget: 1450 dollars, only if the council approves.\n• Alice: workshop report by Friday.\n• Bob: supplier contact by Tuesday.\n• North studio canceled; use the south studio.\n• No new cameras.\n• Review: November 8 at 14:30.\n• Workshop planning for the local community.\n• Friday: no classes.');
  expect(cold.summary).not.toContain('900');
  expect(cold.summaryDocument!.points[0].sources.map(range => content.slice(range.start, range.end))).toEqual([statements[0], statements[3], statements[7]]);
  expect(sameRun).toEqual(cold);
  expect(fresh).toEqual(cold);
  expect(afterSameRun).toBe(firstCalls);
  expect(model).toHaveBeenCalledTimes(firstCalls);
  expect(firstReviews.length).toBeGreaterThan(1);
  const wires = firstReviews.map(([prompt, , options]) => JSON.stringify([prompt, options?.system, options?.jsonSchema, options?.nPredict]));
  expect(new Set(wires).size).toBe(wires.length);
  expect(firstReviews.flatMap(([prompt]) => (JSON.parse(prompt) as Payload).checkTargetsData!.pointIds)).toEqual(draft.points.map((_, index) => index + 1));
  expect(firstReviews.flatMap(([prompt]) => (JSON.parse(prompt) as Payload).checkTargetsData!.sourceIds)).toEqual(statements.map((_, index) => index + 1));
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: firstCalls, repairUsed: false });
});

test('Task9 a different valid task proof invalidates verification while an equivalent reloaded proof reuses it', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const quote = 'W poniedziałek pokażę aplikację.';
  const proof: FinalTaskEvidence = { tasks: [quote], evidence: [{ id: 'task:0', start: 0, end: quote.length,
    quote, task: quote, kind: 'active', importance: 2, change: false }], superseded: [], warnings: [] };
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint }, proof)).toMatchObject({ incomplete: false });
  expect(model).toHaveBeenCalledTimes(2);
  expect(JSON.parse(model.mock.calls[1][0]).taskEvidenceData).toEqual(proof);
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint }, JSON.parse(JSON.stringify(proof)) as FinalTaskEvidence)).toMatchObject({ incomplete: false });
  expect(model).not.toHaveBeenCalled();
});

test('Task9 a different effective verification page plan generates new pages and remains reusable', async () => {
  const checkpoint = store();
  const first = await generateGroundedSummary(source, 'pl', { checkpoint });
  const previous = (checkpoint.data.get('summary:v1:final') as { attemptedCalls: number }).attemptedCalls;
  const oldWire = model.mock.calls.find(([prompt]) => (JSON.parse(prompt) as Payload).draftData)![0];
  // The same source/draft now fits only one target per verifier request.
  // This changes actual targets, schema, reserve and measured page-plan binding.
  tokenCount.mockImplementation(async ({ systemPrompt = '', userPrompt }) => {
    const targets = (JSON.parse(userPrompt) as Payload).checkTargetsData;
    if (!targets) return Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12;
    return targets.pointIds.length + targets.sourceIds.length > 1 ? 8192 : 100;
  });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toEqual(first);
  const newCalls = model.mock.calls.length;
  expect(newCalls).toBeGreaterThan(1);
  for (const [prompt] of model.mock.calls) {
    const payload = JSON.parse(prompt) as Payload;
    expect(payload.draftData).toEqual({ ...completeDraft,
      points: completeDraft.points.map((point, index) => ({ ...point, pointId: index + 1 })) });
    expect(payload.sourceCatalogData).toBe('[1] W poniedziałek pokażę aplikację.\n[2] W piątek nie mam zajęć.');
    expect(prompt).not.toBe(oldWire);
    expect(payload.checkTargetsData!.pointIds.length + payload.checkTargetsData!.sourceIds.length).toBe(1);
  }
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: previous + newCalls });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toEqual(first);
  expect(model).not.toHaveBeenCalled();
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: previous + newCalls });
});

test('ignores forged verifier data and source-stale checkpoint envelopes', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  for (const [key, value] of checkpoint.data) {
    checkpoint.data.set(key, { ...(value as object), verification: { points: [], units: [] } });
  }
  model.mockResolvedValue(generated({ invalid: true }));
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(await generateGroundedSummary('Different source.', 'en', { checkpoint })).toMatchObject({ incomplete: true });
});

test('never accepts a truncated but syntactically valid generation', async () => {
  model.mockResolvedValue({ ...generated(completeDraft), completion: { status: 'truncated', truncated: true,
    stoppedLimit: true, contextFull: false, interrupted: false, stoppedEos: false, stoppingWord: '' } });
  expect(await generateGroundedSummary(source, 'pl')).toMatchObject({ incomplete: true, summaryDocument: null });
});

const windowedModel = (): void => {
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    if (!payload.sourceCatalogData) return 100;
    return !payload.draftData && !payload.reconciliationData && catalog(payload).length > 2 ? 9000 : 100;
  });
  model.mockImplementation(async (prompt, _onToken, options) => {
    const properties = (options!.jsonSchema!.properties ?? {}) as Record<string, unknown>;
    const payload = JSON.parse(prompt) as Payload;
    if (properties.rows) return generated(relations(payload));
    if (properties.units) return generated(supported(payload));
    return generated({ format: 'bullets', points: catalog(payload).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
};

test('keeps global IDs and repeated paragraphs in later windows at their original positions', async () => {
  windowedModel();
  const result = await generateGroundedSummary('Alpha.\n\nRepeat.\n\nGamma.\n\nRepeat.\n\nOmega.', 'en');
  expect(result.incomplete).toBe(false);
  expect(result.summaryDocument?.points.map(point => point.sources)).toEqual([
    [{ start: 0, end: 6 }], [{ start: 8, end: 15 }], [{ start: 17, end: 23 }],
    [{ start: 25, end: 32 }], [{ start: 34, end: 40 }],
  ]);
});

test('reconciles a distant non-task cancellation with both whole originals and local point mapping', async () => {
  windowedModel();
  let sawBoth = false;
  model.mockImplementation(async (prompt, _onToken, options) => {
    const properties = (options!.jsonSchema!.properties ?? {}) as Record<string, unknown>;
    const payload = JSON.parse(prompt) as Payload;
    if (properties.rows) return generated(relations(payload, [[1, 6]]));
    if (properties.units) {
      const result = supported(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      if (catalog(payload).some(unit => unit.id === 1) && catalog(payload).some(unit => unit.id === 6)) {
        sawBoth = true;
        expect(payload.sourceCatalogData).toContain('[1] Friday meeting confirmed.');
        expect(payload.sourceCatalogData).toContain('[6] The Friday meeting is cancelled.');
        expect(payload.draftData!.points.some(point => point.text === 'Friday meeting confirmed.')).toBe(false);
        result.units = result.units.map(unit => unit.sourceId === 1 ? { sourceId: 1, status: 'superseded', pointIds: [], supersededBy: [6] } : unit);
      }
      return generated(result);
    }
    if (payload.reconciliationData) return generated({ format: 'bullets', points: [{ text: 'Friday meeting cancelled.', sourceIds: [1, 6] }] });
    return generated({ format: 'bullets', points: catalog(payload).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  const result = await generateGroundedSummary('Friday meeting confirmed. Budget 20. Room blue. Door green. Lunch Monday. The Friday meeting is cancelled.', 'en');
  expect(result.incomplete).toBe(false);
  expect(sawBoth).toBe(true);
  expect(result.summary).toContain('Friday meeting cancelled.');
  expect(result.summary).not.toContain('meeting confirmed');
  expect(result.summaryDocument?.points[0].sources).toEqual([{ start: 0, end: 25 }, { start: 74, end: 106 }]);
});

test('fails closed if the global overview cannot resolve relationships', async () => {
  windowedModel();
  const ordinary = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => 'rows' in ((options!.jsonSchema!.properties ?? {}) as object)
    ? generated(relations(JSON.parse(prompt) as Payload, [], 'bullets', true)) : ordinary(prompt, onToken, options));
  expect(await generateGroundedSummary('First. Second. Third. Fourth.', 'en')).toMatchObject({ incomplete: true, summaryDocument: null });
});

test('fails closed without subdividing the context when one verifier row cannot fit', async () => {
  windowedModel();
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    return payload.draftData && catalog(payload).length > 1 ? 9000 : 100;
  });
  const result = await generateGroundedSummary('First. Second. Third.', 'en');
  expect(result.incomplete).toBe(true);
  expect(model.mock.calls.filter(([prompt]) => !JSON.parse(prompt).draftData)).toHaveLength(1);
});

test('uses one literal whole-source fallback for an unsupported paraphrase and rechecks it', async () => {
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      if (payload.draftData!.points[0].text === 'Budget 50.') return generated({
        points: [{ pointId: 1, status: 'unsupported', issues: ['number'] }],
        units: [{ sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] }],
      });
      expect(payload.draftData!.points[0].text).toBe('Budget 20.');
      return generated(supported(payload));
    }
    return generated({ format: 'bullets', points: [{ text: 'Budget 50.', sourceIds: [1] }] });
  });
  expect(await generateGroundedSummary('Budget 20.', 'en')).toMatchObject({ incomplete: false, summary: '• Budget 20.' });
});

test('does not accept an empty transcript with active task proof', async () => {
  expect(await generateGroundedSummary(' ', 'en', undefined, { tasks: ['Prepare report'], evidence: [], superseded: [], warnings: [] }))
    .toMatchObject({ incomplete: true, summaryDocument: null });
});

test('propagates checkpoint write failure and ownership changes during checkpoint reads', async () => {
  await expect(generateGroundedSummary(source, 'pl', { checkpoint: { read: async () => null,
    write: async () => { throw new Error('disk failed'); } } })).rejects.toThrow('disk failed');
  const execution: ProcessingExecutionContext = { runtimeOptions: { modelPath: 'original' } };
  execution.checkpoint = { read: async () => { execution.runtimeOptions = { modelPath: 'other' }; return null; }, write: async () => undefined };
  await expect(generateGroundedSummary(source, 'pl', execution)).rejects.toThrow(/runtime changed/i);
});

test.each(['language', 'runtime', 'pipeline', 'plan', 'draft'] as const)('rejects saved data with mismatched %s binding', async field => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  for (const [key, value] of checkpoint.data) {
    const changed = { ...(value as Record<string, unknown>) };
    if (field === 'language') changed.language = 'en';
    if (field === 'runtime') changed.modelRuntimeIdentity = 'another model';
    if (field === 'pipeline') changed.pipeline = 'old';
    if (field === 'plan') changed.sourceUnitPlanIdentity = 'old plan';
    if (field === 'draft') changed.draft = { format: 'bullets', points: [{ text: 'Forged.', sourceIds: [100] }] };
    checkpoint.data.set(key, changed);
  }
  model.mockResolvedValue(generated({ wrong: true }));
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true, summaryDocument: null });
});

test('repairs a fact first found missing by the final global-context audit', async () => {
  windowedModel();
  let finalReview = false;
  let overviewCalls = 0;
  model.mockImplementation(async (prompt, _onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    const properties = (options!.jsonSchema!.properties ?? {}) as Record<string, unknown>;
    if (properties.rows) { overviewCalls += 1; return generated(relations(payload)); }
    if (payload.draftData && payload.draftData.points.some(point => point.sourceIds.includes(3))) finalReview = true;
    if (properties.units) {
      const result = supported(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      if (finalReview && !payload.draftData!.points.some(point => point.sourceIds.includes(2)) && catalog(payload).some(unit => unit.id === 2))
        result.units = result.units.map(unit => unit.sourceId === 2 ? { ...unit, status: 'missing' } : unit);
      return generated(result);
    }
    return generated({ format: 'bullets', points: catalog(payload).filter(unit => unit.id !== 2 || payload.repairData)
      .map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  expect(await generateGroundedSummary('First. Second. Third.', 'en')).toMatchObject({ incomplete: false, summary: expect.stringContaining('Second.') });
  expect(overviewCalls).toBe(1);
});

test('returns incomplete when a required cross-window original context cannot fit', async () => {
  windowedModel();
  const normal = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, token, options) => 'rows' in ((options!.jsonSchema!.properties ?? {}) as object)
    ? generated(relations(JSON.parse(prompt) as Payload, [[1, 4]])) : normal(prompt, token, options));
  const ordinaryCount = tokenCount.getMockImplementation()!;
  tokenCount.mockImplementation(async input => {
    const payload = JSON.parse(input.userPrompt) as Payload;
    return payload.reconciliationData ? 9000 : ordinaryCount(input);
  });
  expect(await generateGroundedSummary('First. Second. Third. Fourth.', 'en')).toMatchObject({ incomplete: true });
});

test('keeps the one-repair allowance across resume after an invalid repair', async () => {
  const checkpoint = store();
  model.mockResolvedValue(generated({ invalid: true }));
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  const firstCalls = model.mock.calls.length;
  expect(firstCalls).toBe(2);
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model.mock.calls.length - firstCalls).toBe(1);
});

test('rejects more than 64 intact windows without silently dropping their final facts', async () => {
  windowedModel();
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    return payload.sourceCatalogData && catalog(payload).length > 1 ? 9000 : 100;
  });
  expect(await generateGroundedSummary(Array.from({ length: 65 }, (_, index) => `Fact ${index + 1}.`).join(' '), 'en'))
    .toMatchObject({ incomplete: true, summaryDocument: null });
  expect(model).not.toHaveBeenCalled();
});

test('stops at the total model-call cap and never publishes partial final coverage', async () => {
  windowedModel();
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    return payload.sourceCatalogData && !payload.draftData && catalog(payload).length > 1 ? 9000 : 100;
  });
  const result = await generateGroundedSummary(Array.from({ length: 64 }, (_, index) => `Fact ${index + 1}.`).join(' '), 'en');
  expect(result).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(model).toHaveBeenCalledTimes(192);
});

test('keeps attempted calls within the cumulative limit after interruption and repeated resume', async () => {
  windowedModel();
  const ordinary = model.getMockImplementation()!;
  let attempts = 0;
  model.mockImplementation(async (prompt, token, options) => {
    attempts += 1;
    if (attempts === 191) throw new Error('model interrupted near the limit');
    return ordinary(prompt, token, options);
  });
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    return payload.sourceCatalogData && !payload.draftData && catalog(payload).length > 1 ? 9000 : 100;
  });
  const checkpoint = store();
  const content = Array.from({ length: 64 }, (_, index) => `Fact ${index + 1}.`).join(' ');
  await expect(generateGroundedSummary(content, 'en', { checkpoint })).rejects.toThrow('model interrupted near the limit');
  expect(attempts).toBe(191);
  expect(await generateGroundedSummary(content, 'en', { checkpoint })).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(attempts).toBe(192);
  expect(await generateGroundedSummary(content, 'en', { checkpoint })).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(attempts).toBe(192);
  // A different source has a different operation binding and its own budget.
  expect(await generateGroundedSummary('Another fact.', 'en', { checkpoint })).toMatchObject({ incomplete: false });
  expect(attempts).toBe(194);
});

test('propagates a failed durable attempt claim before invoking the model', async () => {
  const checkpoint: ProcessingCheckpointStore = { read: async () => null,
    write: async () => { throw new Error('attempt budget write failed'); } };
  await expect(generateGroundedSummary(source, 'pl', { checkpoint })).rejects.toThrow('attempt budget write failed');
  expect(model).not.toHaveBeenCalled();
});

test.each([undefined, -1, 1.5, '2', 193])('does not reset a malformed same-operation attempt count: %s', async count => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.set('summary:v1:final', { ...final, attemptedCalls: count });
  // Force regeneration to expose an incorrectly renewed budget, while keeping
  // the exact same source/runtime-bound operation checkpoint.
  for (const key of checkpoint.data.keys()) if (key !== 'summary:v1:final') checkpoint.data.delete(key);
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).not.toHaveBeenCalled();
});

test('includes governing task originals before a local verifier sees supersession evidence', async () => {
  windowedModel();
  const content = 'Send report. Room blue. Door green. Cancel report.';
  const proof: FinalTaskEvidence = { tasks: [], evidence: [], warnings: [], superseded: [{
    earlier: { id: 'old', start: 0, end: 12, quote: 'Send report.', kind: 'active', importance: 1 },
    later: { id: 'new', start: 36, end: 50, quote: 'Cancel report.', kind: 'cancelled', importance: 1 },
  }] };
  let inspected = false;
  model.mockImplementation(async (prompt, _onToken, options) => {
    const properties = (options!.jsonSchema!.properties ?? {}) as Record<string, unknown>;
    const payload = JSON.parse(prompt) as Payload;
    if (properties.rows) return generated(relations(payload));
    if (properties.units) {
      if (catalog(payload).some(unit => unit.id === 1)) {
        expect(payload.sourceCatalogData).toContain('[4] Cancel report.');
        inspected = true;
      }
      return generated(supported(payload));
    }
    return generated({ format: 'bullets', points: catalog(payload).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  // Context expansion can be over budget; it must never verify an earlier-only view.
  const result = await generateGroundedSummary(content, 'en', undefined, proof);
  expect(result.incomplete || inspected).toBe(true);
});

test('rejects an explicitly requested runtime that differs from the live loaded model', async () => {
  jest.mocked(getLoadedModelInfo).mockReturnValue({ modelPath: 'actual.gguf', model: {}, execution: 'foreground',
    speculative: false, gpu: false, devices: [] } as unknown as LoadedModelInfo);
  await expect(generateGroundedSummary(source, 'pl', { runtimeOptions: { modelPath: 'requested.gguf' } })).rejects.toThrow(/runtime/i);
});

test('preserves paragraph and source-grounded grouped formatting for a single window', async () => {
  installModel({ format: 'paragraph', points: [{ text: 'A reflection.', sourceIds: [1] }] });
  expect(await generateGroundedSummary('I am reflecting.', 'en')).toMatchObject({ incomplete: false, summary: 'A reflection.', summaryDocument: { format: 'paragraph' } });
  installModel({ format: 'grouped', points: [{ text: 'Budget 20.', sourceIds: [1], group: 'Budget' }] });
  expect(await generateGroundedSummary('Budget 20.', 'en')).toMatchObject({ incomplete: false, summaryDocument: { format: 'grouped', points: [{ group: 'Budget' }] } });
});

 test('Task4c pages the 36U/14P overflow with the complete source and unchanged draft', async () => {
  const content = Array.from({ length: 36 }, (_, i) => `Fact ${i + 1}, not confirmed.`).join(' ');
  const draft: SummaryDraft = { format: 'paragraph', points: Array.from({ length: 14 }, (_, i) => ({ text: `Fact ${i + 1}, not confirmed.`, sourceIds: [i + 1] })) };
  tokenCount.mockImplementation(async ({ userPrompt, jsonSchema }) => {
    expect(jsonSchema).toBeDefined();
    return JSON.parse(userPrompt).draftData ? 2447 : 100;
  });
  installModel(draft);
  const checkpoint = store();
  const result = await generateGroundedSummary(content, 'en', { checkpoint });
  expect(result).toMatchObject({ incomplete: false, summaryDocument: { format: 'paragraph' } });
  const reviews = model.mock.calls.filter(([prompt]) => JSON.parse(prompt).draftData);
  expect(reviews.length).toBeGreaterThan(1);
  expect(model.mock.calls.length - reviews.length).toBe(1);
  const points: number[] = [], sources: number[] = [];
  for (const [prompt, , options] of reviews) {
    const payload = JSON.parse(prompt) as Payload;
    expect(catalog(payload)).toHaveLength(36);
    expect(payload.draftData!.points).toHaveLength(14);
    expect(payload.sourceCatalogData).toContain('[36] Fact 36, not confirmed.');
    expect(2447 + options!.nPredict! + 24).toBeLessThanOrEqual(8192);
    points.push(...payload.checkTargetsData!.pointIds); sources.push(...payload.checkTargetsData!.sourceIds);
  }
  expect(points.sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  expect(sources.sort((a, b) => a - b)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
  expect(JSON.stringify(checkpoint.data.get('summary:v1:final'))).toContain('"sourceId":36');
});

test.each(['paragraph', 'grouped'] as const)('Task4c source-only discovery precedes drafts and preserves global %s', async format => {
  windowedModel();
  model.mockImplementation(async (prompt, _token, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if (payload.sourceData) {
      expect(model.mock.calls.filter(([input]) => JSON.parse(input).sourceCatalogData)).toHaveLength(0);
      expect(payload.sourceData.map(unit => unit.text)).toEqual(['Old cost 17.', 'Think cautiously.', 'Cost now 23.', 'Lea will not send it by Friday.']);
      expect(payload).not.toHaveProperty('draftData');
      return generated(relations(payload, [[1, 3]], format));
    }
    if (payload.draftData) return generated(supported(payload));
    expect(JSON.stringify(options!.jsonSchema)).toContain(`"enum":["${format}"]`);
    return generated({ format, points: catalog(payload).map(unit => ({ text: unit.text, sourceIds: [unit.id], ...(format === 'grouped' ? { group: 'Costs and plans' } : {}) })) });
  });
  const result = await generateGroundedSummary('Old cost 17. Think cautiously. Cost now 23. Lea will not send it by Friday.', 'en');
  expect(result).toMatchObject({ incomplete: false, summaryDocument: { format } });
  expect(result.summary).toContain('Lea will not send it by Friday.');
  expect(result.summaryDocument!.points.every(point => format !== 'grouped' || point.group === 'Costs and plans')).toBe(true);
});

test('Task4c raw discovery overflow falls back to bullets without relations, never a partial prefix', async () => {
  windowedModel();
  const ordinary = tokenCount.getMockImplementation()!;
  tokenCount.mockImplementation(async input => JSON.parse(input.userPrompt).sourceData ? 8192 : ordinary(input));
  const result = await generateGroundedSummary('One. Two. Three. Four.', 'en');
  expect(result).toMatchObject({ incomplete: false, summaryDocument: { format: 'bullets' } });
  expect(result.summaryDocument?.points.map(point => point.text)).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
  // P0-1 planning overflow is decided before any model call: no relation
  // request and no partial prefix ever runs. Known limitation of the fallback:
  // a cross-window correction may stay unlinked; the audit still gates
  // publication, so nothing is published silently without verification.
  expect(model.mock.calls.some(([prompt]) => 'sourceData' in (JSON.parse(prompt) as Payload))).toBe(false);
});

test('Task4c relations overflow fallback still fails closed when the fallback draft cannot be verified', async () => {
  windowedModel();
  const ordinary = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, onToken, options) => {
    const payload = JSON.parse(prompt) as Payload;
    if ('units' in ((options!.jsonSchema!.properties ?? {}) as object)) {
      const verdict = supported(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      verdict.units = verdict.units.map(unit => unit.sourceId === 4 ? { ...unit, status: 'missing', pointIds: [] } : unit);
      return generated(verdict);
    }
    return ordinary(prompt, onToken, options);
  });
  const ordinaryCount = tokenCount.getMockImplementation()!;
  tokenCount.mockImplementation(async input => JSON.parse(input.userPrompt).sourceData ? 8192 : ordinaryCount(input));
  expect(await generateGroundedSummary('One. Two. Three. Four.', 'en')).toMatchObject({ incomplete: true, summaryDocument: null });
});

test('Task4c greedy planner fills each verifier page with the largest fitting prefix in order', async () => {
  const content = Array.from({ length: 6 }, (_, index) => `Fact ${index + 1}.`).join(' ');
  const draft: SummaryDraft = { format: 'bullets', points: Array.from({ length: 6 }, (_, index) => ({ text: `Fact ${index + 1}.`, sourceIds: [index + 1] })) };
  installModel(draft);
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    if (!payload.draftData) return 100;
    const targets = payload.checkTargetsData!;
    // At most five rows fit a page; the greedy planner must fill exactly five
    // and keep the remaining rows in order instead of halving blindly.
    return targets.pointIds.length + targets.sourceIds.length > 5 ? 9000 : 100;
  });
  expect(await generateGroundedSummary(content, 'en')).toMatchObject({ incomplete: false });
  const pages = model.mock.calls.filter(([prompt]) => Boolean((JSON.parse(prompt) as Payload).draftData));
  const targets = pages.map(([prompt]) => (JSON.parse(prompt) as Payload).checkTargetsData!);
  expect(targets.map(target => target.pointIds.length + target.sourceIds.length)).toEqual([5, 5, 2]);
  expect(targets.flatMap(target => target.pointIds)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(targets.flatMap(target => target.sourceIds)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('Task4c an oversized first verifier row fails the whole plan without skipping it', async () => {
  windowedModel();
  const ordinary = tokenCount.getMockImplementation()!;
  tokenCount.mockImplementation(async input => {
    const payload = JSON.parse(input.userPrompt) as Payload;
    if (payload.draftData && payload.checkTargetsData!.pointIds.includes(1)) return 8192;
    return ordinary(input);
  });
  const result = await generateGroundedSummary('First. Second. Third.', 'en');
  expect(result).toMatchObject({ incomplete: true, summaryDocument: null });
  // No verifier request was ever attempted; the plan failed closed at the
  // mandatory single-row probe instead of skipping the oversized first row.
  expect(model.mock.calls.filter(([prompt]) => Boolean((JSON.parse(prompt) as Payload).draftData))).toHaveLength(0);
});

test('Task4c v1 artifact misses preserve 191 charged attempts and the spent repair', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear();
  checkpoint.data.set('summary:v1:final', { ...final, summaryProtocolVersion: 1, attemptedCalls: 191, repairUsed: true });
  checkpoint.data.set('summary:v1:draft:1:2', { ...final, attemptedCalls: 191, draft: completeDraft });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).toHaveBeenCalledTimes(1);
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: 192, repairUsed: true });
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).toHaveBeenCalledTimes(1);
});

test('Task4c unknown repair flag cannot authorize a repair', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear();
  checkpoint.data.set('summary:v1:final', { ...final, attemptedCalls: 12, repairUsed: 'unknown' });
  model.mockClear(); model.mockResolvedValue(generated({ invalid: true }));
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).toHaveBeenCalledTimes(1);
});

test('Task4c no journal plus an old local artifact cannot restart through discovery', async () => {
  windowedModel();
  const checkpoint = store();
  const content = 'First. Second. Third. Fourth.';
  await generateGroundedSummary(content, 'en', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear();
  checkpoint.data.set('summary:v1:draft:1:2', { ...final, summaryProtocolVersion: 1, attemptedCalls: 191, repairUsed: true });
  model.mockClear();
  expect(await generateGroundedSummary(content, 'en', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).not.toHaveBeenCalled();
});

test('Task4c a malformed operation binding cannot renew its budget', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear();
  checkpoint.data.set('summary:v1:final', { ...final, modelRuntimeIdentity: 'malformed', attemptedCalls: 192, repairUsed: true });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).not.toHaveBeenCalled();
});

test('Task4c a cached draft with a changed global format must be regenerated', async () => {
  windowedModel();
  const checkpoint = store();
  const content = 'First. Second. Third. Fourth.';
  await generateGroundedSummary(content, 'en', { checkpoint });
  for (const [key, value] of checkpoint.data) if (key.startsWith('summary:v2:draft:')) {
    const saved = value as Record<string, unknown>;
    checkpoint.data.set(key, { ...saved, draft: { ...(saved.draft as SummaryDraft), format: 'paragraph' } });
  }
  model.mockClear();
  const result = await generateGroundedSummary(content, 'en', { checkpoint });
  expect(result.incomplete).toBe(false);
  expect(model.mock.calls.some(([prompt]) => { const p = JSON.parse(prompt); return p.sourceCatalogData && !p.draftData; })).toBe(true);
});

test.each([8192, 4096])('Task4c exact prompt+reserve+24 boundary at context %i', async nCtx => {
  jest.mocked(getContextWindowSize).mockReturnValue(nCtx);
  const { summaryVerificationPageRequest } = jest.requireActual<typeof import('./summaryProtocol')>('./summaryProtocol');
  const { createSummarySources } = jest.requireActual<typeof import('./summarySources')>('./summarySources');
  const units = createSummarySources('One.');
  const draft: SummaryDraft = { format: 'bullets', points: [{ text: 'One.', sourceIds: [1] }] };
  let extra = 0;
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const p = JSON.parse(userPrompt) as Payload;
    return p.draftData ? nCtx - summaryVerificationPageRequest(units, draft, p.checkTargetsData!, 'en').request.nPredict - 24 + extra : 100;
  });
  installModel(draft);
  expect(await generateGroundedSummary('One.', 'en')).toMatchObject({ incomplete: false });
  extra = 1; model.mockClear();
  expect(await generateGroundedSummary('One.', 'en')).toMatchObject({ incomplete: true });
  expect(model).toHaveBeenCalledTimes(1); // No verifier, no repair, no context subdivision.
});

test.each([false, true])('Task4c 44U reconciliation gets exact free reserve; stopped_limit=%s', async stopped => {
  const content = Array.from({ length: 44 }, (_, i) => `Fact ${i + 1}, only if agreed.`).join(' ');
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const p = JSON.parse(userPrompt) as Payload;
    if (p.sourceData || p.draftData) return 100;
    if (p.reconciliationData || p.repairData) return 1549;
    return catalog(p).length > 22 ? 9000 : 100;
  });
  let reconciliations = 0;
  model.mockImplementation(async (prompt, _token, options) => {
    const p = JSON.parse(prompt) as Payload;
    if (p.sourceData) return generated(relations(p, [Array.from({ length: 44 }, (_, i) => i + 1)], 'paragraph'));
    if (p.draftData) return generated(supported(p));
    if (p.reconciliationData || p.repairData) {
      reconciliations += 1;
      expect(catalog(p)).toHaveLength(44);
      expect(options!.nPredict).toBe(6619); // 8192 - 1549 - 24, not 7296 or a fixed cap.
      const reply = generated({ format: 'paragraph', points: [{ text: 'All facts remain conditional.', sourceIds: catalog(p).map(unit => unit.id) }] });
      return stopped ? { ...reply, completion: { status: 'stopped_limit', truncated: false, stoppedLimit: true, contextFull: false, interrupted: false, stoppedEos: false, stoppingWord: '' } } : reply;
    }
    return generated({ format: 'paragraph', points: catalog(p).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  const result = await generateGroundedSummary(content, 'en');
  expect(result.incomplete).toBe(stopped);
  expect(reconciliations).toBe(stopped ? 2 : 1);
  // Scripted verdicts test transport/budget only; the wording above is NOT a quality pass.
});

test.each(['signal', 'runtimeOptions', 'checkpoint', 'sourceUnitPlan'] as const)('Task4c live %s replacement across tokenizer/read/write/generate awaits', async field => {
  for (const phase of ['tokenizer', 'read', 'write', 'generate'] as const) {
    const execution: ProcessingExecutionContext = {};
    const initialCheckpoint = store();
    execution.checkpoint = initialCheckpoint;
    let mutated = false;
    const change = (): void => {
      if (mutated) return;
      mutated = true;
      if (field === 'signal') execution.signal = new AbortController().signal;
      if (field === 'runtimeOptions') execution.runtimeOptions = { modelPath: 'replacement' };
      if (field === 'checkpoint') execution.checkpoint = store();
      if (field === 'sourceUnitPlan') Object.defineProperty(execution, 'sourceUnitPlan', { get: () => ({ version: 1, source, identity: 'changed', ends: [32, 56] }) });
    };
    tokenCount.mockImplementation(async () => { if (phase === 'tokenizer') change(); return 100; });
    initialCheckpoint.read = async key => { if (phase === 'read') change(); return initialCheckpoint.data.get(key) ?? null; };
    initialCheckpoint.write = async (key, value) => { initialCheckpoint.data.set(key, value); if (phase === 'write') change(); };
    model.mockImplementation(async (prompt) => { if (phase === 'generate') change(); const p = JSON.parse(prompt) as Payload; return generated(p.draftData ? supported(p) : completeDraft); });
    await expect(generateGroundedSummary(source, 'pl', execution)).rejects.toThrow(/runtime changed/i);
  }
});

test.each(['tokenizer', 'read', 'write', 'generate'] as const)('Task4c cancellation during %s is propagated and charged only after claim', async phase => {
  const controller = new AbortController();
  const checkpoint = store();
  const originalRead = checkpoint.read, originalWrite = checkpoint.write;
  checkpoint.read = async key => { if (phase === 'read') controller.abort(); return originalRead(key); };
  checkpoint.write = async (key, value) => { await originalWrite(key, value); if (phase === 'write') controller.abort(); };
  tokenCount.mockImplementation(async () => { if (phase === 'tokenizer') controller.abort(); return 100; });
  model.mockImplementation(async () => { controller.abort(); return generated(completeDraft); });
  await expect(generateGroundedSummary(source, 'pl', { checkpoint, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  if (phase === 'generate' || phase === 'write') expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: 1 });
  else expect(model).not.toHaveBeenCalled();
});

test('Task4c large task proof is measured in every full verifier context and cannot be silently clipped', async () => {
  const proof: FinalTaskEvidence = { tasks: [], evidence: [], superseded: [], warnings: ['q'.repeat(40000)] };
  tokenCount.mockImplementation(async ({ userPrompt }) => JSON.parse(userPrompt).taskEvidenceData ? 8192 : 100);
  expect(await generateGroundedSummary(source, 'pl', undefined, proof)).toMatchObject({ incomplete: true });
  expect(model).toHaveBeenCalledTimes(1);
  expect(tokenCount.mock.calls.some(([input]) => JSON.parse(input.userPrompt).taskEvidenceData?.warnings[0]?.length === 40000)).toBe(true);
});

test('Task4c grouped heading failure uses the single generative repair and retains format', async () => {
  let repairs = 0;
  model.mockImplementation(async (prompt, _token, options) => {
    const p = JSON.parse(prompt) as Payload;
    if (p.draftData) {
      const result = supported(p) as { points: { pointId: number; status: string; issues: string[] }[]; units: unknown[] };
      if (p.draftData.points[0].group === 'Guaranteed profit') result.points[0] = { pointId: 1, status: 'unsupported', issues: ['uncertainty'] };
      return generated(result);
    }
    if (p.repairData) { repairs += 1; expect(JSON.stringify(options!.jsonSchema)).toContain('"enum":["grouped"]'); }
    return generated({ format: 'grouped', points: [{ text: 'Possible profit only if approved.', sourceIds: [1], group: p.repairData ? 'Conditional plans' : 'Guaranteed profit' }] });
  });
  expect(await generateGroundedSummary('Possible profit only if approved.', 'en')).toMatchObject({ incomplete: false, summary: 'Conditional plans\n• Possible profit only if approved.' });
  expect(repairs).toBe(1);
});

test('Task4c final missing row prevents acceptance even when every other source was context', async () => {
  windowedModel();
  model.mockImplementation(async (prompt) => {
    const p = JSON.parse(prompt) as Payload;
    if (p.sourceData) return generated(relations(p));
    if (p.draftData) { const v = supported(p) as { points: unknown[]; units: { sourceId: number }[] }; return generated({ ...v, units: v.units.filter(unit => unit.sourceId !== 7) }); }
    return generated({ format: 'bullets', points: [] });
  });
  const content = 'Repeat. Repeat. Repeat. Repeat. Repeat. Repeat. Final important fact.';
  expect(await generateGroundedSummary(content, 'en')).toMatchObject({ incomplete: true, summaryDocument: null });
});

test('Task4c documents semantic limitation: a bad model may classify important facts as context', async () => {
  installModel({ format: 'bullets', points: [] });
  const checkpoint = store();
  expect(await generateGroundedSummary('Do not send it. Do not send it.', 'en', { checkpoint })).toMatchObject({ incomplete: false, summary: '' });
  const final = checkpoint.data.get('summary:v1:final') as { verification: { verification: { units: unknown[] } }[] };
  expect(final.verification[0].verification.units).toEqual([
    { sourceId: 1, status: 'context', pointIds: [], supersededBy: [] },
    { sourceId: 2, status: 'context', pointIds: [], supersededBy: [] },
  ]);
  // Deliberate false-context counterexample: receipt integrity is not semantic correctness.
});

test('Task4c draft cache is bound to the exact formatted-request input and reserve', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const key = 'summary:v2:draft:1:2';
  const saved = checkpoint.data.get(key) as { scope: { wire?: { system: string; reserve: number } } };
  expect(saved.scope.wire?.system).toContain('Tekst źródłowy');
  expect(saved.scope.wire?.reserve).toBe(1024);
  checkpoint.data.set(key, { ...saved, scope: { ...saved.scope, wire: { ...saved.scope.wire, system: 'changed request' } } });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(model.mock.calls.filter(([prompt]) => !JSON.parse(prompt).draftData)).toHaveLength(1);
});

test('Task4c distant transitive corrections survive 67 sources, independent windows and final receipts', async () => {
  const texts = Array.from({ length: 67 }, (_, i) => i === 12 ? 'Zofia estimated the equipment cost at 17.' : i === 38 ? 'That equipment cost is now 23.' : i === 61 ? 'The final equipment cost is 29, only if approved.' : i === 66 ? 'Iga will not send the description by Wednesday.' : 'Repeated context.');
  const content = texts.join(' '), checkpoint = store();
  let localDrafts = 0, reconciliation = false, finalChecks = 0;
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const p = JSON.parse(userPrompt) as Payload;
    return p.sourceData || p.draftData || p.reconciliationData || p.repairData ? 100 : catalog(p).length > 4 ? 9000 : 100;
  });
  model.mockImplementation(async (prompt) => {
    const p = JSON.parse(prompt) as Payload;
    if (p.sourceData) {
      expect(p.sourceData).toHaveLength(67);
      expect(p.sourceData[12].text).toBe(texts[12]); expect(p.sourceData[66].text).toBe(texts[66]);
      return generated(relations(p, [[13, 39], [39, 62]], 'paragraph'));
    }
    if (p.draftData) {
      const result = supported(p) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      if (catalog(p).some(unit => unit.id === 13) && catalog(p).some(unit => unit.id === 62)) {
        expect(p.sourceCatalogData).toContain('[39] That equipment cost is now 23.');
        expect(p.draftData.points.some(point => point.sourceIds.includes(13) && point.sourceIds.includes(62))).toBe(true);
        result.units = result.units.map(unit => unit.sourceId === 13 || unit.sourceId === 39 ? { ...unit, status: 'superseded', pointIds: [], supersededBy: [unit.sourceId === 13 ? 39 : 62] } : unit);
        finalChecks += 1;
      }
      return generated(result);
    }
    if (p.reconciliationData) {
      reconciliation = true;
      expect(catalog(p).map(unit => unit.id)).toEqual([13, 39, 62]);
      return generated({ format: 'paragraph', points: [{ text: 'Zofia: equipment costs 29, only if approved.', sourceIds: [13, 62] }] });
    }
    localDrafts += 1;
    return generated({ format: 'paragraph', points: catalog(p).filter(unit => unit.id === 13 || unit.id === 39 || unit.id === 62 || unit.id === 67).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  const result = await generateGroundedSummary(content, 'en', { checkpoint });
  expect(result.incomplete).toBe(false); expect(localDrafts).toBeGreaterThan(1); expect(reconciliation).toBe(true); expect(finalChecks).toBeGreaterThan(0);
  expect(result.summary).toBe('Zofia: equipment costs 29, only if approved. Iga will not send the description by Wednesday.');
  const receipt = checkpoint.data.get('summary:v1:final') as { attemptedCalls: number; verification: { sourceIds: number[] }[] };
  expect(new Set(receipt.verification.flatMap(check => check.sourceIds)).size).toBe(67);
  expect(receipt.attemptedCalls).toBe(model.mock.calls.length); expect(receipt.attemptedCalls).toBeLessThanOrEqual(192);
  const ranges = result.summaryDocument!.points[0].sources;
  expect(ranges.map(range => content.slice(range.start, range.end))).toEqual([texts[12], texts[61]]);
});

test('Task4c conflicting verdicts across overlapping final scopes cannot publish', async () => {
  windowedModel();
  let finalCalls = 0;
  model.mockImplementation(async prompt => {
    const p = JSON.parse(prompt) as Payload;
    if (p.sourceData) return generated(relations(p, [[1, 3]]));
    if (p.draftData) {
      const v = supported(p) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
      // Final window scopes overlap at the shared correction component but have
      // distinct companion context sources (2 vs 4).
      if (catalog(p).some(u => u.id === 1) && catalog(p).some(u => u.id === 3) && catalog(p).length > 2) {
        finalCalls += 1;
        if (finalCalls > 1) v.units = v.units.map(u => u.sourceId === 1 ? { ...u, status: 'context', pointIds: [] } : u);
      }
      return generated(v);
    }
    return generated({ format: 'bullets', points: catalog(p).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
  });
  expect(await generateGroundedSummary('First. Second. Third. Fourth.', 'en')).toMatchObject({ incomplete: true, summaryDocument: null });
  expect(finalCalls).toBeGreaterThan(1);
});

test.each(['schema', 'targets', 'closure', 'plan', 'version', 'instructions', 'mapping', 'source-scope', 'final-draft'] as const)('Task4c changed %s invalidates page cache without resetting attempts', async field => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const previous = (checkpoint.data.get('summary:v1:final') as { attemptedCalls: number }).attemptedCalls;
  for (const [key, value] of checkpoint.data) if (key.startsWith('summary:v2:verify:') && !key.endsWith(':plan')) {
    const v = JSON.parse(JSON.stringify(value)) as { summaryProtocolVersion: number; scope: { groups: number[][];
      pointIndices: number[]; units: { text: string }[]; finalDraft: SummaryDraft;
      plan: { schema: object; prompt: string; reserve: number; system: string }[] } };
    if (field === 'schema') v.scope.plan[0].schema = { type: 'object' };
    if (field === 'targets') v.scope.plan[0].prompt = v.scope.plan[0].prompt.replace('"pointIds":[1,2]', '"pointIds":[1]');
    if (field === 'closure') v.scope.groups = [[1, 2]];
    if (field === 'plan') v.scope.plan[0].reserve += 1;
    if (field === 'version') v.summaryProtocolVersion = 1;
    if (field === 'instructions') v.scope.plan[0].system += '\nChanged verification instructions.';
    if (field === 'mapping') v.scope.pointIndices.reverse();
    if (field === 'source-scope') v.scope.units[0].text = 'A different original fact.';
    if (field === 'final-draft') v.scope.finalDraft = { ...completeDraft, points: [{ text: 'Different full draft.', sourceIds: [1] }] };
    checkpoint.data.set(key, v);
  }
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(model).toHaveBeenCalledTimes(1);
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: previous + 1 });
});

test('Task4c cached pages are reparsed and a forged final receipt cannot bypass audit', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  for (const [key, value] of checkpoint.data) if (key.startsWith('summary:v2:verify:') && !key.endsWith(':plan')) {
    checkpoint.data.set(key, { ...(value as object), verification: { points: [], units: [] } });
  }
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(model).toHaveBeenCalledTimes(1);
});

test('Task4c crash after durable claim is still charged on repeated resume', async () => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const final = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear(); checkpoint.data.set('summary:v1:final', { ...final, attemptedCalls: 191, repairUsed: true });
  checkpoint.write = async (key, value) => { checkpoint.data.set(key, value); throw new Error('crash after durable claim'); };
  model.mockClear();
  await expect(generateGroundedSummary(source, 'pl', { checkpoint })).rejects.toThrow('crash after durable claim');
  expect(model).not.toHaveBeenCalled();
  checkpoint.write = async (key, value) => { checkpoint.data.set(key, value); };
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
  expect(model).not.toHaveBeenCalled();
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: 192 });
});

test.each(['paragraph', 'grouped'] as const)('Task4c final multi-window %s repair invalidates every old audit and keeps qualifiers', async format => {
  windowedModel();
  let finalPhase = false, repaired = false;
  const afterRepair = new Set<number>();
  model.mockImplementation(async (prompt) => {
    const p = JSON.parse(prompt) as Payload;
    if (p.sourceData) return generated(relations(p, [], format));
    if (p.draftData) {
      if (catalog(p).some(unit => unit.id === 4)) finalPhase = true;
      const v = supported(p) as { points: unknown[]; units: { sourceId: number; status: string }[] };
      if (finalPhase && !repaired) v.units = v.units.map(u => u.sourceId === 2 ? { ...u, status: 'missing' } : u);
      if (repaired) for (const unit of catalog(p)) afterRepair.add(unit.id);
      return generated(v);
    }
    if (p.repairData) repaired = true;
    return generated({ format, points: catalog(p).filter(unit => unit.id !== 2 || repaired).map(unit => ({
      text: unit.text, sourceIds: [unit.id], ...(format === 'grouped' ? { group: 'Quiet reflection' } : {}),
    })) });
  });
  const checkpoint = store();
  const result = await generateGroundedSummary('I pause. I remain unsure. I might try again. I do not promise success.', 'en', { checkpoint });
  expect(result).toMatchObject({ incomplete: false, summaryDocument: { format } });
  expect(repaired).toBe(true);
  expect(result.summary).toContain('I remain unsure.'); expect(result.summary).toContain('I do not promise success.');
  expect([...afterRepair].sort()).toEqual([1, 2, 3, 4]);
  expect(result.summaryDocument!.points.every(point => format !== 'grouped' || point.group === 'Quiet reflection')).toBe(true);
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ repairUsed: true, draft: { format } });
});

test('Task4c persisted page plan records exact schema-aware prompt measurements', async () => {
  tokenCount.mockResolvedValue(137);
  const checkpoint = store();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  const plan = checkpoint.data.get('summary:v2:verify:1:2:plan') as { scope: { plan: { promptTokens: number; reserve: number }[] } };
  expect(plan.scope.plan.every(page => page.promptTokens === 137 && page.promptTokens + page.reserve + 24 <= 8192)).toBe(true);
});

test.each([
  ['sourceUnitPlanIdentity', '{}'], ['taskProofIdentity', '{}'],
  ['modelRuntimeIdentity', '["unknown",null,null,null,null,null,null,8192]'],
])('fix1 I2 invalid %s cannot renew either allowance on repeated resume', async (field, identity) => {
  const checkpoint = store();
  await generateGroundedSummary(source, 'pl', { checkpoint });
  const saved = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear();
  const exhausted = { ...saved, [field]: identity, attemptedCalls: 192, repairUsed: true };
  checkpoint.data.set('summary:v1:final', exhausted);
  model.mockClear();
  for (let resume = 0; resume < 2; resume += 1) {
    expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true, summaryDocument: null });
    expect(model).not.toHaveBeenCalled();
    expect(checkpoint.data.get('summary:v1:final')).toEqual(exhausted);
  }
});

test.each(['source', 'runtime', 'plan', 'proof'] as const)('fix1 I2 valid changed %s permits a new operation', async field => {
  const checkpoint = store();
  const oldSource = field === 'source' ? 'Old fact. Other fact.' : source;
  const plan = projectSourceUnitPlan(oldSource, oldSource.replace('. ', '.. '));
  expect(plan).not.toBeNull();
  const proof: FinalTaskEvidence = {
    tasks: ['Show the app'],
    evidence: [{ id: 'first', start: 0, end: 32, quote: source.slice(0, 32), kind: 'active', importance: 2, task: 'Show the app', change: false }],
    superseded: [], warnings: ['Reviewed'],
    reviewSpans: [{ start: 33, end: 56, quote: source.slice(33, 56), reason: 'Check negative' }],
  };
  await generateGroundedSummary(oldSource, 'pl', {
    checkpoint, ...(field === 'runtime' ? { runtimeOptions: { modelPath: 'old.gguf', execution: 'foreground' as const } } : {}),
    ...(field === 'plan' ? { sourceUnitPlan: plan! } : {}),
  }, field === 'proof' ? proof : undefined);
  const saved = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear(); checkpoint.data.set('summary:v1:final', { ...saved, attemptedCalls: 192, repairUsed: true });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(model).toHaveBeenCalledTimes(2);
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: 2, repairUsed: false });
});

const historicalModel: LoadedModelInfo = {
  modelPath: 'old.gguf', model: { url: 'https://example.test/old.gguf', filename: 'old.gguf', displayName: 'Old model',
    approxSizeMb: 2500, nGpuLayers: 99, nCtx: 8192, revision: 'pinned', sizeBytes: 1000,
    sha256: 'a'.repeat(64), architecture: 'qwen3', nextnPredictLayers: 0 },
  execution: 'foreground', speculative: false, gpu: true, devices: ['Metal'], reasonNoGPU: '', systemInfo: '', metadata: {},
};

test('fix1 I2 a complete valid changed loaded runtime permits a new operation', async () => {
  const checkpoint = store();
  jest.mocked(getLoadedModelInfo).mockReturnValue(historicalModel);
  await generateGroundedSummary(source, 'pl', { checkpoint, runtimeOptions: {
    modelPath: historicalModel.modelPath, model: historicalModel.model, execution: historicalModel.execution,
    speculative: historicalModel.speculative, signal: new AbortController().signal,
  } });
  const saved = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
  checkpoint.data.clear(); checkpoint.data.set('summary:v1:final', { ...saved, attemptedCalls: 192, repairUsed: true });
  jest.mocked(getLoadedModelInfo).mockReturnValue({ ...historicalModel, modelPath: 'new.gguf' });
  model.mockClear();
  expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: false });
  expect(model).toHaveBeenCalledTimes(2);
  expect(checkpoint.data.get('summary:v1:final')).toMatchObject({ attemptedCalls: 2, repairUsed: false });
});

test.each(['unknown-field', 'model-shape', 'runtime-context', 'runtime-options', 'plan-source', 'proof-source', 'proof-shape'] as const)(
  'fix1 I2 unrecognized or inconsistent %s cannot establish a new operation', async invalid => {
    const checkpoint = store();
    await generateGroundedSummary(source, 'pl', { checkpoint });
    const saved = checkpoint.data.get('summary:v1:final') as Record<string, unknown>;
    const runtime: unknown[] = [null, historicalModel.modelPath, historicalModel.model, historicalModel.execution,
      historicalModel.speculative, historicalModel.gpu, historicalModel.devices, 8192];
    if (invalid === 'unknown-field') runtime[0] = { unknown: true };
    if (invalid === 'model-shape') runtime[2] = {};
    if (invalid === 'runtime-context') runtime[7] = 4096;
    if (invalid === 'runtime-options') runtime[0] = { modelPath: 'different.gguf' };
    const binding: Record<string, unknown> = { ...saved, modelRuntimeIdentity: JSON.stringify(runtime), attemptedCalls: 192, repairUsed: true };
    if (invalid === 'plan-source') {
      const other = 'First fact. Second fact.';
      binding.sourceUnitPlanIdentity = JSON.stringify(projectSourceUnitPlan(other, 'First fact.. Second fact.'));
      expect(binding.sourceUnitPlanIdentity).not.toBe('null');
    }
    if (invalid === 'proof-source' || invalid === 'proof-shape') binding.taskProofIdentity = JSON.stringify({
      tasks: [], evidence: [{ id: '1', start: 0, end: 32, quote: invalid === 'proof-source' ? 'Wrong source' : source.slice(0, 32),
        kind: 'active', ...(invalid === 'proof-shape' ? {} : { importance: 2 }) }], superseded: [], warnings: [],
    });
    checkpoint.data.clear(); checkpoint.data.set('summary:v1:final', binding);
    model.mockClear();
    for (let resume = 0; resume < 2; resume += 1) {
      expect(await generateGroundedSummary(source, 'pl', { checkpoint })).toMatchObject({ incomplete: true });
      expect(model).not.toHaveBeenCalled();
      expect(checkpoint.data.get('summary:v1:final')).toEqual(binding);
    }
  },
);

test.each([1, 2])('fix1 I3 v%s task-expanded local orphan blocks discovery on repeated resume', async version => {
  windowedModel();
  tokenCount.mockImplementation(async ({ userPrompt }) => {
    const payload = JSON.parse(userPrompt) as Payload;
    if (payload.sourceData || payload.draftData || payload.reconciliationData || payload.repairData) return 100;
    const units = catalog(payload);
    return units.length > 2 && units.every((unit, index) => index === 0 || unit.id === units[index - 1].id + 1) ? 9000 : 100;
  });
  const content = 'Send report. Room blue. Door green. Cancel report.';
  const proof: FinalTaskEvidence = { tasks: [], evidence: [], warnings: [], superseded: [{
    earlier: { id: 'old', start: 0, end: 12, quote: 'Send report.', kind: 'active', importance: 1 },
    later: { id: 'new', start: 35, end: 49, quote: 'Cancel report.', kind: 'cancelled', importance: 1 },
  }] };
  const checkpoint = store();
  let local: Record<string, unknown> | undefined;
  checkpoint.write = async (key, value) => {
    checkpoint.data.set(key, value);
    const entry = value as { scope?: { units: { id: number }[] } };
    if (!local && key === 'summary:v2:draft:1:4' && entry.scope?.units.length === 3) {
      expect(entry.scope.units.map(unit => unit.id)).toEqual([1, 2, 4]);
      local = value as Record<string, unknown>;
    }
  };
  expect(await generateGroundedSummary(content, 'en', { checkpoint }, proof)).toMatchObject({ incomplete: false });
  expect(local).toBeDefined();
  const orphan = { ...local, summaryProtocolVersion: version, attemptedCalls: 192, repairUsed: true };
  checkpoint.data.clear(); checkpoint.data.set(`summary:v${version}:draft:1:4`, orphan);
  model.mockClear();
  for (let resume = 0; resume < 2; resume += 1) {
    expect(await generateGroundedSummary(content, 'en', { checkpoint }, proof)).toMatchObject({ incomplete: true });
    expect(model).not.toHaveBeenCalled();
    expect(checkpoint.data.has('summary:v1:final')).toBe(false);
    expect(checkpoint.data.get(`summary:v${version}:draft:1:4`)).toEqual(orphan);
  }
});
