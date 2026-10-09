import { extractTaskEvidence, extractTasks } from "./taskExtraction";
import { generate, getLoadedModelInfo, type LoadedModelInfo } from "./llm";
import { MODEL_CONFIG } from "./modelConfig";
import {
  collectSourceEvidence,
  fitsPrompt,
  SourceStatementTooLargeError,
  type SourceEvidence,
} from "./sourcePipeline";
import {
  PIPELINE_VERSION,
  type ProcessingCheckpointStore,
  type TaskEvidenceMemo,
  type SourceReviewSpan,
} from "./processingContext";

jest.mock("./llm", () => ({ generate: jest.fn(), getLoadedModelInfo: jest.fn(() => null) }));
jest.mock("./modelReady", () => ({ ensureModelReady: jest.fn() }));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));
jest.mock("./sourcePipeline", () => ({
  SourceStatementTooLargeError: jest.requireActual<typeof import("./sourcePipeline")>("./sourcePipeline").SourceStatementTooLargeError,
  collectSourceEvidence: jest.fn(),
  fitsPrompt: jest.fn(async () => true),
  isIncompleteGeneration: (result: { completion?: { status: string } }) =>
    result.completion !== undefined && result.completion.status !== "complete",
}));

const model = jest.mocked(generate);
const collect = jest.mocked(collectSourceEvidence);
const fits = jest.mocked(fitsPrompt);
const generated = (value: unknown, incomplete = false) => ({
  text: typeof value === "string" ? value : JSON.stringify(value),
  ttftMs: 1,
  tokensPerSecond: 20,
  wallMs: 2,
  promptMs: 1,
  predictedMs: 1,
  promptTokens: 100,
  predictedTokens: 2,
  completion: {
    status: incomplete ? ("stopped_limit" as const) : ("complete" as const),
    truncated: incomplete,
    stoppedLimit: incomplete,
    contextFull: false,
    interrupted: false,
    stoppedEos: !incomplete,
    stoppingWord: "",
  },
});

const evidenceFor = (
  entries: { task: string; kind?: "active" | "cancelled"; change?: boolean }[],
) => {
  const source = entries.map((entry) => entry.task).join("\n");
  let offset = 0;
  const evidence: SourceEvidence[] = entries.map((entry, index) => {
    const result: SourceEvidence = {
      id: `t${index}`,
      start: offset,
      end: offset + entry.task.length,
      quote: entry.task,
      task: entry.task,
      kind: entry.kind ?? "active",
      importance: 2,
      change: entry.change ?? false,
    };
    offset += entry.task.length + 1;
    return result;
  });
  collect.mockResolvedValue(evidence);
  return { source, evidence };
};

