import { renderSummaryDocument, type SummaryDocument } from '../domain/summary';
import type { Language } from '../i18n/language';
import { generate, getContextWindowSize, getLoadedModelInfo, measureFormattedPromptTokens } from './llm';
import { recordGeneration } from './generationMetrics';
import { PIPELINE_VERSION, sourceExecutionView, throwIfProcessingAborted, type FinalTaskEvidence, type ProcessingExecutionContext } from './processingContext';
import { isIncompleteGeneration, type PromptRequest } from './sourcePipeline';
import { hasUnsupportedRequiredTaskContext, validateSourceUnitPlan } from './sourceUnits';
import { createSummarySources, type SummarySourceUnit } from './summarySources';
import {
  documentFromSummaryDraft, isCompleteSummaryVerification, parseSummaryDraft,
  summaryDraftRequest, summaryDraftSchema, summaryVerificationPageRequest, parseSummaryVerificationPage, assembleSummaryVerification,
  summaryRelationPageRequest, parseSummaryRelationPage,
  type SummaryDraft, type SummaryVerification, type SummaryWireRequest, type SummaryCheckTargets, type SummaryCheckPage,
} from './summaryProtocol';
import { planSummaryWindows } from './summaryWindowBudget';

export interface GroundedSummaryResult {
  readonly summary: string;
  readonly summaryDocument: SummaryDocument | null;
  readonly incomplete: boolean;
  readonly warnings: readonly string[];
}

type SummaryDecision = { readonly kind: 'document'; readonly document: SummaryDocument } |
  { readonly kind: 'empty' } | { readonly kind: 'incomplete' };
interface SummaryWindow { readonly units: readonly SummarySourceUnit[]; readonly firstId: number; readonly lastId: number }
interface CheckedDraft { readonly draft: SummaryDraft; readonly verification: SummaryVerification }
const overBudget = 'over-budget' as const;
interface ReviewScope { readonly units: readonly SummarySourceUnit[]; readonly draft: SummaryDraft; readonly pointIndices: readonly number[] }
const incomplete: SummaryDecision = { kind: 'incomplete' };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const ids = (units: readonly SummarySourceUnit[]): readonly number[] => units.map(unit => unit.id);
const unitChars = (units: readonly SummarySourceUnit[]): number => units.reduce((sum, unit) => sum + unit.text.length, 0);
const overlaps = (left: { start: number; end: number }, right: { start: number; end: number }): boolean => left.start < right.end && right.start < left.end;

// Task evidence is additional context. Every catalog unit still participates in
// the final audit, including units with no task evidence at all.
const scopedProof = (proof: FinalTaskEvidence | undefined, units: readonly SummarySourceUnit[]): FinalTaskEvidence | undefined => {
  if (!proof) return undefined;
  const relevant = (span: { start: number; end: number }): boolean => units.some(unit => overlaps(unit, span));
  const evidence = proof.evidence.filter(relevant);
  const anchoredTasks = new Set(proof.evidence.flatMap(entry => entry.task ? [entry.task] : []));
  return {
    tasks: [...proof.tasks.filter(task => !anchoredTasks.has(task)), ...evidence.flatMap(entry => entry.task ? [entry.task] : [])], evidence,
    superseded: proof.superseded.filter(pair => relevant(pair.earlier) || relevant(pair.later)),
    warnings: proof.warnings, reviewSpans: proof.reviewSpans?.filter(relevant),
  };
};

const runtimeIdentity = (execution?: ProcessingExecutionContext): string => {
  const loaded = getLoadedModelInfo();
  return JSON.stringify([execution?.runtimeOptions ?? null, loaded?.modelPath, loaded?.model,
    loaded?.execution, loaded?.speculative, loaded?.gpu, loaded?.devices, getContextWindowSize()]);
};

const hasShape = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const textValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
// These are the persisted fields of ModelConfig and ModelLoadOptions, not a
// guess that an arbitrary JSON object denotes a new loaded runtime.
const validModel = (value: unknown): value is Record<string, unknown> => isRecord(value) &&
  hasShape(value, ['url', 'filename', 'displayName', 'approxSizeMb', 'nGpuLayers', 'nCtx'],
    ['revision', 'sizeBytes', 'sha256', 'architecture', 'nextnPredictLayers']) &&
  ['url', 'filename', 'displayName'].every(key => textValue(value[key])) &&
  typeof value.approxSizeMb === 'number' && Number.isFinite(value.approxSizeMb) && value.approxSizeMb > 0 &&
  Number.isSafeInteger(value.nGpuLayers) && positiveInteger(value.nCtx) &&
  ['revision', 'sha256', 'architecture'].every(key => value[key] === undefined || textValue(value[key])) &&
  (value.sizeBytes === undefined || positiveInteger(value.sizeBytes)) &&
  (value.nextnPredictLayers === undefined || (Number.isSafeInteger(value.nextnPredictLayers) && (value.nextnPredictLayers as number) >= 0));
