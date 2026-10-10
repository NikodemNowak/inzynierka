import { processNoteWithLlm } from "./noteProcessing";
import { extractTaskEvidence } from "./taskExtraction";
import { generate, measureFormattedPromptTokens } from "./llm";
import { recordGeneration } from "./generationMetrics";
import type { ProcessingExecutionContext } from "./processingContext";
import { sourceExecutionView, type ProcessingCheckpointStore } from "./processingContext";
import { collectSourceEvidence } from "./sourcePipeline";
import { projectSourceUnitPlan } from "./sourceUnits";
import { ensureModelReady } from "./modelReady";
import { createSummarySources } from "./summarySources";
import type { SummaryCheckTargets, SummaryDraft } from "./summaryProtocol";

jest.mock("./llm", () => ({
  generate: jest.fn(), isModelLoadedFor: () => true, getLoadedModelInfo: () => null,
  measureFormattedPromptTokens: jest.fn(async ({ systemPrompt = "", userPrompt = "" }: { systemPrompt?: string; userPrompt?: string }) => Math.ceil((systemPrompt.length + userPrompt.length) / 4)),
  getContextWindowSize: () => 8192,
}));
jest.mock("./modelReady", () => ({ ensureModelReady: jest.fn() }));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));
const model = jest.mocked(generate);
const source = "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej kiermasz dotyczy ręcznie robionych ozdób lokalnej ceramiki i obrazów do 14 września mam przygotować trzy Plansze z ofertami wystawców Olga ma do 16 września sprawdzić listę stanowisk zelva ma przygotować plakat informacyjny budżet dekoracji wynosił 680 zł Poprawka aktualny budżet to 430 zł wczoraj wysłałem już zaproszenie do stolarza spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk";
const punctuated = "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej. Kiermasz dotyczy ręcznie robionych ozdób, lokalnej ceramiki i obrazów. Do 14 września mam przygotować trzy plansze z ofertami wystawców. Olga ma do 16 września sprawdzić listę stanowisk. Zelva ma przygotować plakat informacyjny. Budżet dekoracji wynosił 680 zł. Poprawka. Aktualny budżet to 430 zł. Wczoraj wysłałem już zaproszenie do stolarza. Spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero. zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk.";
const generated = (text: string) => ({ text, ttftMs: 1, tokensPerSecond: 20, wallMs: 20, promptMs: 1, predictedMs: 19, promptTokens: 100, predictedTokens: 20 });
const install = (punctuationProposal = punctuated, category = "Praca"): void => {
  model.mockImplementation(async (prompt, _callback, options) => {
    if (!options?.jsonSchema && options?.nPredict === 512) return generated(punctuationProposal);
    const schema = JSON.stringify(options?.jsonSchema) ?? "";
    if (schema.includes('"tasks"')) return generated('{"tasks":[{"id":3,"kind":"active"},{"id":4,"kind":"active"},{"id":5,"kind":"active"}]}');
    if (Array.isArray(options?.jsonSchema?.anyOf) || schema.includes('"units"')) {
      const units = createSummarySources(source, actualPlan());
      const draft: SummaryDraft = { format: "bullets", points: [
        { text: "Kiermasz lokalnej grupy rzemieślniczej: ręcznie robione ozdoby, lokalna ceramika i obrazy; cel: estetyczna ekspozycja kolorowych wyrobów z oznaczeniami stoisk.", sourceIds: [1, 2, 10] },
        { text: "do 14 września mam przygotować trzy Plansze z ofertami wystawców", sourceIds: [3] },
        { text: "Olga ma do 16 września sprawdzić listę stanowisk", sourceIds: [4] },
        { text: "zelva ma przygotować plakat informacyjny", sourceIds: [5] },
        { text: "Dekoracje: Poprawka aktualny budżet to 430 zł", sourceIds: [6, 7] },
        { text: "wczoraj wysłałem już zaproszenie do stolarza", sourceIds: [8] },
        { text: "spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero", sourceIds: [9] },
      ] };
      const payload = JSON.parse(prompt) as { sourceCatalogData: string; draftData?: SummaryDraft; checkTargetsData?: SummaryCheckTargets };
      expect(payload.sourceCatalogData).toBe(units.map(unit => `[${unit.id}] ${unit.text}`).join("\n"));
      if (!payload.draftData) return generated(JSON.stringify(draft));
      const targets = payload.checkTargetsData!;
      return generated(JSON.stringify({ points: targets.pointIds.map(pointId => ({ pointId, status: "supported", issues: [] })),
        units: targets.sourceIds.map(sourceId => {
          const pointIds = draft.points.flatMap((point, index) => point.sourceIds.includes(sourceId) ? [index + 1] : []);
          return { sourceId, status: sourceId === 6 ? "superseded" : pointIds.length ? "covered" : "context",
            pointIds: sourceId === 6 ? [] : pointIds, supersededBy: sourceId === 6 ? [7] : [] };
        }) }));
    }
    if (schema.includes('"category"')) return generated(JSON.stringify({ purposeId: 1, category }));
    if (schema.includes('"anchors"')) return generated('{"anchors":[1],"title":"Przygotowanie kiermaszu"}');
    return generated('"Przygotowanie kiermaszu"');
  });
};
beforeEach(() => { jest.clearAllMocks(); model.mockReset(); });

