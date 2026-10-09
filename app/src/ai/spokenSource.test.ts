import { prepareSpokenSource } from "./spokenSource";
import { generate, getContextWindowSize, getLoadedModelInfo, measureFormattedPromptTokens, type LoadedModelInfo } from "./llm";
import { MODEL_CONFIG } from "./modelConfig";
import { clearSourcePlanCache, writeSourcePlanCache } from "./sourcePlanCache";
import { recordGeneration } from "./generationMetrics";
import { projectSourceUnitPlan, sourceUnitsFromPlan, validateSourceUnitPlan } from "./sourceUnits";
import { selectSourceSummaryResult } from "./summarySelection";
import { PIPELINE_VERSION, type FinalTaskEvidence, type ProcessingCheckpointStore, type ProcessingExecutionContext } from "./processingContext";

jest.mock("./llm", () => ({
  generate: jest.fn(), getLoadedModelInfo: jest.fn(() => null), getContextWindowSize: jest.fn(() => 4096),
  measureFormattedPromptTokens: jest.fn(async () => 200),
}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));
const model = jest.mocked(generate);
const source = "Jutro sprawdzę zestaw wyników i przygotuję kompletną tabelę dla klienta razem z aktualnymi pomiarami oraz dodatkowymi opisami koszt wynosi 180 zł spotkanie jest 12 listopada o godzinie dziesiątej rano prezentacja ma pokazać rzeczywiste wyniki";
const proposal = "Jutro sprawdzę zestaw wyników i przygotuję kompletną tabelę dla klienta razem z aktualnymi pomiarami oraz dodatkowymi opisami. Koszt wynosi 180 zł. Spotkanie jest 12 listopada o godzinie dziesiątej rano. Prezentacja ma pokazać rzeczywiste wyniki.";
const generated = (text: string) => ({ text, ttftMs: 1, tokensPerSecond: 20, wallMs: 20, promptMs: 1, predictedMs: 19, promptTokens: 200, predictedTokens: 80 });
const store = (): ProcessingCheckpointStore => {
  const values = new Map<string, unknown>();
  return { read: jest.fn(async (key) => values.get(key) ?? null), write: jest.fn(async (key, value) => { values.set(key, value); }) };
};
beforeEach(() => { jest.clearAllMocks(); model.mockReset(); jest.mocked(getContextWindowSize).mockReturnValue(4096);
  jest.mocked(measureFormattedPromptTokens).mockReset().mockResolvedValue(200);
  jest.mocked(getLoadedModelInfo).mockReturnValue(null); clearSourcePlanCache(); });