const executionProfile = (value: unknown): boolean => value === 'foreground' || value === 'background-cpu';
const validRuntime = (value: unknown): boolean => {
  if (!Array.isArray(value) || value.length !== 8 || !positiveInteger(value[7])) return false;
  const [options, path, model, execution, speculative, gpu, devices, context] = value as unknown[];
  if (options !== null && (!isRecord(options) ||
    !hasShape(options, [], ['modelPath', 'execution', 'model', 'speculative', 'signal']) ||
    (options.modelPath !== undefined && !textValue(options.modelPath)) ||
    (options.execution !== undefined && !executionProfile(options.execution)) ||
    (options.model !== undefined && !validModel(options.model)) ||
    (options.speculative !== undefined && typeof options.speculative !== 'boolean') ||
    // A standard AbortSignal serializes as an empty object. An unfamiliar
    // serialization cannot establish a trustworthy historical identity.
    (options.signal !== undefined && (!isRecord(options.signal) || !hasShape(options.signal, []))))) return false;
  if ([path, model, execution, speculative, gpu, devices].every(field => field === null)) return true;
  if (!textValue(path) || !validModel(model) || !executionProfile(execution) ||
    typeof speculative !== 'boolean' || typeof gpu !== 'boolean' ||
    !Array.isArray(devices) || !devices.every(textValue) || context !== model.nCtx) return false;
  return options === null || (isRecord(options) &&
    (options.modelPath === undefined || options.modelPath === path) &&
    (options.model === undefined || same(options.model, model)) &&
    (options.execution === undefined || options.execution === execution) &&
    (options.speculative === undefined || options.speculative === speculative));
};
const validProof = (value: unknown, source: string): boolean => {
  if (value === null) return true;
  const span = (entry: Record<string, unknown>): boolean => Number.isSafeInteger(entry.start) && Number.isSafeInteger(entry.end) &&
    (entry.start as number) >= 0 && (entry.end as number) > (entry.start as number) && (entry.end as number) <= source.length &&
    textValue(entry.quote) && source.slice(entry.start as number, entry.end as number) === entry.quote;
  const evidence = (entry: unknown): boolean => isRecord(entry) &&
    hasShape(entry, ['id', 'start', 'end', 'quote', 'kind', 'importance'], ['task', 'change']) && span(entry) && textValue(entry.id) &&
    ['fact', 'decision', 'open_question', 'social', 'active', 'cancelled', 'uncertain'].includes(entry.kind as string) &&
    [1, 2, 3].includes(entry.importance as number) && (entry.task === undefined || textValue(entry.task)) &&
    (entry.change === undefined || typeof entry.change === 'boolean');
  return isRecord(value) && hasShape(value, ['tasks', 'evidence', 'superseded', 'warnings'], ['reviewSpans']) &&
    Array.isArray(value.tasks) && value.tasks.every(textValue) && Array.isArray(value.evidence) && value.evidence.every(evidence) &&
    Array.isArray(value.warnings) && value.warnings.every(entry => typeof entry === 'string') &&
    Array.isArray(value.superseded) && value.superseded.every(pair => isRecord(pair) && hasShape(pair, ['earlier', 'later']) &&
      evidence(pair.earlier) && evidence(pair.later) &&
      (pair.earlier as { start: number }).start < (pair.later as { start: number }).start) &&
    (value.reviewSpans === undefined || (Array.isArray(value.reviewSpans) && value.reviewSpans.every(entry =>
      isRecord(entry) && hasShape(entry, ['start', 'end', 'quote', 'reason']) && span(entry) && textValue(entry.reason))));
};
const recognizedBinding = (saved: Record<string, unknown>): boolean => {
  if (saved.pipeline !== PIPELINE_VERSION || typeof saved.source !== 'string' ||
    (saved.language !== 'en' && saved.language !== 'pl') ||
    typeof saved.modelRuntimeIdentity !== 'string' || typeof saved.sourceUnitPlanIdentity !== 'string' ||
    typeof saved.taskProofIdentity !== 'string') return false;
  try {
    const runtime: unknown = JSON.parse(saved.modelRuntimeIdentity);
    const plan: unknown = JSON.parse(saved.sourceUnitPlanIdentity);
    const proof: unknown = JSON.parse(saved.taskProofIdentity);
    if (plan !== null) validateSourceUnitPlan(saved.source, plan);
    return validRuntime(runtime) && validProof(proof, saved.source);
  } catch { return false; }
};