test("cold note status follows ready, actual structure work, then independently grounded fields", async () => {
  install();
  jest.mocked(ensureModelReady).mockImplementationOnce(async (progress) => {
    progress({ phase: "loading", percent: 0 });
    progress({ phase: "loading", percent: 100 });
    return 5;
  });
  const updates: Array<{ phase: string; detail?: string }> = [];
  await processNoteWithLlm(source, (progress) => { updates.push(progress); });
  expect(updates.slice(0, 5)).toEqual([
    { phase: "loading", percent: 0 }, { phase: "loading", percent: 100 },
    { phase: "processing" }, { phase: "processing", detail: "structure" }, { phase: "processing" },
  ]);
  expect(updates.slice(5).map(({ phase }) => phase)).toEqual(["tags", "summary", "title"]);
  expect(model.mock.calls.filter(([, , options]) => Array.isArray(options?.jsonSchema?.anyOf))).toHaveLength(1);
  expect(model.mock.calls.filter(([, , options]) => "tasks" in ((options?.jsonSchema?.properties ?? {}) as object))).toHaveLength(1);
  expect(model.mock.calls.filter(([, , options]) => "category" in ((options?.jsonSchema?.properties ?? {}) as object))).toHaveLength(1);
  expect(model.mock.calls.filter(([prompt]) => prompt.includes("Podaj tytuł"))).toHaveLength(1);
  expect(model.mock.calls.filter(([, , options]) => !options?.jsonSchema && options?.nPredict === 512)).toHaveLength(1);
});

test("a ready model and reused source memo publish processing without inventing structure work", async () => {
  install();
  const execution: ProcessingExecutionContext = { taskEvidenceMemo: {} };
  await processNoteWithLlm(source, () => undefined, undefined, "pl", execution);
  const updates: Array<{ phase: string; detail?: string }> = [];
  model.mockClear();
  await processNoteWithLlm(source, (progress) => { updates.push(progress); }, undefined, "pl", execution);
  expect(updates[0]).toEqual({ phase: "processing" });
  expect(updates.some(({ detail }) => detail === "structure")).toBe(false);
  expect(updates.some(({ phase }) => phase === "loading")).toBe(false);
  expect(model.mock.calls.some(([, , options]) => options?.nPredict === 512)).toBe(false);
});

test("cancelling from the ready-model status prevents source generation", async () => {
  install();
  const controller = new AbortController();
  await expect(processNoteWithLlm(source, (progress) => {
    if (progress.phase === "processing") controller.abort();
  }, undefined, "pl", { signal: controller.signal })).rejects.toThrow(/aborted/iu);
  expect(model).not.toHaveBeenCalled();
});