const links = (
  earlierId: string,
  earlierAction: string,
  laterAction = earlierAction,
) => ({
  links: [{ earlierId, earlierAction, laterAction }],
  unlinked: false,
  uncertain: false,
});
const store = () => {
  const values = new Map<string, unknown>();
  const checkpoint: ProcessingCheckpointStore = {
    read: jest.fn(async (key: string) => values.get(key) ?? null),
    write: jest.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
  return { values, checkpoint };
};

beforeEach(() => {
  model.mockReset();
  jest.mocked(getLoadedModelInfo).mockReset().mockReturnValue(null);
  collect.mockReset();
  fits.mockReset().mockResolvedValue(true);
});

test("an oversized indivisible statement returns explicit whole-source task review", async () => {
  const source = "Ula ma wysłać pełny opis gabloty.";
  collect.mockRejectedValue(new SourceStatementTooLargeError("Complete statement is oversized"));
  const onWarning = jest.fn();
  const onSourceReview = jest.fn();
  const result = await extractTaskEvidence(source, () => undefined, "pl", { onWarning, onSourceReview });
  expect(result.tasks).toEqual([]);
  expect(result.warnings).toHaveLength(1);
  expect(result.reviewSpans).toEqual([{ start: 0, end: source.length, quote: source,
    reason: "Complete source statement exceeds the model context" }]);
  expect(onWarning).toHaveBeenCalledWith(result.warnings[0]);
  expect(onSourceReview).toHaveBeenCalledWith(result.reviewSpans?.[0]);
});

test("task context fallback does not hide infrastructure failures", async () => {
  collect.mockRejectedValue(new Error("Tokenizer unavailable"));
  await expect(extractTaskEvidence("Ula ma wysłać opis gabloty.", () => undefined)).rejects.toThrow("Tokenizer unavailable");
});

describe("collector execution reads current outer runtime properties", () => {
  test.each(["signal", "checkpoint", "runtimeOptions"] as const)("keeps the %s view live and rejects a changed outer execution", async (field) => {
    const execution: NonNullable<Parameters<typeof extractTaskEvidence>[3]> = {
      signal: new AbortController().signal, checkpoint: store().checkpoint,
      runtimeOptions: { execution: "foreground" }, taskEvidenceMemo: {},
    };
    collect.mockImplementationOnce(async (_source, _mode, _language, taskExecution) => {
      expect(taskExecution?.signal).toBe(execution.signal);
      expect(taskExecution?.checkpoint).toBe(execution.checkpoint);
      expect(taskExecution?.runtimeOptions).toBe(execution.runtimeOptions);
      await Promise.resolve();
      if (field === "signal") execution.signal = new AbortController().signal;
      else if (field === "checkpoint") execution.checkpoint = store().checkpoint;
      else execution.runtimeOptions = { modelPath: "/changed.gguf" };
      expect(taskExecution?.[field]).toBe(execution[field]);
      return [];
    });
    await expect(extractTaskEvidence("Kira will send the report by Monday.", () => undefined, "en", execution))
      .rejects.toThrow("runtime changed");
    expect(collect).toHaveBeenCalledTimes(1);
    expect(model).not.toHaveBeenCalled();
    expect(execution.taskEvidenceMemo?.completed).toBeUndefined();
  });

  test("passes live abort through the collector view without returning or memoizing evidence", async () => {
    const controller = new AbortController();
    const execution = { signal: controller.signal, taskEvidenceMemo: {} as TaskEvidenceMemo };
    collect.mockImplementationOnce(async (_source, _mode, _language, taskExecution) => {
      controller.abort();
      expect(taskExecution?.signal?.aborted).toBe(true);
      return [];
    });
    await expect(extractTaskEvidence("Kira will send the report by Monday.", () => undefined, "en", execution))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(execution.taskEvidenceMemo.completed).toBeUndefined();
    expect(collect).toHaveBeenCalledTimes(1);
  });
});

const loadedContext = (): LoadedModelInfo => ({
  modelPath: "/a.gguf", model: MODEL_CONFIG, execution: "foreground",
  speculative: false, gpu: false, devices: [], reasonNoGPU: "", systemInfo: "", metadata: {},
});

const unrelatedPolishChange = () => evidenceFor([
  { task: "Iga wyśle atlas do Olafa przed czwartkiem." },
  { task: "Nie wyślemy katalogu, ponieważ dane są nieaktualne.", kind: "cancelled" },
  { task: "Filip sprawdzi adres odbiorcy w środę." },
]);
const rejectedPolishRelation = () => links(
  "t0", "Iga wyśle atlas do Olafa przed czwartkiem.",
  "Nie wyślemy katalogu, ponieważ dane są nieaktualne.",
);

test.each([
  ["literal action mismatch", rejectedPolishRelation()],
  ["foreign earlier ID", links("foreign", "Iga wyśle atlas do Olafa przed czwartkiem.")],
  ["invalid relationship schema", { links: "invalid", unlinked: false, uncertain: false }],
])("persists complete rejected %s as zero-removal uncertainty across fresh JSON-store resume", async (_reason, response) => {
  const { source, evidence } = unrelatedPolishChange();
  const { values, checkpoint } = store();
  model.mockResolvedValue(generated(response));
  const first = await extractTaskEvidence(source, () => undefined, "pl", { checkpoint, taskEvidenceMemo: {} });
  expect(first.tasks).toEqual([evidence[0].quote, evidence[2].quote]);
  expect(first.superseded).toEqual([]);
  expect(first.warnings).toEqual(["Nie udało się potwierdzić części zmian zadań. Zachowano pierwotne zadania; porównaj je ze źródłem."]);
  expect(values.size).toBe(1);
  const saved = [...values.values()][0] as { version: string; source: string; decision: unknown };
  expect(saved.version).toBe(`${PIPELINE_VERSION}:task-source-links-v3`);
  expect(saved.source).toContain(evidence[0].quote);
  expect(saved.source).toContain(evidence[1].quote);
  expect(saved.decision).toEqual({ links: [], unlinked: true, uncertain: true });
  const reopened = new Map<string, unknown>(JSON.parse(JSON.stringify([...values])));
  const freshStore: ProcessingCheckpointStore = {
    read: async key => reopened.get(key) ?? null,
    write: async (key, value) => { reopened.set(key, value); },
  };
  const onWarning = jest.fn();
  const resumed = await extractTaskEvidence(source, () => undefined, "pl", { checkpoint: freshStore, taskEvidenceMemo: {}, onWarning });
  expect(resumed).toEqual(first);
  expect(model).toHaveBeenCalledTimes(1);
  expect(onWarning).toHaveBeenCalledWith(first.warnings[0]);
});

test.each(["source", "language", "version"] as const)("canonical uncertainty checkpoint invalidates when %s changes", async changed => {
  const original = unrelatedPolishChange();
  const { values, checkpoint } = store();
  model.mockResolvedValue(generated(rejectedPolishRelation()));
  await extractTaskEvidence(original.source, () => undefined, "pl", { checkpoint });
  expect(model).toHaveBeenCalledTimes(1);
  expect(values.size).toBe(1);
  if (changed === "version") {
    const [key, value] = [...values.entries()][0];
    values.set(key, { ...(value as Record<string, unknown>), version: "obsolete-version" });
  }
  const current = changed === "source" ? evidenceFor([
    { task: "Iga wyśle atlas do Olafa przed piątkiem." },
    { task: original.evidence[1].quote, kind: "cancelled" },
    { task: original.evidence[2].quote },
  ]) : original;
  const proof = await extractTaskEvidence(current.source, () => undefined, changed === "language" ? "en" : "pl", { checkpoint, taskEvidenceMemo: {} });
  expect(model).toHaveBeenCalledTimes(2);
  expect(proof.tasks).toEqual([current.evidence[0].quote, current.evidence[2].quote]);
  expect(proof.superseded).toEqual([]);
  expect(proof.warnings).toHaveLength(1);
});

test.each(["incomplete", "malformed JSON"] as const)("does not persist retryable %s relationship output", async failure => {
  const { source, evidence } = unrelatedPolishChange();
  const { values, checkpoint } = store();
  model.mockResolvedValue(failure === "incomplete" ? generated(rejectedPolishRelation(), true) : generated("{not-json"));
  for (let index = 0; index < 2; index++) {
    const proof = await extractTaskEvidence(source, () => undefined, "pl", { checkpoint, taskEvidenceMemo: {} });
    expect(proof.tasks).toEqual([evidence[0].quote, evidence[2].quote]);
    expect(proof.warnings).toHaveLength(1);
  }
  expect(model).toHaveBeenCalledTimes(2);
  expect(values.size).toBe(0);
});

test("transport failure remains retryable and cannot persist a relationship decision", async () => {
  const { source } = unrelatedPolishChange();
  const { values, checkpoint } = store();
  model.mockRejectedValue(new Error("Transport failed"));
  for (let index = 0; index < 2; index++) await expect(extractTaskEvidence(source, () => undefined, "pl", { checkpoint })).rejects.toThrow("Transport failed");
  expect(model).toHaveBeenCalledTimes(2);
  expect(values.size).toBe(0);
});

test.each(["signal abort", "native interruption"] as const)("%s cannot persist canonical uncertainty", async failure => {
  const { source } = unrelatedPolishChange();
  const { checkpoint } = store();
  const controller = new AbortController();
  model.mockImplementationOnce(async () => {
    const result = generated(rejectedPolishRelation());
    if (failure === "signal abort") controller.abort();
    else result.completion.interrupted = true;
    return result;
  });
  await expect(extractTaskEvidence(source, () => undefined, "pl", { checkpoint, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("uncertainty checkpoint write failure propagates without a clean memo or swallowed warning", async () => {
  const { source } = unrelatedPolishChange();
  model.mockResolvedValue(generated(rejectedPolishRelation()));
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const onWarning = jest.fn();
  const checkpoint: ProcessingCheckpointStore = { read: async () => null, write: jest.fn(async () => { throw new Error("Durable write failed"); }) };
  await expect(extractTaskEvidence(source, () => undefined, "pl", { checkpoint, taskEvidenceMemo, onWarning })).rejects.toThrow("Durable write failed");
  expect(checkpoint.write).toHaveBeenCalledTimes(1);
  expect(taskEvidenceMemo.completed).toBeUndefined();
  expect(onWarning).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
});

test.each(["model context", "runtime path", "checkpoint", "signal"] as const)("changed %s is rejected before relationship checkpoint persistence", async changed => {
  const { source } = unrelatedPolishChange();
  const { checkpoint } = store();
  const context = loadedContext();
  jest.mocked(getLoadedModelInfo).mockReturnValue(context);
  const execution = { checkpoint, runtimeOptions: { modelPath: "/a.gguf" }, signal: new AbortController().signal, taskEvidenceMemo: {} as TaskEvidenceMemo };
  model.mockImplementationOnce(async () => {
    if (changed === "model context") jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
    if (changed === "runtime path") execution.runtimeOptions.modelPath = "/b.gguf";
    if (changed === "checkpoint") execution.checkpoint = store().checkpoint;
    if (changed === "signal") execution.signal = new AbortController().signal;
    return generated({ links: [], unlinked: true, uncertain: true });
  });
  await expect(extractTaskEvidence(source, () => undefined, "pl", execution)).rejects.toThrow("Task evidence runtime changed during processing");
  expect(checkpoint.write).not.toHaveBeenCalled();
  expect(execution.taskEvidenceMemo.completed).toBeUndefined();
});

test("runtime change during relationship checkpoint read stops before generation or write", async () => {
  const { source } = unrelatedPolishChange();
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  const checkpoint: ProcessingCheckpointStore = {
    read: async () => { jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext()); return null; },
    write: jest.fn(),
  };
  model.mockResolvedValue(generated(rejectedPolishRelation()));
  await expect(extractTaskEvidence(source, () => undefined, "pl", { checkpoint })).rejects.toThrow("Task evidence runtime changed during processing");
  expect(model).not.toHaveBeenCalled();
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("tampered uncertainty checkpoint witness is revalidated and never authorizes deletion", async () => {
  const { source, evidence } = unrelatedPolishChange();
  const { values, checkpoint } = store();
  model.mockResolvedValue(generated(rejectedPolishRelation()));
  await extractTaskEvidence(source, () => undefined, "pl", { checkpoint });
  expect(values.size).toBe(1);
  const [key, value] = [...values.entries()][0];
  values.set(key, { ...(value as Record<string, unknown>), decision: rejectedPolishRelation() });
  const proof = await extractTaskEvidence(source, () => undefined, "pl", { checkpoint, taskEvidenceMemo: {} });
  expect(model).toHaveBeenCalledTimes(2);
  expect(proof.tasks).toEqual([evidence[0].quote, evidence[2].quote]);
  expect(proof.superseded).toEqual([]);
  expect(proof.warnings).toHaveLength(1);
  expect((values.get(key) as { decision: unknown }).decision).toEqual({ links: [], unlinked: true, uncertain: true });
});

test.each([
  ["pl", "Ewa wyśle katalog do partnera we wtorek.", "Korekta: Ewa wyśle katalog do partnera w piątek, zamiast we wtorek."],
  ["en", "Nina will send the draft before Tuesday.", "Correction: Nina will send the draft before Friday, instead of before Tuesday."],
])("accepts a comma within an otherwise exact literal deadline replacement in %s", async (language, earlier, later) => {
  const { source, evidence } = evidenceFor([{ task: earlier }, { task: later }]);
  model.mockResolvedValue(generated(links(evidence[0].id, earlier, later)));
  const proof = await extractTaskEvidence(source, () => undefined, language as "pl" | "en");
  expect(proof.tasks).toEqual([later]);
  expect(proof.superseded).toEqual([{ earlier: evidence[0], later: evidence[1] }]);
  expect(proof.warnings).toEqual([]);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  "Korekta: Ewa wyśle katalog do innego partnera w piątek, zamiast we wtorek.",
  "Korekta: Ewa wyśle katalog i rachunek do partnera w piątek, zamiast we wtorek.",
  "Korekta: Ewa wyśle katalog do partnera w piątek, zamiast płacić we wtorek.",
])("a comma does not authorize a non-identical action or arbitrary replacement suffix: %s", async (later) => {
  const earlier = "Ewa wyśle katalog do partnera we wtorek.";
  const { source } = evidenceFor([{ task: earlier }, { task: later }]);
  model.mockResolvedValue(generated({ links: [], unlinked: true, uncertain: true }));
  const proof = await extractTaskEvidence(source, () => undefined, "pl");
  expect(proof.tasks).toEqual([earlier, later]);
  expect(proof.superseded).toEqual([]);
  expect(proof.warnings).toHaveLength(1);
});

test.each(["context", "signal"] as const)("does not reuse task evidence after %s identity changes", async (identity) => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  const execution = { taskEvidenceMemo: {}, signal: new AbortController().signal };
  await extractTasks(source, () => undefined, "en", execution);
  if (identity === "context") jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  else execution.signal = new AbortController().signal;
  await extractTasks(source, () => undefined, "en", execution);
  expect(collect).toHaveBeenCalledTimes(2);
});

test.each(["context", "runtime"] as const)("rejects %s changes during task collection without caching success", async (identity) => {
  const { source, evidence } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  const execution = { taskEvidenceMemo, runtimeOptions: { modelPath: "/a.gguf" } };
  collect.mockImplementationOnce(async () => {
    if (identity === "context") jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
    else execution.runtimeOptions.modelPath = "/b.gguf";
    return evidence;
  });
  await expect(extractTasks(source, () => undefined, "en", execution)).rejects.toThrow("runtime changed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
});

test("memo warning callback failure propagates", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report." }, { task: "Actually cancel that.", kind: "cancelled" }]);
  model.mockResolvedValue(generated({ links: [], unlinked: true, uncertain: true }));
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  await extractTasks(source, () => undefined, "en", { taskEvidenceMemo });
  await expect(extractTasks(source, () => undefined, "en", {
    taskEvidenceMemo, onWarning: () => { throw new Error("Callback failed"); },
  })).rejects.toThrow("Callback failed");
  expect(collect).toHaveBeenCalledTimes(1);
});

test("memo warning callback cannot change runtime and return cached success", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report." }, { task: "Actually cancel that.", kind: "cancelled" }]);
  model.mockResolvedValue(generated({ links: [], unlinked: true, uncertain: true }));
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  await extractTasks(source, () => undefined, "en", { taskEvidenceMemo });
  await expect(extractTasks(source, () => undefined, "en", {
    taskEvidenceMemo, onWarning: () => { jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext()); },
  })).rejects.toThrow("runtime changed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
});

test("an unrelated negation cannot delete Alice and Bob through an existing change ID", async () => {
  const { source } = evidenceFor([
    { task: "Alice will send the report by Friday." },
    { task: "Bob will test English transcription on Tuesday." },
    { task: "We will not buy new hardware.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(generated({ keep: false, supersededBy: "t2" }));
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual([
    "Alice will send the report by Friday.",
    "Bob will test English transcription on Tuesday.",
  ]);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each([
  [
    "en",
    "Send the report by Monday.",
    "Instead send the report by Friday.",
    "Send the report",
    "send the report",
  ],
  [
    "pl",
    "Marta wyśle raport do poniedziałku.",
    "Zamiast tego Marta wyśle raport do piątku.",
    "Marta wyśle raport",
    "Marta wyśle raport",
  ],
] as const)(
  "keeps only an exact same-action deadline replacement in %s",
  async (language, earlier, later, earlierAction, laterAction) => {
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, change: true },
    ]);
    model.mockResolvedValue(generated(links("t0", earlierAction, laterAction)));
    await expect(
      extractTasks(source, () => undefined, language),
    ).resolves.toEqual([later]);
  },
);

test("reuses only completed invocation-owned final task evidence", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const execution = { taskEvidenceMemo };
  const first = await extractTasks(source, () => undefined, "en", execution);
  first.push("Caller mutation.");
  expect(await extractTasks(source, () => undefined, "en", execution)).toEqual(["Alice will send the report by Friday."]);
  expect(collect).toHaveBeenCalledTimes(1);
  expect(taskEvidenceMemo.completed?.result.evidence).toHaveLength(1);
});

test.each(["source", "language", "runtime", "checkpoint", "pipeline"] as const)("invalidates task memo when %s identity changes", async (changed) => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const execution = { taskEvidenceMemo, runtimeOptions: { modelPath: "/a.gguf" }, checkpoint: store().checkpoint };
  await extractTasks(source, () => undefined, "en", execution);
  if (changed === "pipeline" && taskEvidenceMemo.completed)
    taskEvidenceMemo.completed = { ...taskEvidenceMemo.completed, key: "old-pipeline" };
  await extractTasks(changed === "source" ? source + " " : source, () => undefined,
    changed === "language" ? "pl" : "en", {
      ...execution,
      runtimeOptions: changed === "runtime" ? { modelPath: "/b.gguf" } : execution.runtimeOptions,
      checkpoint: changed === "checkpoint" ? store().checkpoint : execution.checkpoint,
    });
  expect(collect).toHaveBeenCalledTimes(2);
});

test("does not reuse a successful task memo after abort", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const controller = new AbortController();
  const execution = { taskEvidenceMemo: {}, signal: controller.signal };
  await extractTasks(source, () => undefined, "en", execution);
  controller.abort();
  await expect(extractTasks(source, () => undefined, "en", execution)).rejects.toMatchObject({ name: "AbortError" });
  expect(collect).toHaveBeenCalledTimes(1);
});

test("memo contains final removed-offset proof rather than an obsolete active deadline", async () => {
  const earlier = "Alice will send the report by Friday.";
  const later = "Deadline change: Alice will send the report by Thursday instead of by Friday.";
  const { source, evidence } = evidenceFor([{ task: earlier }, { task: later }]);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  expect(await extractTasks(source, () => undefined, "en", { taskEvidenceMemo })).toEqual([later]);
  expect(taskEvidenceMemo.completed?.result.evidence).toEqual([evidence[1]]);
  expect(taskEvidenceMemo.completed?.result.superseded).toEqual([{ earlier: evidence[0], later: evidence[1] }]);
});

test("replays uncertainty warnings from completed task memo without another relationship call", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }, { task: "Actually cancel that.", kind: "cancelled" }]);
  model.mockResolvedValue(generated({ links: [], unlinked: true, uncertain: true }));
  const execution = { taskEvidenceMemo: {}, onWarning: jest.fn() };
  await extractTasks(source, () => undefined, "en", execution);
  await extractTasks(source, () => undefined, "en", execution);
  expect(model).toHaveBeenCalledTimes(1);
  expect(execution.onWarning).toHaveBeenCalledTimes(2);
});