const createSession = (content: string, language: Language, execution: ProcessingExecutionContext, taskProof?: FinalTaskEvidence) => {
  const owner = getLoadedModelInfo();
  const signal = execution.signal;
  const checkpoint = execution.checkpoint;
  const plan = execution.sourceUnitPlan;
  const sourceUnitPlanIdentity = JSON.stringify(plan ?? null);
  const modelRuntimeIdentity = runtimeIdentity(execution);
  const taskProofIdentity = JSON.stringify(taskProof ?? null);
  let calls = 0;
  let repairUsed = false;
  const memory = new Map<string, unknown>();
  const assertRuntime = (): void => {
    throwIfProcessingAborted(execution);
    const requested = execution.runtimeOptions;
    if (owner && requested && (
      (requested.modelPath !== undefined && requested.modelPath !== owner.modelPath) ||
      (requested.execution !== undefined && requested.execution !== owner.execution) ||
      (requested.speculative !== undefined && requested.speculative !== owner.speculative) ||
      (requested.model !== undefined && !same(requested.model, owner.model))))
      throw new Error('Summary requested runtime does not match the loaded model');
    if (owner !== getLoadedModelInfo() || signal !== execution.signal || checkpoint !== execution.checkpoint ||
      plan !== execution.sourceUnitPlan || sourceUnitPlanIdentity !== JSON.stringify(execution.sourceUnitPlan ?? null) ||
      modelRuntimeIdentity !== runtimeIdentity(execution) || taskProofIdentity !== JSON.stringify(taskProof ?? null))
      throw new Error('Summary runtime changed during processing');
  };
  const measure = async (request: PromptRequest, schema: Readonly<Record<string, unknown>>): Promise<number> => {
    assertRuntime();
    const count = await measureFormattedPromptTokens({ systemPrompt: request.system, userPrompt: request.prompt(''), jsonSchema: schema });
    assertRuntime();
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid summary token measurement');
    return count;
  };
  const fits = async (request: PromptRequest, schema: Readonly<Record<string, unknown>>): Promise<boolean> =>
    (await measure(request, schema)) + request.nPredict + 24 <= getContextWindowSize();
  const fitDraft = async (request: PromptRequest, schema: Readonly<Record<string, unknown>>): Promise<PromptRequest | null> => {
    const available = getContextWindowSize() - (await measure(request, schema)) - 24;
    assertRuntime();
    return available > 0 ? { ...request, nPredict: Math.min(request.nPredict, available) } : null;
  };
  const runSummaryRequest = async (request: PromptRequest, schema: Readonly<Record<string, unknown>>, phase: string, sourceChars: number): Promise<string | null> => {
    assertRuntime();
    if (calls >= 192 || !(await fits(request, schema))) return null;
    assertRuntime();
    calls += 1;
    // Claim the attempt durably before the model await. Interrupted completions
    // still consumed work, and resuming this operation must not renew its cap.
    const saved = await read('summary:v1:final');
    await write('summary:v1:final', { ...saved, draft: saved?.draft ?? null,
      verification: saved?.verification ?? null, repairUsed });
    const prompt = request.prompt('');
    const result = await generate(prompt, () => undefined, { system: request.system, jsonSchema: schema,
      temperature: 0.1, nPredict: request.nPredict, signal: execution.signal });
    assertRuntime();
    recordGeneration(phase, prompt.length, result, sourceChars);
    return isIncompleteGeneration(result) ? null : result.text;
  };
  const binding = { pipeline: PIPELINE_VERSION, source: content, language, sourceUnitPlanIdentity, modelRuntimeIdentity, taskProofIdentity };
  let journalPresent = false;
  const rawRead = async (key: string): Promise<unknown> => {
    assertRuntime();
    const saved = memory.has(key) ? memory.get(key) : await checkpoint?.read(key);
    assertRuntime();
    return saved;
  };
  const matches = (saved: unknown): saved is Record<string, unknown> =>
    isRecord(saved) && Object.entries(binding).every(([field, value]) => saved[field] === value);
  const read = async (key: string): Promise<Record<string, unknown> | null> => {
    const saved = await rawRead(key);
    if (key === 'summary:v1:final') return matches(saved) ? saved : null;
    // A surviving same-operation artifact without a journal cannot grant a new budget.
    const legacy = !journalPresent ? await rawRead(key.replace('summary:v2:', 'summary:v1:')) : null;
    if (!journalPresent && (matches(saved) || matches(legacy))) { calls = 192; repairUsed = true; }
    return matches(saved) && saved.summaryProtocolVersion === 2 ? saved : null;
  };
  const write = async (key: string, value: Record<string, unknown>): Promise<void> => {
    assertRuntime();
    const envelope = { ...binding, ...value, summaryProtocolVersion: 2, attemptedCalls: calls };
    await checkpoint?.write(key, envelope);
    assertRuntime();
    memory.set(key, envelope);
    if (key === 'summary:v1:final') journalPresent = true;
  };
  const initialize = async (): Promise<void> => {
    const saved = await rawRead('summary:v1:final');
    if (saved === null || saved === undefined) return;
    if (!matches(saved)) {
      // Only a fully specified, clearly different operation permits starting over.
      if (isRecord(saved) && recognizedBinding(saved)) return;
      calls = 192; repairUsed = true; return;
    }
    journalPresent = true;
    repairUsed = saved.repairUsed !== false;
    calls = typeof saved.attemptedCalls === 'number' && Number.isSafeInteger(saved.attemptedCalls) &&
      saved.attemptedCalls >= 0 && saved.attemptedCalls <= 192 ? saved.attemptedCalls : 192;
  };
  const inspectOrphans = async (windows: readonly SummaryWindow[]): Promise<void> => {
    if (journalPresent) return;
    for (const window of windows) {
      for (const version of [1, 2]) {
        const saved = await rawRead(`summary:v${version}:draft:${window.firstId}:${window.lastId}`);
        if (matches(saved)) { calls = 192; repairUsed = true; }
      }
    }
    const relations = await rawRead('summary:v2:relations:0');
    if (matches(relations)) { calls = 192; repairUsed = true; }
  };
  const consumeRepair = async (): Promise<boolean> => {
    if (repairUsed) return false;
    repairUsed = true;
    await write('summary:v1:final', { draft: null, verification: null, repairUsed });
    return true;
  };
  return { fits, measure, fitDraft, runSummaryRequest, read, write, assertRuntime, consumeRepair, initialize, inspectOrphans,
    repairWasUsed: (): boolean => repairUsed };
};
type Session = ReturnType<typeof createSession>;