describe("bounded exact-source short punctuation fallback", () => {
  const original = "przygotowujemy wystawę Agata ma przygotować opis do 20 listopada Marek ma sprawdzić oświetlenie do 21 listopada Iga ma zamówić materiały do 22 listopada budżet materiałów wynosił 240 zł poprawka aktualny budżet materiałów wynosi 180 zł sala ma dwa wejścia a odbiór wystawy odbędzie się po zakończeniu przygotowań";
  // Actual candidate02 Qwen42 output lost the source conjunction "a".
  const rejected = "Przygotowujemy wystawę. Agata ma przygotować opis do 20 listopada. Marek ma sprawdzić oświetlenie do 21 listopada. Iga ma zamówić materiały do 22 listopada. Budżet materiałów wynosił 240 zł. Poprawka. Aktualny budżet materiałów wynosi 180 zł. Sala ma dwa wejścia. Odbiór wystawy odbędzie się po zakończeniu przygotowań.";
  // Actual earlier Qwen7 legacy request retained every original source word.
  const fallback = "<think>\n\n</think>\n\nprzygotowujemy wystawę. Agata ma przygotować opis do 20 listopada. Marek ma sprawdzić oświetlenie do 21 listopada. Iga ma zamówić materiały do 22 listopada. budżet materiałów wynosił 240 zł. poprawka. aktualny budżet materiałów wynosi 180 zł. sala ma dwa wejścia. a odbiór wystawy odbędzie się po zakończeniu przygotowań.";

  test("recovers the actual 47-word control from a complete preferred proposal that omitted one word", async () => {
    const checkpoint = store();
    model.mockResolvedValueOnce(generated(rejected)).mockResolvedValueOnce(generated(fallback));
    const plan = await prepareSpokenSource(original, "pl", { checkpoint });
    if (!plan) throw new Error("Expected fallback to retain complete original source clauses");
    const units = sourceUnitsFromPlan(original, plan);
    expect(units.map(unit => unit.text)).toEqual([
      "przygotowujemy wystawę", "Agata ma przygotować opis do 20 listopada",
      "Marek ma sprawdzić oświetlenie do 21 listopada", "Iga ma zamówić materiały do 22 listopada",
      "budżet materiałów wynosił 240 zł", "poprawka aktualny budżet materiałów wynosi 180 zł",
      "sala ma dwa wejścia", "a odbiór wystawy odbędzie się po zakończeniu przygotowań",
    ]);
    for (const unit of units) expect(original.slice(unit.start, unit.end)).toBe(unit.text);
    expect(recordGeneration).toHaveBeenCalledTimes(2);
    expect(checkpoint.write).toHaveBeenCalledTimes(1);
    model.mockClear();
    await expect(prepareSpokenSource(original, "pl", { checkpoint })).resolves.toEqual(plan);
    expect(model).not.toHaveBeenCalled();
  });

  test("keeps the source for review after two invalid proposals without a third generation", async () => {
    const checkpoint = store();
    model.mockResolvedValueOnce(generated(rejected)).mockResolvedValueOnce(generated(rejected))
      .mockResolvedValueOnce(generated(fallback));
    await expect(prepareSpokenSource(original, "pl", { checkpoint })).resolves.toBeNull();
    expect(model).toHaveBeenCalledTimes(2);
    expect(checkpoint.write).not.toHaveBeenCalled();
  });

  test("measures the fallback request independently and rejects its oversized context before generation", async () => {
    const checkpoint = store();
    jest.mocked(measureFormattedPromptTokens).mockResolvedValueOnce(200).mockResolvedValueOnce(4000);
    model.mockResolvedValueOnce(generated(rejected));
    await expect(prepareSpokenSource(original, "pl", { checkpoint })).resolves.toBeNull();
    expect(measureFormattedPromptTokens).toHaveBeenCalledTimes(2);
    expect(model).toHaveBeenCalledTimes(1);
    expect(checkpoint.write).not.toHaveBeenCalled();
  });

  test.each(["abort", "runtime"] as const)("does not start fallback after the preferred generation crosses an %s boundary", async (change) => {
    const owner = new AbortController();
    const checkpoint = store();
    const execution: ProcessingExecutionContext = { checkpoint, signal: owner.signal };
    model.mockImplementationOnce(async () => {
      if (change === "abort") owner.abort();
      else execution.runtimeOptions = { modelPath: "/changed-model.gguf" };
      return generated(rejected);
    });
    await expect(prepareSpokenSource(original, "pl", execution)).rejects.toThrow(/aborted|runtime changed/iu);
    expect(model).toHaveBeenCalledTimes(1);
    expect(checkpoint.write).not.toHaveBeenCalled();
  });
});