test("task extraction replaces loading with processing and announces structure only for a fresh prepass", async () => {
  install();
  jest.mocked(ensureModelReady).mockImplementationOnce(async (progress) => {
    progress({ phase: "loading", percent: 100 });
    return 5;
  });
  const execution: ProcessingExecutionContext = { taskEvidenceMemo: {} };
  const statuses: string[] = [];
  await extractTaskEvidence(source, (status) => { statuses.push(status); }, "pl", execution);
  expect(statuses).toEqual(["Ładowanie modelu: 100%", "Opracowuję tekst…", "Porządkuję wypowiedź…", "Opracowuję tekst…", "Szukanie zadań…"]);
  statuses.length = 0;
  model.mockClear();
  await extractTaskEvidence(source, (status) => { statuses.push(status); }, "pl", execution);
  expect(statuses).toEqual(["Opracowuję tekst…", "Szukanie zadań…"]);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  ["unwrapped", punctuated],
  ["native empty thinking envelope", `<think>\n\n</think>\n\n${punctuated}`],
])("synthetic flat source with %s produces three exact duties and a current-cost/date summary with one measurable prepass", async (_label, punctuationProposal) => {
  install(punctuationProposal, "Nauka");
  const execution: ProcessingExecutionContext = { taskEvidenceMemo: {} };
  const result = await processNoteWithLlm(source, () => undefined, undefined, "pl", execution);
  expect(result.summary).toContain("do 14 września mam przygotować trzy Plansze z ofertami wystawców");
  expect(result.summary).toContain("zelva ma przygotować plakat informacyjny");
  expect(result.summary).toContain("Poprawka aktualny budżet to 430 zł");
  expect(result.summary).toContain("19 września o godzinie czternastej trzydzieści zero");
  expect(result.summary).not.toContain("680");
  expect(result.summary).toContain("wczoraj wysłałem już zaproszenie do stolarza");
  expect(result.summary.split("\n")).toEqual([
    "• Kiermasz lokalnej grupy rzemieślniczej: ręcznie robione ozdoby, lokalna ceramika i obrazy; cel: estetyczna ekspozycja kolorowych wyrobów z oznaczeniami stoisk.",
    "• do 14 września mam przygotować trzy Plansze z ofertami wystawców",
    "• Olga ma do 16 września sprawdzić listę stanowisk",
    "• zelva ma przygotować plakat informacyjny",
    "• Dekoracje: Poprawka aktualny budżet to 430 zł",
    "• wczoraj wysłałem już zaproszenie do stolarza",
    "• spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero",
  ]);
  expect(result.failedFields).toBeUndefined();
  expect(result.tags).toEqual(["Nauka"]);
  const phases = jest.mocked(recordGeneration).mock.calls.map(([phase]) => phase);
  expect(phases.slice(0, 3)).toEqual(["source_structure", "tasks", "tags"]);
  expect(phases.slice(3, -1).every(phase => phase.startsWith("summary-"))).toBe(true);
  expect(phases.at(-1)).toBe("title");
  expect(result.summaryDocument?.source).toBe(source);
  expect(execution.taskEvidenceMemo?.sourceStructure?.result?.ends).toHaveLength(10);
  expect(recordGeneration).toHaveBeenCalledWith("source_structure", source.length, expect.objectContaining({ text: punctuationProposal }));
  expect(model.mock.calls.filter(([, , options]) => !options?.jsonSchema && options?.nPredict === 512)).toHaveLength(1);
  const initial = model.mock.calls.find(([, , options]) => (JSON.stringify(options?.jsonSchema) ?? "").includes('"tasks"'));
  expect(initial?.[0]).toContain(`[3] do 14 września mam przygotować trzy Plansze`);
  expect(initial?.[0]).toContain(`ORIGINAL_PARENT_DATA_START\n${source}\nORIGINAL_PARENT_DATA_END`);
  model.mockClear();
  const proof = await extractTaskEvidence(source, () => undefined, "pl", execution);
  expect(proof.tasks).toEqual([
    "do 14 września mam przygotować trzy Plansze z ofertami wystawców",
    "Olga ma do 16 września sprawdzić listę stanowisk",
    "zelva ma przygotować plakat informacyjny",
  ]);
  expect(proof.tasks).not.toContain("wczoraj wysłałem już zaproszenie do stolarza");
  expect(model).not.toHaveBeenCalled();
  for (const entry of proof.evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
});

test.each(["signal", "checkpoint", "runtimeOptions", "plan", "abort"])("note prepass observes outer %s changes without mutating its caller context", async (change) => {
  const controller = new AbortController();
  const writes = jest.fn(async () => undefined);
  const outer: ProcessingExecutionContext = { signal: controller.signal, checkpoint: { read: async () => null, write: writes } };
  model.mockImplementationOnce(async () => {
    if (change === "signal") outer.signal = new AbortController().signal;
    if (change === "checkpoint") outer.checkpoint = { read: async () => null, write: writes };
    if (change === "runtimeOptions") outer.runtimeOptions = { modelPath: "/changed.gguf" };
    if (change === "plan") outer.sourceUnitPlan = { version: 1, source, identity: "changed", ends: [10, source.length] };
    if (change === "abort") controller.abort();
    return generated(punctuated);
  });
  await expect(processNoteWithLlm(source, () => undefined, undefined, "pl", outer)).rejects.toThrow(/runtime changed|aborted/iu);
  expect(model).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
});

test("manual unsupported flat source holds the whole parent for review rather than publishing giant active evidence", async () => {
  model.mockResolvedValue(generated(source));
  const proof = await extractTaskEvidence(source, () => undefined, "pl", { taskEvidenceMemo: {} });
  expect(proof.tasks).toEqual([]);
  expect(proof.evidence).toEqual([]);
  expect(proof.warnings).toHaveLength(1);
  expect(proof.reviewSpans).toEqual([expect.objectContaining({ start: 0, end: source.length, quote: source })]);
  expect(model).toHaveBeenCalledTimes(2);
});

const durableStore = (): ProcessingCheckpointStore => {
  const values = new Map<string, unknown>();
  return { read: jest.fn(async (key) => values.get(key) ?? null), write: jest.fn(async (key, value) => { values.set(key, value); }) };
};
const actualPlan = () => {
  const plan = projectSourceUnitPlan(source, punctuated);
  if (!plan) throw new Error("Expected literal source plan");
  return plan;
};
const taskResult = '{"tasks":[{"id":3,"kind":"active"},{"id":4,"kind":"active"},{"id":5,"kind":"active"}]}';

test("planned category failure does not replace literal task proof or repeat category generation", async () => {
  install(punctuated, "Nauka");
  const ordinary = model.getMockImplementation()!;
  model.mockImplementation(async (prompt, callback, options) =>
    (JSON.stringify(options?.jsonSchema) ?? "").includes('"category"')
      ? generated('{"purposeId":1,"category":"invented"}') : ordinary(prompt, callback, options));
  const execution: ProcessingExecutionContext = { taskEvidenceMemo: {} };
  const result = await processNoteWithLlm(source, () => undefined, undefined, "pl", execution);
  expect(result.failedFields).toEqual(["tags"]);
  expect(result.summary.split("\n")).toHaveLength(7);
  model.mockClear();
  const proof = await extractTaskEvidence(source, () => undefined, "pl", execution);
  expect(proof.tasks).toEqual([
    "do 14 września mam przygotować trzy Plansze z ofertami wystawców",
    "Olga ma do 16 września sprawdzić listę stanowisk",
    "zelva ma przygotować plakat informacyjny",
  ]);
  expect(model).not.toHaveBeenCalled();
  expect(jest.mocked(recordGeneration).mock.calls.filter(([phase]) => phase === "tags")).toHaveLength(1);
});

test("planned early category cancellation returns no note or task checkpoint", async () => {
  install(punctuated, "Nauka");
  const ordinary = model.getMockImplementation()!;
  const controller = new AbortController();
  const checkpoint = durableStore();
  model.mockImplementation(async (prompt, callback, options) => {
    if ((JSON.stringify(options?.jsonSchema) ?? "").includes('"category"')) controller.abort();
    return ordinary(prompt, callback, options);
  });
  await expect(processNoteWithLlm(source, () => undefined, undefined, "pl", {
    checkpoint, signal: controller.signal,
  })).rejects.toThrow(/aborted/iu);
  expect(jest.mocked(checkpoint.write).mock.calls.map(([key]) => key)).toEqual([`source_structure:0:${source.length}`]);
  expect(jest.mocked(recordGeneration).mock.calls.map(([phase]) => phase)).toEqual(["source_structure", "tasks"]);
  expect(model.mock.calls).toHaveLength(3);
});

test("planned category is read-only before a failed durable task write and no fields are published", async () => {
  install(punctuated, "Nauka");
  const checkpoint = durableStore();
  const save = jest.mocked(checkpoint.write).getMockImplementation()!;
  jest.mocked(checkpoint.write).mockImplementation(async (key, value) => {
    if (key.startsWith("tasks:")) throw new Error("durable task write failed");
    return save(key, value);
  });
  await expect(processNoteWithLlm(source, () => undefined, undefined, "pl", { checkpoint }))
    .rejects.toThrow("durable task write failed");
  expect(jest.mocked(recordGeneration).mock.calls.map(([phase]) => phase)).toEqual(["source_structure", "tasks", "tags"]);
});

test("planned durable task resume generates categories exactly once before summary and title", async () => {
  install(punctuated, "Nauka");
  const checkpoint = durableStore();
  const first = await processNoteWithLlm(source, () => undefined, undefined, "pl", { checkpoint });
  const initialJournal = await checkpoint.read("summary:v1:final");
  model.mockClear();
  jest.mocked(recordGeneration).mockClear();
  const resumed = await processNoteWithLlm(source, () => undefined, undefined, "pl", { checkpoint });
  expect(await checkpoint.read("summary:v1:final")).toEqual(initialJournal);
  expect(resumed).toEqual(first);
  expect(model.mock.calls.filter(([, , options]) => "units" in ((options?.jsonSchema?.properties ?? {}) as object))).toHaveLength(0);
  expect(model).toHaveBeenCalledTimes(2);
  expect(jest.mocked(recordGeneration).mock.calls.map(([phase]) => phase)).toEqual(["tags", "title"]);
});

test("planned task checkpoints replay exact IDs and quotes with zero calls and reject mismatched boundary identity", async () => {
  const checkpoint = durableStore();
  const plan = actualPlan();
  model.mockResolvedValue(generated(taskResult));
  const first = await collectSourceEvidence(source, "tasks", "pl", { checkpoint, sourceUnitPlan: plan });
  model.mockClear();
  await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, sourceUnitPlan: plan })).resolves.toEqual(first);
  expect(model).not.toHaveBeenCalled();
  const saved = await checkpoint.read(`tasks:0:${source.length}`);
  expect(saved).toMatchObject({ sourceUnitPlanIdentity: plan.identity });
  jest.mocked(checkpoint.read).mockResolvedValue({ ...(saved as object), sourceUnitPlanIdentity: "different boundaries" });
  await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, sourceUnitPlan: plan })).resolves.toEqual(first);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each(["language", "options"])("planned task checkpoint is bound to its %s instead of trusting old classification", async (change) => {
  const checkpoint = durableStore();
  const plan = actualPlan();
  model.mockResolvedValue(generated(taskResult));
  await collectSourceEvidence(source, "tasks", "pl", { checkpoint, sourceUnitPlan: plan });
  model.mockClear();
  await collectSourceEvidence(source, "tasks", change === "language" ? "en" : "pl", {
    checkpoint, sourceUnitPlan: plan,
    ...(change === "options" ? { runtimeOptions: { modelPath: "/other.gguf" } } : {}),
  });
  expect(model).toHaveBeenCalledTimes(1);
});