// Each candidate is a new closed-over request; changing a transport string
// would not change the protocol payload or its actual tokenizer cost.
const budgetSummaryWindows = async (
  units: readonly SummarySourceUnit[], language: Language, session: Session,
): Promise<readonly SummaryWindow[]> =>
  planSummaryWindows(units, candidate =>
    session.fits(summaryDraftRequest(candidate, language), summaryDraftSchema(candidate)));

const requestWithData = (base: PromptRequest, field: string, data: unknown, instruction: string): PromptRequest => ({
  ...base, system: `${base.system}\n${instruction}`,
  prompt: () => JSON.stringify({ ...(JSON.parse(base.prompt('')) as Record<string, unknown>), [field]: data }),
});

interface PlannedCheckPage extends SummaryWireRequest { readonly targets: SummaryCheckTargets; readonly promptTokens: number }

// Split only response rows. Each candidate keeps the full, identical context.
const planPages = async <T>(targets: readonly T[], build: (part: readonly T[], first: boolean) => SummaryWireRequest, session: Session): Promise<readonly { wire: SummaryWireRequest; targets: readonly T[]; promptTokens: number }[] | null> => {
  const pending = [targets];
  const pages: { wire: SummaryWireRequest; targets: readonly T[]; promptTokens: number }[] = [];
  while (pending.length) {
    const part = pending.shift()!;
    const wire = build(part, pages.length === 0);
    const promptTokens = await session.measure(wire.request, wire.schema);
    session.assertRuntime();
    if (promptTokens + wire.request.nPredict + 24 <= getContextWindowSize()) { pages.push({ wire, targets: part, promptTokens }); continue; }
    if (part.length <= 1) return null;
    const middle = Math.ceil(part.length / 2);
    pending.unshift(part.slice(0, middle), part.slice(middle));
  }
  return pages;
};
const planVerificationPages = async (scope: ReviewScope, language: Language, session: Session, taskProof?: FinalTaskEvidence): Promise<readonly PlannedCheckPage[] | null> => {
  const targets = [...scope.draft.points.map((_, i) => ({ point: true, id: i + 1 })), ...scope.units.map(unit => ({ point: false, id: unit.id }))];
  const toTargets = (rows: readonly { point: boolean; id: number }[]): SummaryCheckTargets => ({
    pointIds: rows.filter(row => row.point).map(row => row.id), sourceIds: rows.filter(row => !row.point).map(row => row.id),
  });
  const planned = await planPages(targets, rows => summaryVerificationPageRequest(scope.units, scope.draft, toTargets(rows), language, scopedProof(taskProof, scope.units)), session);
  return planned?.map(page => ({ ...page.wire, targets: toTargets(page.targets), promptTokens: page.promptTokens })) ?? null;
};
const wireBinding = (wire: SummaryWireRequest) => ({ system: wire.request.system, prompt: wire.request.prompt(''), schema: wire.schema, reserve: wire.request.nPredict, reservePolicy: 'ascii-whitespace22-eos1-v2' });
const verify = async (
  units: readonly SummarySourceUnit[], draft: SummaryDraft, language: Language, session: Session,
  taskProof?: FinalTaskEvidence, finalDraft?: SummaryDraft, pointIndices?: readonly number[],
): Promise<SummaryVerification | typeof overBudget | null> => {
  const scope = { units, draft, pointIndices: pointIndices ?? draft.points.map((_, index) => index) };
  const plan = await planVerificationPages(scope, language, session, taskProof);
  if (!plan) return overBudget;
  const key = `summary:v2:verify:${units[0].id}:${units[units.length - 1].id}`;
  // reviewScope has already materialized relationship closure into exact units
  // and point mapping. Its grouping history is not a verifier input: a local
  // and final audit may have identical effective scope after finding a correction.
  // Keep the full draft, exact wire/schema/targets/reserve and operation envelope
  // bound; an actual closure/input change still invalidates every cached page.
  const binding = { units, draft, finalDraft: finalDraft ?? draft, pointIndices: scope.pointIndices, plan: plan.map(page => ({ ...wireBinding(page), promptTokens: page.promptTokens })) };
  await session.write(`${key}:plan`, { scope: binding });
  const pages: SummaryCheckPage[] = [];
  for (let index = 0; index < plan.length; index += 1) {
    const page = plan[index];
    const saved = await session.read(`${key}:${index}`);
    let parsed = saved && same(saved.scope, binding) ? parseSummaryVerificationPage(JSON.stringify(saved.verification), units, draft, page.targets) : null;
    if (!parsed) {
      const raw = await session.runSummaryRequest(page.request, page.schema, 'summary-verify', unitChars(units));
      parsed = raw === null ? null : parseSummaryVerificationPage(raw, units, draft, page.targets);
      if (!parsed) return null;
      await session.write(`${key}:${index}`, { scope: binding, draft, verification: parsed.verification });
    }
    pages.push(parsed);
  }
  return assembleSummaryVerification(pages, units, draft);
};