test("failed task checkpoint or warning callback never populates the success memo", async () => {
  const { source } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  collect.mockRejectedValueOnce(new Error("Checkpoint failed"));
  await expect(extractTasks(source, () => undefined, "en", { taskEvidenceMemo })).rejects.toThrow("Checkpoint failed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
  collect.mockImplementationOnce(async (_source, _purpose, _language, execution) => {
    execution?.onWarning?.("Unresolved evidence");
    return [];
  });
  await expect(extractTasks(source, () => undefined, "en", { taskEvidenceMemo, onWarning: () => { throw new Error("Callback failed"); } })).rejects.toThrow("Callback failed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
});

test.each([
  [
    "en",
    "Send the report.",
    "Do not send the report.",
    "Send the report",
    "send the report",
  ],
  [
    "pl",
    "Wysłać raport.",
    "Nie wysłać raport.",
    "Wysłać raport",
    "wysłać raport",
  ],
] as const)(
  "accepts an explicit exact-action cancellation in %s",
  async (language, earlier, later, earlierAction, laterAction) => {
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, kind: "cancelled" },
    ]);
    model.mockResolvedValue(generated(links("t0", earlierAction, laterAction)));
    await expect(
      extractTasks(source, () => undefined, language),
    ).resolves.toEqual([]);
  },
);