test.each(["checkpoint", "cache", "memo"] as const)("replaces an old %s punctuation plan that bundled a duty with an obsolete amount", async (reuse) => {
  const parts = [
    "Planujemy jesienny kiermasz grupy",
    "do piątku mam wysłać listę stoisk koordynatorom",
    "Olga ma do soboty sprawdzić plan sali",
    "Zelva ma do niedzieli przygotować wzór plakatu",
    "budżet wynosił 680 zł",
    "Poprawka aktualny budżet to 430 zł",
    "nie kupujemy dodatkowego reflektora",
    "przygotowałem dekoracje sali wczoraj"
  ];
  const content = parts.join(" ");
  // Synthetic legacy plan keeps the first duty with context and the third with an obsolete amount.
  const ends = [81,119,188,223,259,296];
  const legacyPlan = validateSourceUnitPlan(content, { version: 1, source: content, ends,
    identity: JSON.stringify([1, content, ends]) });
  const context = loaded();
  jest.mocked(getLoadedModelInfo).mockReturnValue(context);
  const legacyKey = JSON.stringify([PIPELINE_VERSION, content, "pl", null, context.modelPath, context.model,
    context.execution, context.speculative, context.gpu, context.devices, 4096]);
  const execution: ProcessingExecutionContext = {};
  if (reuse === "checkpoint") {
    const checkpoint = store();
    jest.mocked(checkpoint.read).mockResolvedValue({ version: PIPELINE_VERSION, source: content,
      key: legacyKey, plan: legacyPlan });
    execution.checkpoint = checkpoint;
  } else if (reuse === "cache") {
    writeSourcePlanCache({ source: content, language: "pl", pipeline: PIPELINE_VERSION,
      protocol: "punctuation-v5-adaptive-owned-prefix-windows-empty-think",
      modelIdentity: JSON.stringify([context.modelPath, context.model, context.execution, context.speculative,
        context.gpu, context.devices, context.reasonNoGPU, context.systemInfo, 4096,
        { modelPath: context.modelPath, model: context.model, execution: context.execution, speculative: context.speculative }]) }, legacyPlan);
  } else {
    execution.taskEvidenceMemo = { sourceStructure: { key: legacyKey, context, signal: undefined,
      checkpoint: undefined, result: legacyPlan } };
  }
  // Complete synthetic proposal splits every duty from the obsolete amount.
  model.mockResolvedValueOnce(generated("Planujemy jesienny kiermasz grupy. Do piątku mam wysłać listę stoisk koordynatorom. Olga ma do soboty sprawdzić plan sali. Zelva ma do niedzieli przygotować wzór plakatu. Budżet wynosił 680 zł. Poprawka aktualny budżet to 430 zł. Nie kupujemy dodatkowego reflektora. Przygotowałem dekoracje sali wczoraj."));
  const plan = await prepareSpokenSource(content, "pl", execution);
  if (!plan) throw new Error("Expected validated complete source plan");
  const units = sourceUnitsFromPlan(content, plan);
  expect(units.map(unit => unit.text)).toEqual(parts);
  for (const unit of units) expect(content.slice(unit.start, unit.end)).toBe(unit.text);
  const tasks = parts.slice(1, 4);
  const proof: FinalTaskEvidence = { tasks, evidence: tasks.map((quote, index) => ({
    id: `duty-${index}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  })), superseded: [], warnings: [] };
  expect(selectSourceSummaryResult('{"sentences":[2,6]}', content, content, proof, { sourceUnitPlan: plan }))
    .toEqual({ summary: [parts[1], parts[2], parts[3], parts[5], parts[6]].join("\n"), incomplete: false });
});

test("announces structure only immediately before a real generation and sends the entire original source", async () => {
  const order: string[] = [];
  const announce = jest.fn(() => { order.push("structure"); });
  model.mockImplementationOnce(async () => { order.push("generate"); return generated(proposal); });
  const result = await prepareSpokenSource(source, "pl", undefined, announce);
  expect(result?.ends).toHaveLength(4);
  expect(order).toEqual(["structure", "generate"]);
  expect(model).toHaveBeenCalledWith(
    expect.stringContaining(`\n\n${source}`),
    expect.any(Function),
    { system: "Jesteś pomocnym asystentem. /no_think", nPredict: 512, temperature: 0, signal: undefined },
  );
});

test.each(["provided", "memo", "checkpoint", "cache"] as const)("does not announce a model operation when reusing a %s structure", async (reuse) => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  model.mockResolvedValue(generated(proposal));
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint, taskEvidenceMemo: {} };
  const plan = await prepareSpokenSource(source, "pl", execution);
  expect(plan).not.toBeNull();
  const next: ProcessingExecutionContext = reuse === "provided" ? { sourceUnitPlan: plan! }
    : reuse === "memo" ? execution : reuse === "checkpoint" ? { checkpoint } : {};
  if (reuse !== "cache") clearSourcePlanCache();
  const announce = jest.fn();
  model.mockClear();
  expect(await prepareSpokenSource(source, "pl", next, announce)).toEqual(plan);
  expect(announce).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
});

test.each(["abort", "runtime"] as const)("a presentation callback cannot cross an %s boundary into generation", async (change) => {
  const controller = new AbortController();
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { signal: controller.signal, checkpoint };
  const announce = jest.fn(() => {
    if (change === "abort") controller.abort();
    else execution.runtimeOptions = { modelPath: "/replaced.gguf" };
  });
  await expect(prepareSpokenSource(source, "pl", execution, announce)).rejects.toThrow(/aborted|runtime changed/iu);
  expect(announce).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
  expect(checkpoint.write).not.toHaveBeenCalled();
});

const loaded = (): LoadedModelInfo => ({ modelPath: "/pinned.gguf", model: { ...MODEL_CONFIG, nCtx: 4096 },
  execution: "foreground", speculative: false, gpu: true, devices: ["MTL0"],
  reasonNoGPU: "", systemInfo: "stable native backend", metadata: {} });

test("reuses only a validated structure across separate jobs and a same-model release and reload", async () => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  model.mockResolvedValue(generated(proposal));
  const firstStore = store();
  const first = await prepareSpokenSource(source, "pl", { checkpoint: firstStore,
    signal: new AbortController().signal, runtimeOptions: { execution: "foreground" } });
  expect(first?.ends).toHaveLength(4);
  // A separate execution and freshly loaded native resource share neither
  // checkpoint, signal, memo nor object identity with the first job.
  jest.mocked(getLoadedModelInfo).mockReturnValue(null);
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  const secondStore = store();
  const second = await prepareSpokenSource(source, "pl", { checkpoint: secondStore,
    signal: new AbortController().signal });
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  expect(Object.isFrozen(second?.ends)).toBe(true);
  expect(model).toHaveBeenCalledTimes(1);
  expect(firstStore.write).toHaveBeenCalledTimes(1);
  expect(secondStore.write).toHaveBeenCalledTimes(1);
});

test.each(["language", "path", "revision", "sha", "window", "gpu", "devices", "layers", "speculative", "background"])("does not reuse structure after a different %s resource or setting", async (change) => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  model.mockResolvedValue(generated(proposal));
  await prepareSpokenSource(source, "pl", { signal: new AbortController().signal });
  const next = loaded();
  if (change === "path") next.modelPath = "/different.gguf";
  if (change === "revision") next.model.revision = "different";
  if (change === "sha") next.model.sha256 = "a".repeat(64);
  if (change === "window") { next.model.nCtx = 8192; jest.mocked(getContextWindowSize).mockReturnValue(8192); }
  if (change === "gpu") next.gpu = false;
  if (change === "devices") next.devices = ["CPU"];
  if (change === "layers") next.model.nGpuLayers += 1;
  if (change === "speculative") next.speculative = true;
  if (change === "background") next.execution = "background-cpu";
  jest.mocked(getLoadedModelInfo).mockReturnValue(next);
  await expect(prepareSpokenSource(source, change === "language" ? "en" : "pl", {
    signal: new AbortController().signal,
  })).resolves.not.toBeNull();
  expect(model).toHaveBeenCalledTimes(2);
});

test("a later owner abort removes its valid plan instead of seeding the next job", async () => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  const owner = new AbortController();
  model.mockResolvedValue(generated(proposal));
  await prepareSpokenSource(source, "pl", { signal: owner.signal });
  owner.abort();
  await expect(prepareSpokenSource(source, "pl", { signal: new AbortController().signal })).resolves.not.toBeNull();
  expect(model).toHaveBeenCalledTimes(2);
});

test("invalid or incomplete generations and a failed durable admission cannot seed cross-job reuse", async () => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  const failedStore = store();
  jest.mocked(failedStore.write).mockRejectedValueOnce(new Error("durable admission failed"));
  model.mockResolvedValueOnce(generated(source))
    .mockResolvedValueOnce(generated(source))
    .mockResolvedValueOnce({ ...generated(proposal), completion: { status: "stopped_limit", truncated: true,
      stoppedLimit: true, contextFull: false, interrupted: false, stoppedEos: false, stoppingWord: "" } })
    .mockResolvedValue(generated(proposal));
  await expect(prepareSpokenSource(source, "pl", { signal: new AbortController().signal })).resolves.toBeNull();
  await expect(prepareSpokenSource(source, "pl", { signal: new AbortController().signal })).resolves.toBeNull();
  await expect(prepareSpokenSource(source, "pl", { checkpoint: failedStore,
    signal: new AbortController().signal })).rejects.toThrow("durable admission failed");
  await expect(prepareSpokenSource(source, "pl", { signal: new AbortController().signal })).resolves.not.toBeNull();
  expect(model).toHaveBeenCalledTimes(5);
});

test.each(["signal", "checkpoint", "runtimeOptions"])("cached plan admission still rejects live %s replacement during its durable write", async (change) => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  model.mockResolvedValue(generated(proposal));
  await prepareSpokenSource(source, "pl");
  const checkpoint = store();
  const outer: ProcessingExecutionContext = { checkpoint, signal: new AbortController().signal };
  jest.mocked(checkpoint.write).mockImplementationOnce(async () => {
    if (change === "signal") outer.signal = new AbortController().signal;
    if (change === "checkpoint") outer.checkpoint = store();
    if (change === "runtimeOptions") outer.runtimeOptions = { modelPath: "/changed.gguf" };
  });
  await expect(prepareSpokenSource(source, "pl", outer)).rejects.toThrow(/runtime changed/iu);
  expect(model).toHaveBeenCalledTimes(1);
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
});

test.each(["memo", "subscription"])("a %s publication mutation cannot seed reuse for a later job", async (boundary) => {
  jest.mocked(getLoadedModelInfo).mockReturnValue(loaded());
  model.mockResolvedValue(generated(proposal));
  const controller = new AbortController();
  const outer: ProcessingExecutionContext = { signal: controller.signal, taskEvidenceMemo: {} };
  if (boundary === "memo") Object.defineProperty(outer.taskEvidenceMemo, "sourceStructure", {
    set: () => { outer.signal = new AbortController().signal; },
  });
  if (boundary === "subscription") jest.spyOn(controller.signal, "addEventListener").mockImplementationOnce(() => {
    outer.signal = new AbortController().signal;
  });
  await expect(prepareSpokenSource(source, "pl", outer)).rejects.toThrow(/runtime changed/iu);
  await expect(prepareSpokenSource(source, "pl", { signal: new AbortController().signal })).resolves.not.toBeNull();
  expect(model).toHaveBeenCalledTimes(2);
});

test("makes one short raw request, records its complete cost, and replays a source-bound durable plan with zero new calls", async () => {
  const checkpoint = store();
  model.mockResolvedValueOnce(generated(proposal));
  const plan = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(plan).not.toBeNull();
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0][0]).toContain(`\n\n${source}`);
  expect(model.mock.calls[0][2]).toMatchObject({ nPredict: 512, temperature: 0 });
  expect(model.mock.calls[0][2]?.jsonSchema).toBeUndefined();
  expect(recordGeneration).toHaveBeenCalledWith("source_structure", source.length, expect.objectContaining({ text: proposal }));
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
  model.mockClear();
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toEqual(plan);
  expect(model).not.toHaveBeenCalled();
});

test.each(["source", "identity"])("rejects %s-mismatched checkpoint and performs one new proposal", async (mutation) => {
  const checkpoint = store();
  model.mockResolvedValue(generated(proposal));
  const plan = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(plan).not.toBeNull();
  jest.mocked(checkpoint.read).mockResolvedValue({ version: "source-evidence-v19", source,
    plan: { ...plan, ...(mutation === "source" ? { source: `${source} changed` } : { identity: "wrong" }) } });
  model.mockClear();
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toEqual(plan);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each(["signal", "checkpoint", "plan"])("rejects live %s replacement during generation before publishing a plan", async (mutation) => {
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint, signal: new AbortController().signal };
  model.mockImplementationOnce(async () => {
    if (mutation === "signal") execution.signal = new AbortController().signal;
    if (mutation === "checkpoint") execution.checkpoint = store();
    if (mutation === "plan") execution.sourceUnitPlan = { version: 1, source, identity: "changed", ends: [5, source.length] };
    return generated(proposal);
  });
  await expect(prepareSpokenSource(source, "pl", execution)).rejects.toThrow(/runtime changed/iu);
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("rejects mutation during awaited durable write without claiming rollback", async () => {
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint, signal: new AbortController().signal };
  jest.mocked(checkpoint.write).mockImplementationOnce(async () => { execution.signal = new AbortController().signal; });
  model.mockResolvedValueOnce(generated(proposal));
  await expect(prepareSpokenSource(source, "pl", execution)).rejects.toThrow(/runtime changed/iu);
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
});

test("does not call a model for ordinary punctuated or context-too-large input", async () => {
  await expect(prepareSpokenSource(`${source}.`, "pl")).resolves.toBeNull();
  jest.mocked(getContextWindowSize).mockReturnValue(600);
  await expect(prepareSpokenSource(source, "pl")).resolves.toBeNull();
  expect(model).not.toHaveBeenCalled();
});

test("invalid, unchanged or incomplete output never publishes a fabricated plan", async () => {
  const checkpoint = store();
  for (const text of [source, proposal.replace("180", "190")]) {
    model.mockResolvedValueOnce(generated(text)).mockResolvedValueOnce(generated(text));
    await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toBeNull();
  }
  model.mockResolvedValueOnce({ ...generated(proposal), completion: { status: "stopped_limit", truncated: true, stoppedLimit: true, contextFull: false, interrupted: false, stoppedEos: false, stoppingWord: "" } });
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toBeNull();
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("accepts the native empty leading thinking envelope while recording the complete raw response unchanged", async () => {
  const checkpoint = store();
  const raw = `<think>\n\n</think>\n\n${proposal}`;
  model.mockResolvedValueOnce({ ...generated(raw), predictedTokens: 201 });
  const plan = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(plan).toEqual(projectSourceUnitPlan(source, proposal));
  expect(plan?.ends).toHaveLength(4);
  expect(recordGeneration).toHaveBeenCalledWith("source_structure", source.length,
    expect.objectContaining({ text: raw, predictedTokens: 201 }));
  expect(model).toHaveBeenCalledTimes(1);
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
  model.mockClear();
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toEqual(plan);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  `<think>Keep this reasoning</think>\n${proposal}`,
  `<think>\n${proposal}`,
  `Here is the result: <think>\n</think>\n${proposal}`,
  `${proposal.split(". ")[0]}. <think>\n</think>\n${proposal.split(". ").slice(1).join(". ")}`,
  `<think>\n</think>\n<think>\n</think>\n${proposal}`,
  `<THINK>\n</THINK>\n${proposal}`,
  `<think>\n</think>\n${proposal.replace("180", "190")}`,
])("rejects unsupported envelope or word changes without publishing source evidence", async (text) => {
  const checkpoint = store();
  model.mockResolvedValue(generated(text));
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toBeNull();
  expect(checkpoint.write).not.toHaveBeenCalled();
  expect(recordGeneration).toHaveBeenCalledWith("source_structure", source.length,
    expect.objectContaining({ text }));
});

test("an incomplete native response cannot be accepted through its empty thinking envelope", async () => {
  const checkpoint = store();
  const raw = `<think>\n\n</think>\n\n${proposal}`;
  model.mockResolvedValueOnce({ ...generated(raw), completion: { status: "stopped_limit", truncated: true,
    stoppedLimit: true, contextFull: false, interrupted: false, stoppedEos: false, stoppingWord: "" } });
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).resolves.toBeNull();
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("an interrupted native response rejects before accepting its empty thinking envelope", async () => {
  const checkpoint = store();
  model.mockResolvedValueOnce({ ...generated(`<think>\n\n</think>\n\n${proposal}`), completion: {
    status: "interrupted", truncated: false, stoppedLimit: false, contextFull: false,
    interrupted: true, stoppedEos: false, stoppingWord: "" } });
  await expect(prepareSpokenSource(source, "pl", { checkpoint })).rejects.toThrow(/interrupted/u);
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test.each(["Gdy klient potwierdzi zgodę", "W razie akceptacji kosztorysu", "Czy klient potwierdzi zgodę", "According to an earlier example"])("does not spend a prepass on unsupported governing scope: %s", async (head) => {
  const content = `${head} ${source}`;
  const execution: ProcessingExecutionContext = { checkpoint: store(), taskEvidenceMemo: {} };
  await expect(prepareSpokenSource(content, "pl", execution)).resolves.toBeNull();
  await expect(prepareSpokenSource(content, "pl", execution)).resolves.toBeNull();
  expect(model).not.toHaveBeenCalled();
  expect(execution.checkpoint?.read).not.toHaveBeenCalled();
});

test.each(["language", "options", "window"])("durable structure cannot be reused with a different %s identity", async (change) => {
  const checkpoint = store();
  model.mockResolvedValue(generated(proposal));
  const original = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(original).not.toBeNull();
  model.mockClear();
  if (change === "window") jest.mocked(getContextWindowSize).mockReturnValue(8192);
  await expect(prepareSpokenSource(source, change === "language" ? "en" : "pl", {
    checkpoint, ...(change === "options" ? { runtimeOptions: { modelPath: "/other.gguf" } } : {}),
  })).resolves.toEqual(original);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each(["read", "observer", "memo"])("rejects live ownership mutation in the %s boundary", async (where) => {
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint, signal: new AbortController().signal, taskEvidenceMemo: {} };
  const replace = (): void => { execution.signal = new AbortController().signal; };
  if (where === "read") jest.mocked(checkpoint.read).mockImplementationOnce(async () => { replace(); return null; });
  if (where === "observer") jest.mocked(recordGeneration).mockImplementationOnce(replace);
  if (where === "memo") Object.defineProperty(execution.taskEvidenceMemo, "sourceStructure", { get: () => { replace(); return undefined; } });
  model.mockResolvedValueOnce(generated(proposal));
  await expect(prepareSpokenSource(source, "pl", execution)).rejects.toThrow(/runtime changed/iu);
  expect(model).toHaveBeenCalledTimes(where === "observer" ? 1 : 0);
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test.each(["window", "options", "abort"])("does not publish when %s changes during proposal generation", async (change) => {
  const controller = new AbortController();
  const checkpoint = store();
  const execution: ProcessingExecutionContext = { checkpoint, signal: controller.signal };
  model.mockImplementationOnce(async () => {
    if (change === "window") jest.mocked(getContextWindowSize).mockReturnValue(8192);
    if (change === "options") execution.runtimeOptions = { modelPath: "/other.gguf" };
    if (change === "abort") controller.abort();
    return generated(proposal);
  });
  await expect(prepareSpokenSource(source, "pl", execution)).rejects.toThrow(/runtime changed|aborted/iu);
  expect(checkpoint.write).not.toHaveBeenCalled();
});