const literalRepair = (
  units: readonly SummarySourceUnit[], draft: SummaryDraft, verification: SummaryVerification | null, taskProof?: FinalTaskEvidence,
): SummaryDraft | null => {
  if (draft.format === 'grouped' || !verification || verification.units.some(unit => unit.status !== 'covered' && unit.status !== 'context') ||
    taskProof?.reviewSpans?.length || taskProof?.superseded.length) return null;
  const rejected = verification.points.filter(point => point.status !== 'supported');
  if (!rejected.length || rejected.some(point => point.issues.some(issue => ['correction', 'condition', 'uncertainty'].includes(issue)))) return null;
  const points = draft.points.map((point, index) => {
    if (!rejected.some(check => check.pointId === index + 1)) return point;
    const sources = units.filter(unit => point.sourceIds.includes(unit.id));
    if (sources.some(unit => hasUnsupportedRequiredTaskContext(unit.text))) return null;
    return { text: sources.map(unit => unit.text).join(' '), sourceIds: point.sourceIds };
  });
  if (points.some(point => point === null)) return null;
  return { format: draft.format, points: points.map(point => ({ text: point!.text, sourceIds: point!.sourceIds })) };
};

const checkedDraft = async (
  units: readonly SummarySourceUnit[], language: Language, session: Session, taskProof?: FinalTaskEvidence,
  initial?: SummaryDraft, reconciliation?: SummaryDraft, initialVerification?: SummaryVerification | null, format?: SummaryDraft['format'], groups: readonly (readonly number[])[] = [],
): Promise<CheckedDraft | typeof overBudget | null> => {
  const key = `summary:v2:draft:${units[0].id}:${units[units.length - 1].id}`;
  // The same rendered units are re-sent in both the draft and its repair.
  const sourceChars = unitChars(units);
  let draft = initial ?? null;
  format = format ?? initial?.format ?? reconciliation?.format;
  const schema = summaryDraftSchema(units, format);
  const base = summaryDraftRequest(units, language);
  const request = reconciliation ? requestWithData(base, 'reconciliationData', reconciliation,
    'Reconcile these related draft points using ONLY the complete supplied original units. Preserve final corrections and uncertainty. Earlier local drafts are fallible data.') : base;
  const fitted = initial ? request : reconciliation ? await session.fitDraft(request, schema) : await session.fits(request, schema) ? request : null;
  if (!fitted) return overBudget;
  const draftBinding = { units, format: format ?? null, reconciliation: reconciliation ?? null, schema, groups,
    wire: wireBinding({ request: fitted, schema, maxWireBytes: null }), reservePolicy: 'exact-free-context-v2' };
  if (!draft) {
    const saved = await session.read(key);
    if (saved && same(saved.scope, draftBinding))
      draft = parseSummaryDraft(JSON.stringify(saved.draft), units);
    if (draft && format && draft.format !== format) draft = null;
    if (!draft) {
      const raw = await session.runSummaryRequest(fitted, schema, 'summary-draft', sourceChars);
      draft = raw === null ? null : parseSummaryDraft(raw, units);
      if (draft && format && draft.format !== format) draft = null;
      if (draft) await session.write(key, { scope: draftBinding, draft, verification: null });
    }
  }
  let verification = initialVerification !== undefined ? initialVerification : draft ? await verify(units, draft, language, session, taskProof) : null;
  if (verification === overBudget) return overBudget;
  if (draft && verification && isCompleteSummaryVerification(verification, draft)) return { draft, verification };
  if (!(await session.consumeRepair())) return null;
  const literal = draft ? literalRepair(units, draft, verification, taskProof) : null;
  if (literal) draft = literal;
  else {
    const request = requestWithData(summaryDraftRequest(units, language), 'repairData', { draft, verification },
      'Repair this invalid or incomplete draft against ALL supplied original sources. Correct meaning and missing distinct facts. Return the complete corrected draft, not a patch.');
    const repairFormat = format ?? draft?.format;
    const repairSchema = summaryDraftSchema(units, repairFormat);
    const fitted = await session.fitDraft(request, repairSchema);
    const raw = fitted ? await session.runSummaryRequest(fitted, repairSchema, 'summary-repair', sourceChars) : null;
    draft = raw === null ? null : parseSummaryDraft(raw, units);
    if (draft && repairFormat && draft.format !== repairFormat) draft = null;
  }
  if (!draft) return null;
  await session.write(key, { scope: draftBinding, draft, verification: null });
  verification = await verify(units, draft, language, session, taskProof);
  if (verification === overBudget) return overBudget;
  if (!verification || !isCompleteSummaryVerification(verification, draft)) return null;
  await session.write(key, { scope: draftBinding, draft, verification });
  return { draft, verification };
};