test.each([
  [
    "Alice will send the report.",
    "Bob will not send the report.",
    "send the report",
  ],
  [
    "Send the report to Alice.",
    "Do not send the report to Bob.",
    "Send the report",
  ],
  ["Pay invoice 1.2.", "Do not pay invoice 12.", "Pay invoice"],
  ["Send the report.", "Do not send the contract.", "Send"],
  ["Send the report.", "Do not send the report to Bob.", "Send the report"],
  [
    "Pay invoice by Friday 1200.",
    "Do not pay invoice by Friday 1300.",
    "Pay invoice",
  ],
])(
  "does not authorize a partial witness that loses owner, object or amount: %s",
  async (earlier, later, action) => {
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, kind: "cancelled" },
    ]);
    model.mockResolvedValue(
      generated(links("t0", action, action.toLowerCase())),
    );
    const onWarning = jest.fn();
    await expect(
      extractTasks(source, () => undefined, "en", { onWarning }),
    ).resolves.toEqual([earlier]);
    expect(onWarning).toHaveBeenCalledTimes(1);
  },
);

test("a forged witness and an unknown target retain the original tasks with a warning", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const onWarning = jest.fn();
  model.mockResolvedValueOnce(generated(links("t0", "Send the contract")));
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  model.mockResolvedValueOnce(
    generated(links("invented", "Send the report", "send the report")),
  );
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(onWarning).toHaveBeenCalledTimes(2);
});