test.each(["tasks", "facts"] as const)("%s collector rejects supplied-plan in-place mutation before a checkpoint", async (mode) => {
  const plan = actualPlan();
  const supplied = { ...plan, ends: [...plan.ends] };
  const checkpoint = durableStore();
  model.mockImplementationOnce(async () => {
    supplied.ends[0] = supplied.ends[1];
    return generated(taskResult);
  });
  await expect(collectSourceEvidence(source, mode, "pl", { checkpoint, sourceUnitPlan: supplied })).rejects.toThrow(/runtime changed/iu);
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("private immutable view detects a caller plan replacement inside a awaited checkpoint read", async () => {
  const outer: ProcessingExecutionContext = { sourceUnitPlan: actualPlan(), checkpoint: durableStore() };
  const original = outer.sourceUnitPlan;
  const view = sourceExecutionView(source, outer);
  expect(Object.isFrozen(view.sourceUnitPlan)).toBe(true);
  jest.mocked(outer.checkpoint!.read).mockImplementationOnce(async () => { outer.sourceUnitPlan = { ...original! }; return null; });
  await expect(collectSourceEvidence(source, "tasks", "pl", view)).rejects.toThrow(/runtime changed/iu);
  expect(model).not.toHaveBeenCalled();
  expect(outer.checkpoint?.write).not.toHaveBeenCalled();
});

test("an incomplete planned task response splits only at retained complete source units", async () => {
  const checkpoint = durableStore();
  model.mockResolvedValueOnce({ ...generated(taskResult), completion: {
    status: "stopped_limit", truncated: true, stoppedLimit: true, contextFull: false,
    interrupted: false, stoppedEos: false, stoppingWord: "",
  } });
  model.mockImplementation(async prompt => {
    const data = prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];
    const tasks = [...data.matchAll(/^\[(\d+)\] (.+)$/gmu)]
      .filter(match => /mam przygotować|ma do 16|zelva ma/iu.test(match[2]))
      .map(match => ({ id: Number(match[1]), kind: "active" }));
    return generated(JSON.stringify({ tasks }));
  });
  const result = await collectSourceEvidence(source, "tasks", "pl", { checkpoint, sourceUnitPlan: actualPlan() });
  expect(result.filter(entry => entry.kind === "active").map(entry => entry.quote)).toEqual([
    "do 14 września mam przygotować trzy Plansze z ofertami wystawców",
    "Olga ma do 16 września sprawdzić listę stanowisk",
    "zelva ma przygotować plakat informacyjny",
  ]);
  expect(model).toHaveBeenCalledTimes(3);
  for (const entry of result) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(jest.mocked(checkpoint.write).mock.calls.some(([key]) => key.startsWith("tasks:split:"))).toBe(true);
});

test("a runtime change in an awaited plan evidence write rejects without claiming the one write was rolled back", async () => {
  const checkpoint = durableStore();
  const execution: ProcessingExecutionContext = { checkpoint, sourceUnitPlan: actualPlan(), signal: new AbortController().signal };
  jest.mocked(checkpoint.write).mockImplementationOnce(async () => { execution.signal = new AbortController().signal; });
  model.mockResolvedValueOnce(generated(taskResult));
  await expect(collectSourceEvidence(source, "tasks", "pl", execution)).rejects.toThrow(/runtime changed/iu);
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
});

test.each(["signal", "checkpoint", "runtimeOptions"])("note rejects outer %s replacement during post-prepass full-parent fits before installing the plan", async (change) => {
  install();
  const checkpoint = durableStore();
  const outer: ProcessingExecutionContext = { signal: new AbortController().signal, checkpoint };
  let mutated = false;
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({systemPrompt = "", userPrompt = ""}) => {
    if (!mutated && userPrompt.includes("ORIGINAL_PARENT_DATA_START")) {
      mutated = true;
      if (change === "signal") outer.signal = new AbortController().signal;
      if (change === "checkpoint") outer.checkpoint = durableStore();
      if (change === "runtimeOptions") outer.runtimeOptions = {modelPath: "/other.gguf"};
    }
    return Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  });
  await expect(processNoteWithLlm(source, () => undefined, undefined, "pl", outer)).rejects.toThrow(/runtime changed/iu);
  expect(model).toHaveBeenCalledTimes(1);
  expect(jest.mocked(checkpoint.write).mock.calls.map(([key]) => key)).toEqual([`source_structure:0:${source.length}`]);
});