const discoverRelations = async (
  units: readonly SummarySourceUnit[], language: Language, session: Session,
): Promise<{ groups: readonly (readonly number[])[]; format: SummaryDraft['format'] } | null> => {
  const plan = await planPages(ids(units), (targets, first) => summaryRelationPageRequest(units, targets, language, first), session);
  if (!plan) return null;
  const binding = { units, plan: plan.map(page => ({ ...wireBinding(page.wire), promptTokens: page.promptTokens })) };
  await session.write('summary:v2:relations:plan', { scope: binding });
  const groups: number[][] = [];
  let format: SummaryDraft['format'] | undefined;
  for (let index = 0; index < plan.length; index += 1) {
    const page = plan[index];
    const key = `summary:v2:relations:${index}`;
    const saved = await session.read(key);
    let result = saved && same(saved.scope, binding) ? parseSummaryRelationPage(JSON.stringify(saved.relations), units, page.targets, index === 0) : null;
    if (!result) {
      const raw = await session.runSummaryRequest(page.wire.request, page.wire.schema, 'summary-relations', unitChars(units));
      result = raw === null ? null : parseSummaryRelationPage(raw, units, page.targets, index === 0);
      if (!result) return null;
      await session.write(key, { scope: binding, relations: result });
    }
    if (result.rows.some(row => row.unresolved)) return null;
    if (index === 0) format = result.format;
    for (const row of result.rows) if (row.relatedEarlier.length) groups.push([Number(row.source.slice(1)), ...row.relatedEarlier.map(ref => Number(ref.slice(1)))]);
  }
  return format ? { groups, format } : null;
};
const correctionGroups = (verification: SummaryVerification): readonly (readonly number[])[] =>
  verification.units.filter(unit => unit.supersededBy.length).map(unit => [unit.sourceId, ...unit.supersededBy]);