test("a generic pronoun with two possible antecedents retains both tasks", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Call the supplier." },
    { task: "Actually cancel that.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(generated(links("t1", "Call the supplier", "that")));
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report.", "Call the supplier."]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test.each([
  ["en", "Alice will send the report.", "Alice will not send the report."],
  ["pl", "Marta wyśle raport.", "Marta nie wyśle raport."],
] as const)(
  "accepts only negation insertion when the complete actor and object stay identical in %s",
  async (language, earlier, later) => {
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, kind: "cancelled" },
    ]);
    model.mockResolvedValue(generated(links("t0", earlier, later)));
    await expect(
      extractTasks(source, () => undefined, language),
    ).resolves.toEqual([]);
  },
);

test("a no-link claim cannot hide a source pronoun that has no verified antecedent", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Call the supplier." },
    { task: "Actually cancel that.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated({ links: [], unlinked: true, uncertain: false }),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report.", "Call the supplier."]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("an explicitly uncertain no-link result retains tasks with a warning", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Drop the mailing.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated({ links: [], unlinked: true, uncertain: true }),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("an explicit unrelated outcome keeps all tasks without a warning", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not buy hardware.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated({ links: [], unlinked: true, uncertain: false }),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(onWarning).not.toHaveBeenCalled();
});

test.each([
  [
    "en",
    "Lina will send the prototype on Monday.",
    "New deadline: Lina will send the prototype on Wednesday instead of Monday.",
    "Lina will send the prototype",
  ],
  [
    "pl",
    "Tomek wyśle prototyp w poniedziałek.",
    "Zmiana terminu: Tomek wyśle prototyp w środę zamiast w poniedziałek.",
    "Tomek wyśle prototyp",
  ],
] as const)(
  "preserves the source deadline correction clause in %s",
  async (language, earlier, later, action) => {
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, change: true },
    ]);
    model.mockResolvedValue(generated(links("t0", action)));
    await expect(
      extractTasks(source, () => undefined, language),
    ).resolves.toEqual([later]);
  },
);