test("keeps four literal duties and the exact current Polish amount within meaningful summary compression", async () => {
  const parts = ["Paweł ma opisać próbki do piątku", "Zofia ma sprawdzić tabelę do poniedziałku", "Roman ma zamówić materiały do wtorku", "Daria ma przygotować wykres do środy", "budżet transportu wynosił 240 zł", "poprawka aktualny budżet transportu wynosi 180 zł", "sala ma dwa wejścia a odbiór materiałów odbędzie się po zakończeniu przygotowań"];
  const content = parts.join(" ");
  install();
  model.mockImplementation(async (prompt,_callback,options) => {
    const schema = JSON.stringify(options?.jsonSchema) ?? "";
    if (!options?.jsonSchema && options?.nPredict === 512) return generated(parts.join(". ") + ".");
    if (schema.includes('"tasks"')) return generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"active"},{"id":3,"kind":"active"},{"id":4,"kind":"active"}]}');
    if (Array.isArray(options?.jsonSchema?.anyOf) || schema.includes('"units"')) {
      const draft: SummaryDraft = { format: "bullets", points: [
        { text: "Paweł: opisać próbki do piątku.", sourceIds: [1] },
        { text: "Zofia: sprawdzić tabelę do poniedziałku.", sourceIds: [2] },
        { text: "Roman: zamówić materiały do wtorku.", sourceIds: [3] },
        { text: "Daria: przygotować wykres do środy.", sourceIds: [4] },
        { text: "Poprawiony budżet transportu: 180 zł.", sourceIds: [6] },
        { text: "Sala: dwa wejścia; odbiór materiałów po przygotowaniach.", sourceIds: [7] },
      ] };
      const payload = JSON.parse(prompt) as { draftData?: SummaryDraft; checkTargetsData?: SummaryCheckTargets };
      if (!payload.draftData) return generated(JSON.stringify(draft));
      const targets = payload.checkTargetsData!;
      return generated(JSON.stringify({ points: targets.pointIds.map(pointId => ({ pointId, status: "supported", issues: [] })),
        units: targets.sourceIds.map(sourceId => ({ sourceId, status: sourceId === 5 ? "superseded" : "covered",
          pointIds: draft.points.flatMap((point, index) => point.sourceIds.includes(sourceId) ? [index + 1] : []),
          supersededBy: sourceId === 5 ? [6] : [] })) }));
    }
    if (schema.includes('"category"')) return generated('{"purposeId":1,"category":"Praca"}');
    return generated('Próbki');
  });
  const result = await processNoteWithLlm(content,() => undefined,undefined,"pl");
  expect(result.summary).toBe("• Paweł: opisać próbki do piątku.\n• Zofia: sprawdzić tabelę do poniedziałku.\n• Roman: zamówić materiały do wtorku.\n• Daria: przygotować wykres do środy.\n• Poprawiony budżet transportu: 180 zł.\n• Sala: dwa wejścia; odbiór materiałów po przygotowaniach.");
  expect(result.summaryDocument?.source).toBe(content);
  expect(result.summaryDocument?.points.map(point => point.sources.map(range => content.slice(range.start, range.end)))).toEqual(
    [1, 2, 3, 4, 6, 7].map(id => [parts[id - 1]]));
  expect(result.summary).not.toContain("240 zł");
  expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  expect(result.failedFields ?? []).not.toContain("summary");
  expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/podsumowan/iu)]));
});