const reviewScope = (
  seedIds: readonly number[], units: readonly SummarySourceUnit[], draft: SummaryDraft,
  groups: readonly (readonly number[])[], taskProof?: FinalTaskEvidence,
): ReviewScope => {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const edges = [...draft.points.map(point => point.sourceIds), ...groups,
    ...(taskProof?.superseded ?? []).map(pair => units.filter(unit => overlaps(unit, pair.earlier) || overlaps(unit, pair.later)).map(unit => unit.id)),
    ...[...taskProof?.evidence ?? [], ...taskProof?.reviewSpans ?? []].map(span => units.filter(unit => overlaps(unit, span)).map(unit => unit.id))];
  const incidence = new Map<number, number[]>();
  edges.forEach((edge, index) => edge.forEach(id => {
    if (!byId.has(id)) throw new Error('Unknown summary closure source');
    const entries = incidence.get(id) ?? []; entries.push(index); incidence.set(id, entries);
  }));
  const selected = new Set(seedIds);
  const pending = [...seedIds];
  const visitedEdges = new Set<number>();
  for (let index = 0; index < pending.length; index += 1) {
    for (const edge of incidence.get(pending[index]) ?? []) {
      if (visitedEdges.has(edge)) continue;
      visitedEdges.add(edge);
      for (const id of edges[edge]) if (!selected.has(id)) { selected.add(id); pending.push(id); }
    }
  }
  const pointIndices = draft.points.flatMap((point, index) => point.sourceIds.some(id => selected.has(id)) ? [index] : []);
  return { units: units.filter(unit => selected.has(unit.id)), draft: { format: draft.format, points: pointIndices.map(index => draft.points[index]) }, pointIndices };
};