test("duplicate action targets remain ambiguous across case and deadlines", async () => {
  const { source } = evidenceFor([
    { task: "Send the report by Monday." },
    { task: "send the report by Tuesday." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated(links("t0", "Send the report", "send the report")),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual([
    "Send the report by Monday.",
    "send the report by Tuesday.",
  ]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test.each(["broken JSON", { links: [] }, { links: [], unlinked: false }])(
  "an unverifiable result retains tasks after one bounded call: %j",
  async (response) => {
    const { source } = evidenceFor([
      { task: "Send the report." },
      { task: "Do not send the report.", kind: "cancelled" },
    ]);
    model.mockResolvedValue(generated(response));
    const onWarning = jest.fn();
    await expect(
      extractTasks(source, () => undefined, "en", { onWarning }),
    ).resolves.toEqual(["Send the report."]);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(1);
  },
);

test("a truncated relationship does not retry or remove any task", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated(links("t0", "Send the report", "send the report"), true),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("twenty earlier tasks share one request for a later unrelated change", async () => {
  const tasks = Array.from(
    { length: 20 },
    (_, index) => `Prepare document ${index + 1} by Friday.`,
  );
  const { source } = evidenceFor([
    ...tasks.map((task) => ({ task })),
    { task: "Do not buy hardware.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(generated({ links: [], unlinked: true }));
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual(
    tasks,
  );
  expect(model).toHaveBeenCalledTimes(1);
});

test("does not reconcile a reinstated commitment against an earlier cancellation", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
    { task: "Send the report." },
  ]);
  model.mockResolvedValue(
    generated(links("t0", "Send the report", "send the report")),
  );
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
    "Send the report.",
  ]);
  expect(model).toHaveBeenCalledTimes(1);
});

test("validated source relationships resume but a legacy ID-only checkpoint cannot delete", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const { checkpoint, values } = store();
  values.set("task-change:t0:0", {
    version: PIPELINE_VERSION,
    decision: { keep: false, supersededBy: "t1" },
  });
  model.mockResolvedValue(
    generated(links("t0", "Send the report", "send the report")),
  );
  await expect(
    extractTasks(source, () => undefined, "en", { checkpoint }),
  ).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  await expect(
    extractTasks(source, () => undefined, "en", { checkpoint }),
  ).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  const key = [...values.keys()].find((candidate) =>
    candidate.startsWith("task-change-links:"),
  );
  expect(key).toBeDefined();
  const saved = values.get(key!) as Record<string, unknown>;
  values.set(key!, { ...saved, version: "old-relationships" });
  await extractTasks(source, () => undefined, "en", { checkpoint });
  expect(model).toHaveBeenCalledTimes(2);
});

test("changed source invalidates a previously accepted relationship checkpoint", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const { checkpoint } = store();
  model.mockResolvedValueOnce(
    generated(links("t0", "Send the report", "send the report")),
  );
  await extractTasks(source, () => undefined, "en", { checkpoint });
  const changed = evidenceFor([
    { task: "Send the report." },
    { task: "Do not buy hardware.", kind: "cancelled" },
  ]);
  model.mockResolvedValueOnce(generated({ links: [], unlinked: true }));
  await expect(
    extractTasks(changed.source, () => undefined, "en", { checkpoint }),
  ).resolves.toEqual(["Send the report."]);
  expect(model).toHaveBeenCalledTimes(2);
});

test("abort after generation remains an abort and writes no relationship checkpoint", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const controller = new AbortController();
  const { checkpoint } = store();
  model.mockImplementation(async () => {
    controller.abort();
    return generated({ links: [], unlinked: true });
  });
  await expect(
    extractTasks(source, () => undefined, "en", {
      checkpoint,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("checkpoint write failure propagates without another model call or uncertainty fallback", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const checkpoint: ProcessingCheckpointStore = {
    read: async () => null,
    write: async () => {
      throw new Error("DB unavailable");
    },
  };
  const onWarning = jest.fn();
  model.mockResolvedValue(
    generated(links("t0", "Send the report", "send the report")),
  );
  await expect(
    extractTasks(source, () => undefined, "en", { checkpoint, onWarning }),
  ).rejects.toThrow("DB unavailable");
  expect(model).toHaveBeenCalledTimes(1);
  expect(onWarning).not.toHaveBeenCalled();
});

test("negating only one clause cannot remove both actions from a compound source task", async () => {
  const earlier =
    "Marta will send the report, and Piotr will call the supplier.";
  const later =
    "Marta will not send the report, and Piotr will call the supplier.";
  const { source } = evidenceFor([
    { task: earlier },
    { task: later, kind: "cancelled" },
  ]);
  model.mockResolvedValue(generated(links("t0", earlier, later)));
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual([earlier]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("a partial action witness cannot remove an entire two-owner source sentence", async () => {
  const earlier =
    "Marta wyśle raport do piątku, a Piotr sprawdzi mikrofon we wtorek.";
  const { source } = evidenceFor([
    { task: earlier },
    { task: "Marta nie wyśle raport.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated(links("t0", "Marta wyśle raport", "Marta nie wyśle raport")),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "pl", { onWarning }),
  ).resolves.toEqual([earlier]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("ambiguity is checked against candidates outside the current context batch", async () => {
  const { source } = evidenceFor([
    { task: "Send the report by Monday." },
    { task: "Send the report by Tuesday." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  fits.mockImplementation(async (_source, request) => {
    const earlier = JSON.parse(
      request.prompt("").split("\nEARLIER\n")[1].split("\nLATER\n")[0],
    ) as SourceEvidence[];
    return earlier.length <= 1;
  });
  model.mockImplementation(async (prompt) => {
    const earlier = JSON.parse(
      prompt.split("\nEARLIER\n")[1].split("\nLATER\n")[0],
    ) as SourceEvidence[];
    return generated(
      links(earlier[0].id, "Send the report", "send the report"),
    );
  });
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual([
    "Send the report by Monday.",
    "Send the report by Tuesday.",
  ]);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(2);
});

test("an oversized comparison retains the task with a warning and makes no generation", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  fits.mockResolvedValue(false);
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test("a cancelled model label alone cannot erase a repeated affirmative source commitment", async () => {
  const { source } = evidenceFor([
    { task: "Alice will send the report." },
    { task: "Alice will send the report.", kind: "cancelled" },
  ]);
  model.mockResolvedValue(
    generated(
      links("t0", "Alice will send the report.", "Alice will send the report."),
    ),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).resolves.toEqual(["Alice will send the report."]);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  "preserves Change and Update as distinct action verbs even with change=%s",
  async (change) => {
    const earlier = "Change supplier by Friday.";
    const later = "Update supplier by Thursday.";
    const { source } = evidenceFor([
      { task: earlier },
      { task: later, change },
    ]);
    model.mockResolvedValue(generated(links("t0", earlier, later)));
    await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
      earlier,
      later,
    ]);
  },
);

test("a tampered persisted witness is revalidated before it can remove a task", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const { values, checkpoint } = store();
  model.mockResolvedValueOnce(
    generated(links("t0", "Send the report", "send the report")),
  );
  await extractTasks(source, () => undefined, "en", { checkpoint });
  const key = [...values.keys()][0];
  const saved = values.get(key) as Record<string, unknown>;
  values.set(key, { ...saved, decision: links("t0", "Send the contract") });
  model.mockResolvedValueOnce(
    generated({ links: [], unlinked: true, uncertain: true }),
  );
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { checkpoint, onWarning }),
  ).resolves.toEqual(["Send the report."]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

test("checkpoint read failure propagates before generation", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const checkpoint: ProcessingCheckpointStore = {
    read: async () => {
      throw new Error("DB unavailable");
    },
    write: jest.fn(),
  };
  await expect(
    extractTasks(source, () => undefined, "en", { checkpoint }),
  ).rejects.toThrow("DB unavailable");
  expect(model).not.toHaveBeenCalled();
  expect(checkpoint.write).not.toHaveBeenCalled();
});

test("native interruption remains an abort even if the JS signal is not aborted", async () => {
  const { source } = evidenceFor([
    { task: "Send the report." },
    { task: "Do not send the report.", kind: "cancelled" },
  ]);
  const result = generated({ links: [], unlinked: true, uncertain: false });
  model.mockResolvedValue({
    ...result,
    completion: {
      ...result.completion,
      status: "interrupted",
      interrupted: true,
    },
  });
  const onWarning = jest.fn();
  await expect(
    extractTasks(source, () => undefined, "en", { onWarning }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(onWarning).not.toHaveBeenCalled();
});

test("literal same-owner negation cancels despite an omitted deadline without a model comparison", async () => {
  const { source } = evidenceFor([
    { task: "Alice will send the report by Friday." },
    { task: "Alice will not send the report.", kind: "cancelled" },
    { task: "Bob will test the microphone on Tuesday." },
  ]);
  model.mockResolvedValue(
    generated(
      links(
        "t0",
        "Alice will send the report by Friday.",
        "Alice will not send the report.",
      ),
    ),
  );
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
    "Bob will test the microphone on Tuesday.",
  ]);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  [
    "en",
    "Nora will send invoice by Monday.",
    "Instead, Nora will send invoice by Thursday.",
    "Nora will send invoice",
  ],
  [
    "pl",
    "Tomek wyśle prototyp w poniedziałek.",
    "Zmiana terminu: Tomek wyśle prototyp w środę zamiast w poniedziałek.",
    "Tomek wyśle prototyp",
  ],
] as const)(
  "a source update cue reconciles the deadline even when model change is absent in %s",
  async (language, earlier, later, action) => {
    const { source } = evidenceFor([{ task: earlier }, { task: later }]);
    model.mockResolvedValue(generated(links("t0", action)));
    await expect(
      extractTasks(source, () => undefined, language),
    ).resolves.toEqual([later]);
    expect(model).not.toHaveBeenCalled();
  },
);


const reviewFor = (source: string, quote: string): SourceReviewSpan => ({
  start: source.indexOf(quote),
  end: source.indexOf(quote) + quote.length,
  quote,
  reason: "Source action has an unresolved subject; verify the whole statement.",
});

test("retains a literal unresolved source span without a checkpoint or an active task", async () => {
  const source = "Background 🗒️. my will prepare the outline by Thursday.";
  const span = reviewFor(source, "my will prepare the outline by Thursday.");
  const onSourceReview = jest.fn();
  const onWarning = jest.fn();
  collect.mockImplementationOnce(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(span);
    execution?.onWarning?.("Review the unresolved source.");
    return [];
  });
  const proof = await extractTaskEvidence(source, () => undefined, "en", { onSourceReview, onWarning });
  expect(proof.tasks).toEqual([]);
  expect(proof.evidence).toEqual([]);
  expect(proof.superseded).toEqual([]);
  expect(proof.reviewSpans).toEqual([span]);
  expect(proof.warnings).toEqual(["Review the unresolved source."]);
  expect(onSourceReview).toHaveBeenCalledTimes(1);
  expect(onSourceReview).toHaveBeenCalledWith(span);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test("copies and deduplicates review spans before forwarding mutable consumer objects", async () => {
  const quote = "my will prepare the outline by Thursday.";
  const { source: activeSource, evidence } = evidenceFor([{ task: "Alice will send the report by Friday." }]);
  const source = `${activeSource} ${quote}`;
  const span = reviewFor(source, quote);
  const expected = { ...span };
  const onSourceReview = jest.fn((value: SourceReviewSpan) => { Reflect.set(value, "quote", "Consumer mutation."); });
  collect.mockImplementationOnce(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(span);
    execution?.onSourceReview?.({ ...span });
    Reflect.set(span, "quote", "Collector mutation.");
    return evidence;
  });
  const proof = await extractTaskEvidence(source, () => undefined, "en", { onSourceReview });
  expect(proof.reviewSpans).toEqual([expected]);
  expect(proof.tasks).toEqual([activeSource]);
  expect(onSourceReview).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test("memo replay preserves and freezes unresolved quotes and warnings without another collection", async () => {
  const source = "my will prepare the outline by Thursday.";
  const span = reviewFor(source, source);
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const onSourceReview = jest.fn();
  const onWarning = jest.fn();
  const execution = { taskEvidenceMemo, onSourceReview, onWarning };
  collect.mockImplementationOnce(async (_content, _mode, _language, context) => {
    context?.onSourceReview?.(span);
    context?.onWarning?.("Review the unresolved source.");
    return [];
  });
  const first = await extractTaskEvidence(source, () => undefined, "en", execution);
  expect(first.reviewSpans).toEqual([span]);
  expect(Object.isFrozen(taskEvidenceMemo.completed?.result.reviewSpans)).toBe(true);
  expect(Object.isFrozen(taskEvidenceMemo.completed?.result.reviewSpans?.[0])).toBe(true);
  Reflect.set(first.reviewSpans?.[0] ?? {}, "quote", "Caller mutation.");
  const resumed = await extractTaskEvidence(source, () => undefined, "en", execution);
  expect(resumed.reviewSpans).toEqual([span]);
  expect(resumed.tasks).toEqual([]);
  expect(resumed.warnings).toEqual(["Review the unresolved source."]);
  expect(onSourceReview).toHaveBeenCalledTimes(2);
  expect(onSourceReview.mock.calls[1][0]).toEqual(span);
  expect(onWarning).toHaveBeenCalledTimes(2);
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  ["negative offset", { start: -1 }],
  ["fractional offset", { start: 0.5 }],
  ["empty range", { end: 0 }],
  ["outside source", { end: 1000 }],
  ["rewritten quote", { quote: "Maya will prepare the outline by Thursday." }],
  ["empty reason", { reason: "" }],
  ["blank reason", { reason: "  " }],
  ["non-string reason", { reason: 123 }],
] as const)("rejects a review span with %s before forwarding or caching it", async (_name, override) => {
  const source = "my will prepare the outline by Thursday.";
  const span = { ...reviewFor(source, source), ...override } as SourceReviewSpan;
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const onSourceReview = jest.fn();
  collect.mockImplementationOnce(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(span);
    return [];
  });
  await expect(extractTaskEvidence(source, () => undefined, "en", { taskEvidenceMemo, onSourceReview }))
    .rejects.toThrow("Review span does not match its source");
  expect(onSourceReview).not.toHaveBeenCalled();
  expect(taskEvidenceMemo.completed).toBeUndefined();
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test("fresh review consumer failure propagates without creating a clean task memo", async () => {
  const source = "my will prepare the outline by Thursday.";
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  collect.mockImplementationOnce(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(reviewFor(source, source));
    return [];
  });
  await expect(extractTaskEvidence(source, () => undefined, "en", {
    taskEvidenceMemo, onSourceReview: () => { throw new Error("Review consumer failed"); },
  })).rejects.toThrow("Review consumer failed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test("memo review consumer failure propagates without recollecting source or running a model", async () => {
  const source = "my will prepare the outline by Thursday.";
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  collect.mockImplementationOnce(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(reviewFor(source, source));
    return [];
  });
  await extractTaskEvidence(source, () => undefined, "en", { taskEvidenceMemo });
  await expect(extractTaskEvidence(source, () => undefined, "en", {
    taskEvidenceMemo, onSourceReview: () => { throw new Error("Review consumer failed"); },
  })).rejects.toThrow("Review consumer failed");
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test.each(["fresh", "memo"] as const)("review consumer cannot change the runtime and return %s success", async (phase) => {
  const source = "my will prepare the outline by Thursday.";
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext());
  collect.mockImplementation(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(reviewFor(source, source));
    return [];
  });
  if (phase === "memo") await extractTaskEvidence(source, () => undefined, "en", { taskEvidenceMemo });
  await expect(extractTaskEvidence(source, () => undefined, "en", {
    taskEvidenceMemo, onSourceReview: () => { jest.mocked(getLoadedModelInfo).mockReturnValue(loadedContext()); },
  })).rejects.toThrow("runtime changed");
  expect(taskEvidenceMemo.completed).toBeUndefined();
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});

test.each(["fresh", "memo"] as const)("review consumer cancellation remains an abort on %s extraction", async (phase) => {
  const source = "my will prepare the outline by Thursday.";
  const taskEvidenceMemo: TaskEvidenceMemo = {};
  const controller = new AbortController();
  collect.mockImplementation(async (_content, _mode, _language, execution) => {
    execution?.onSourceReview?.(reviewFor(source, source));
    return [];
  });
  const execution = { taskEvidenceMemo, signal: controller.signal };
  if (phase === "memo") await extractTaskEvidence(source, () => undefined, "en", execution);
  await expect(extractTaskEvidence(source, () => undefined, "en", {
    ...execution, onSourceReview: () => { controller.abort(); },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(collect).toHaveBeenCalledTimes(1);
  expect(model).not.toHaveBeenCalled();
});