const generateAndCheckSummary = async (
  units: readonly SummarySourceUnit[], content: string, language: Language, execution: ProcessingExecutionContext, taskProof?: FinalTaskEvidence,
): Promise<SummaryDecision> => {
  const session = createSession(content, language, execution, taskProof);
  await session.initialize();
  const windows = await budgetSummaryWindows(units, language, session);
  if (!windows.length) return incomplete;
  const localScopes = windows.map(window => reviewScope(ids(window.units), units, { format: 'bullets', points: [] }, [], taskProof));
  await session.inspectOrphans([...windows, ...localScopes.map(scope => ({ units: scope.units,
    firstId: scope.units[0].id, lastId: scope.units[scope.units.length - 1].id }))]);
  let format: SummaryDraft['format'] | undefined;
  let groups: readonly (readonly number[])[] = [];
  if (windows.length > 1) {
    const relations = await discoverRelations(units, language, session);
    if (!relations) return incomplete;
    groups = relations.groups; format = relations.format;
  }
  const local: CheckedDraft[] = [];
  const processed = windows;
  for (const context of localScopes) {
    const result = await checkedDraft(context.units, language, session, taskProof, undefined, undefined, undefined, format);
    // Never subdivide original context because generated verifier output is large.
    if (!result || result === overBudget) return incomplete;
    local.push(result);
  }
  format = format ?? local[0].draft.format;
  let draft: SummaryDraft = local.length === 1 ? local[0].draft : { format, points: local.flatMap(item => item.draft.points) };
  groups = [...groups, ...local.flatMap(item => correctionGroups(item.verification)), ...(taskProof?.superseded ?? []).map(pair =>
    units.filter(unit => overlaps(unit, pair.earlier) || overlaps(unit, pair.later)).map(unit => unit.id))];
  if (local.length > 1) {
    const done = new Set<number>();
    for (const group of groups) {
      if (group.every(id => done.has(id))) continue;
      const scope = reviewScope(group, units, draft, groups, taskProof);
      const result = await checkedDraft(scope.units, language, session, taskProof, undefined, scope.draft, undefined, format, groups);
      if (!result || result === overBudget) return incomplete;
      const replaced = new Set(scope.pointIndices);
      draft = { format, points: [...draft.points.filter((_, index) => !replaced.has(index)), ...result.draft.points]
        .sort((left, right) => Math.min(...left.sourceIds) - Math.min(...right.sourceIds)) };
      groups = [...groups, ...correctionGroups(result.verification)];
      for (const unit of scope.units) done.add(unit.id);
    }
  }
  if (!draft.points.length && (taskProof?.tasks.length || taskProof?.evidence.some(item => item.kind === 'active') || taskProof?.reviewSpans?.length)) return incomplete;
  for (let audit = 0; audit < 2; audit += 1) {
    const checkedPoints = new Set<number>();
    const checkedUnits = new Map<number, string>();
    const finalChecks: unknown[] = [];
    const seenScopes = new Set<string>();
    let restart = false;
    for (const window of processed) {
      const scope = reviewScope(ids(window.units), units, draft, groups, taskProof);
      const scopeIdentity = JSON.stringify([ids(scope.units), scope.pointIndices]);
      if (seenScopes.has(scopeIdentity)) continue;
      seenScopes.add(scopeIdentity);
      const verification = await verify(scope.units, scope.draft, language, session, taskProof, draft, scope.pointIndices);
      if (verification === overBudget) return incomplete;
      if (!verification || !isCompleteSummaryVerification(verification, scope.draft)) {
        if (audit !== 0) return incomplete;
        const repaired = await checkedDraft(scope.units, language, session, taskProof, scope.draft, undefined, verification, format, groups);
        if (!repaired || repaired === overBudget) return incomplete;
        const replaced = new Set(scope.pointIndices);
        draft = { format, points: [
          ...draft.points.filter((_, index) => !replaced.has(index)), ...repaired.draft.points,
        ]
          .sort((left, right) => Math.min(...left.sourceIds) - Math.min(...right.sourceIds)) };
        groups = [...groups, ...correctionGroups(repaired.verification)];
        restart = true;
        break;
      }
      for (const point of verification.points) checkedPoints.add(scope.pointIndices[point.pointId - 1]);
      for (const unit of verification.units) {
        const normalized = JSON.stringify({ status: unit.status, pointIds: unit.pointIds.map(id => scope.pointIndices[id - 1]).sort((a, b) => a - b), supersededBy: [...unit.supersededBy].sort((a, b) => a - b) });
        if (checkedUnits.has(unit.sourceId) && checkedUnits.get(unit.sourceId) !== normalized) return incomplete;
        checkedUnits.set(unit.sourceId, normalized);
      }
      finalChecks.push({ sourceIds: ids(scope.units), pointIndices: scope.pointIndices, verification });
      groups = [...groups, ...correctionGroups(verification).filter(group => !groups.some(existing => same(existing, group)))];
    }
    if (restart) continue;
    if (checkedPoints.size !== draft.points.length || checkedUnits.size !== units.length) return incomplete;
    if (!draft.points.length && (taskProof?.tasks.length || taskProof?.evidence.some(item => item.kind === 'active') || taskProof?.reviewSpans?.length)) return incomplete;
    await session.write('summary:v1:final', { draft, verification: finalChecks, repairUsed: session.repairWasUsed() });
    session.assertRuntime();
    if (!draft.points.length) return { kind: 'empty' };
    const document = documentFromSummaryDraft(content, draft, units);
    return document ? { kind: 'document', document } : incomplete;
  }
  return incomplete;
};

export const generateGroundedSummary = async (
  content: string, language: Language, execution?: ProcessingExecutionContext, taskProof?: FinalTaskEvidence,
): Promise<GroundedSummaryResult> => {
  throwIfProcessingAborted(execution);
  const view = sourceExecutionView(content, execution);
  const units = createSummarySources(content, view.sourceUnitPlan);
  const candidate = units.length ? await generateAndCheckSummary(units, content, language, view, taskProof)
    : taskProof?.tasks.length || taskProof?.evidence.some(item => item.kind === 'active') || taskProof?.reviewSpans?.length
      ? incomplete : { kind: 'empty' } as const;
  throwIfProcessingAborted(view);
  if (candidate.kind === 'incomplete') return { summary: '', summaryDocument: null, incomplete: true, warnings: [language === 'en'
    ? 'The summary could not be verified. Your complete transcript has been kept.'
    : 'Nie udało się sprawdzić podsumowania. Pełna transkrypcja została zachowana.'] };
  if (candidate.kind === 'empty') return { summary: '', summaryDocument: null, incomplete: false, warnings: [] };
  return { summary: renderSummaryDocument(candidate.document), summaryDocument: candidate.document, incomplete: false, warnings: [] };
};
