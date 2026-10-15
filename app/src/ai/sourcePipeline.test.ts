import { generate, getContextWindowSize, measureFormattedPromptTokens } from "./llm";
import {
  collectSourceEvidence,
  evidenceText,
  hasStandaloneRequiredActionCandidate,
  prepareGlobalSource,
  selectGlobalEvidence,
  splitSourceByPromptBudget,
  type SourceEvidence,
} from "./sourcePipeline";
import { extractTasks, extractTaskEvidence } from "./taskExtraction";
import { isCompletedActionReview } from "./sourcePipeline";
import { processNoteWithLlm } from "./noteProcessing";
import { ENGLISH_AUDIO_FIXTURE_DATA } from "./benchmarkAudioFixturesData";
import type { ProcessingCheckpointStore, SourceReviewSpan } from "./processingContext";
import { setSummaryEngineMode } from './summaryEngine';

// These suites exercise the LLM-verified engine directly.
setSummaryEngineMode('verified');

jest.mock("./llm", () => ({
  generate: jest.fn(),
  isModelLoaded: () => true,
  isModelLoadedFor: () => true,
  loadModel: jest.fn(),
  measureFormattedPromptTokens: jest.fn(async ({
    systemPrompt,
    userPrompt,
  }: {
    systemPrompt: string;
    userPrompt: string;
  }) => Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12),
  getContextWindowSize: jest.fn(() => 4096),
  getLoadedModelInfo: () => null,
}));
jest.mock("./modelDownload", () => ({
  isModelDownloaded: async () => true,
  getModelPath: () => "/default.gguf",
}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));

describe("coordination review is isolated from ordinary task recovery", () => {
  const ordinary = "This was background discussion about existing material rather than a new assignment to rewrite the records Elian will contact the guest speaker by Tuesday.";
  const nominal = "The schedule the participants and the revised attendance list.";
  const frozen = "Kira will send the revised report by Monday.";
  const source = [ordinary, nominal, frozen].join(" ");
  const initial = '{"tasks":[{"id":1,"kind":"uncertain"},{"id":2,"kind":"active"},{"id":3,"kind":"active"}]}';
  const ordinaryResult = '{"tasks":[{"id":1,"kind":"active"}]}';
  const nominalResult = '{"tasks":[{"id":2,"kind":"uncertain"}]}';
  const install = (): void => {
    model.mockResolvedValueOnce(generated(initial))
      .mockResolvedValueOnce(generated(ordinaryResult))
      .mockResolvedValueOnce(generated(nominalResult));
  };

  test("freezes recovered and initially valid IDs, then reviews only the complete nominal ID in a third compact call", async () => {
    install();
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    const continued = jest.fn(async () => { expect(model).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled(); });
    const evidence = await collectSourceEvidence(source, "tasks", "en", { checkpoint }, continued);
    expect(model).toHaveBeenCalledTimes(3);
    expect(continued).toHaveBeenCalledTimes(1);
    expect(evidence.filter((entry) => entry.kind === "active").map((entry) => entry.quote)).toEqual([ordinary, frozen]);
    const normal = model.mock.calls[1];
    expect(sourceOf(normal[0])).toBe(`[1] ${ordinary}`);
    expect(normal[0]).not.toContain("LITERAL_COORDINATION_REVIEW");
    expect(normal[0]).not.toContain(nominal);
    expect(normal[2]?.jsonSchema).toMatchObject({ properties: { tasks: { minItems: 1, maxItems: 1, items: { properties: { id: { enum: [1] } } } } } });
    const extra = model.mock.calls[2];
    expect(sourceOf(extra[0])).toBe(`[2] ${nominal}`);
    expect(extra[0]).not.toContain(ordinary);
    expect(extra[0]).not.toContain(frozen);
    expect(extra[2]?.jsonSchema).toMatchObject({ properties: { tasks: { minItems: 1, maxItems: 1, items: { properties: { id: { enum: [2] } } } } } });
    expect(write).toHaveBeenCalledTimes(1);
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint })).resolves.toEqual(evidence);
    expect(model).not.toHaveBeenCalled();
  });

  test("accepts a genuine present-tense active decision in the isolated batch without altering other evidence", async () => {
    const current = "The children choose the route and the current activity list.";
    const content = source.replace(nominal, current);
    model.mockResolvedValueOnce(generated(initial))
      .mockResolvedValueOnce(generated(ordinaryResult))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
    const evidence = await collectSourceEvidence(content, "tasks", "en");
    expect(model).toHaveBeenCalledTimes(3);
    expect(evidence.map((entry) => entry.quote)).toEqual([ordinary, current, frozen]);
    for (const entry of evidence) expect(content.slice(entry.start, entry.end)).toBe(entry.quote);
  });

  test.each(["abort", "runtime"])("does not publish an ordinary partial checkpoint if %s occurs before the isolated batch", async (kind) => {
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    const controller = new AbortController();
    const execution: Parameters<typeof collectSourceEvidence>[3] = { checkpoint, signal: controller.signal };
    model.mockResolvedValueOnce(generated(initial)).mockImplementationOnce(async () => {
      if (kind === "abort") controller.abort();
      else execution.signal = new AbortController().signal;
      return generated(ordinaryResult);
    });
    const pending = collectSourceEvidence(source, "tasks", "en", execution);
    if (kind === "abort") await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    else await expect(pending).rejects.toThrow("runtime changed");
    expect(model).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
  });

  test.each(["incomplete", "invalid", "exception", "interrupted"])("publishes no partial checkpoint after an isolated %s result and never attempts another list call", async (kind) => {
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    model.mockResolvedValueOnce(generated(initial)).mockResolvedValueOnce(generated(ordinaryResult));
    if (kind === "exception") model.mockRejectedValueOnce(new Error("isolated failure"));
    else if (kind === "interrupted") model.mockResolvedValueOnce({ ...generated(nominalResult), completion: { ...generated(nominalResult).completion, interrupted: true } });
    else model.mockResolvedValueOnce(generated(kind === "invalid" ? '{"tasks":[{"id":1,"kind":"active"}]}' : nominalResult, kind === "incomplete"));
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint })).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(3);
    expect(write).not.toHaveBeenCalled();
  });

  test.each(["signal", "checkpoint", "runtimeOptions"] as const)("rejects an outer %s replacement before attempting the isolated batch or writing evidence", async (field) => {
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    const warning = jest.fn();
    const review = jest.fn();
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = {
      signal: new AbortController().signal, checkpoint, runtimeOptions: { execution: "foreground" },
      taskEvidenceMemo: {}, onWarning: warning, onSourceReview: review,
    };
    model.mockResolvedValueOnce(generated(initial)).mockImplementationOnce(async () => {
      if (field === "signal") execution.signal = new AbortController().signal;
      else if (field === "checkpoint") execution.checkpoint = checkpointStore();
      else execution.runtimeOptions = { modelPath: "/changed.gguf" };
      return generated(ordinaryResult);
    }).mockResolvedValueOnce(generated(nominalResult));
    await expect(extractTaskEvidence(source, () => undefined, "en", execution)).rejects.toThrow("runtime changed");
    expect(model).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    expect(execution.taskEvidenceMemo?.completed).toBeUndefined();
  });

  test.each(["signal", "checkpoint", "runtimeOptions"] as const)("rejects a direct %s replacement inside an awaited write without returning evidence or notifying consumers", async (field) => {
    install();
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    const review = jest.fn();
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = {
      signal: new AbortController().signal, runtimeOptions: { execution: "foreground" },
      onWarning: warning, onSourceReview: review,
    };
    const write = jest.fn(async (key: string, value: unknown) => {
      await checkpoint.write(key, value);
      if (field === "signal") execution.signal = new AbortController().signal;
      else if (field === "checkpoint") execution.checkpoint = checkpointStore();
      else execution.runtimeOptions = { modelPath: "/changed.gguf" };
    });
    execution.checkpoint = { read: checkpoint.read, write };
    await expect(collectSourceEvidence(source, "tasks", "en", execution)).rejects.toThrow("runtime changed");
    expect(model).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(1);
    // Persistence already happened; rejecting returned evidence is not rollback.
    expect(await checkpoint.read(`tasks:0:${source.length}`)).not.toBeNull();
    expect(warning).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  test.each(["warning", "review"] as const)("rejects runtime mutation during a source %s notification instead of returning evidence", async (notification) => {
    const unknown = "my will prepare the current outline by Thursday.";
    model.mockResolvedValueOnce(generated('{"tasks":[]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = {
      signal: new AbortController().signal, checkpoint,
    };
    const mutate = jest.fn(() => { execution.signal = new AbortController().signal; });
    const laterReview = jest.fn();
    if (notification === "warning") { execution.onWarning = mutate; execution.onSourceReview = laterReview; }
    else execution.onSourceReview = mutate;
    await expect(collectSourceEvidence(unknown, "tasks", "en", execution)).rejects.toThrow("runtime changed");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(laterReview).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(2);
  });

  test("keeps live cancellation during an awaited durable write and does not claim rollback", async () => {
    install();
    const controller = new AbortController();
    const checkpoint = checkpointStore();
    const write = jest.fn(async (key: string, value: unknown) => {
      await checkpoint.write(key, value);
      controller.abort();
    });
    await expect(collectSourceEvidence(source, "tasks", "en", {
      signal: controller.signal, checkpoint: { read: checkpoint.read, write },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(3);
    expect(await checkpoint.read(`tasks:0:${source.length}`)).not.toBeNull();
  });

  test("preserves the ordinary and isolated decisions through outer extraction and durable resume when runtime is unchanged", async () => {
    install();
    const checkpoint = checkpointStore();
    const write = jest.spyOn(checkpoint, "write");
    const execution = { signal: new AbortController().signal, checkpoint, runtimeOptions: { execution: "foreground" as const } };
    const first = await extractTaskEvidence(source, () => undefined, "en", execution);
    expect(first.tasks).toEqual([ordinary, frozen]);
    expect(model).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(1);
    model.mockClear();
    await expect(extractTaskEvidence(source, () => undefined, "en", execution)).resolves.toEqual(first);
    expect(model).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test.each(["signal", "checkpoint", "runtimeOptions"] as const)("rejects a %s replacement inside awaited saved evidence read before returning or generating", async (field) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const checkpoint = checkpointStore();
    await collectSourceEvidence(frozen, "tasks", "en", { checkpoint });
    model.mockClear();
    const write = jest.spyOn(checkpoint, "write");
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = {
      signal: new AbortController().signal, runtimeOptions: { execution: "foreground" },
    };
    execution.checkpoint = { write: checkpoint.write, read: async (key) => {
      const saved = await checkpoint.read(key);
      if (field === "signal") execution.signal = new AbortController().signal;
      else if (field === "checkpoint") execution.checkpoint = checkpointStore();
      else execution.runtimeOptions = { modelPath: "/changed.gguf" };
      return saved;
    } };
    await expect(collectSourceEvidence(frozen, "tasks", "en", execution)).rejects.toThrow("runtime changed");
    expect(model).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test.each(["warning", "review"] as const)("rejects runtime mutation during a saved %s callback without publishing cached evidence", async (notification) => {
    const unknown = "my will prepare the current outline by Thursday.";
    model.mockResolvedValueOnce(generated('{"tasks":[]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    const checkpoint = checkpointStore();
    await collectSourceEvidence(unknown, "tasks", "en", { checkpoint });
    model.mockClear();
    const write = jest.spyOn(checkpoint, "write");
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = { signal: new AbortController().signal, checkpoint };
    const mutate = jest.fn(() => { execution.signal = new AbortController().signal; });
    const laterReview = jest.fn();
    if (notification === "warning") { execution.onWarning = mutate; execution.onSourceReview = laterReview; }
    else execution.onSourceReview = mutate;
    await expect(collectSourceEvidence(unknown, "tasks", "en", execution)).rejects.toThrow("runtime changed");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(laterReview).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test.each(["signal", "checkpoint", "runtimeOptions"] as const)("rejects a %s replacement during subdivision write before generating child ranges", async (field) => {
    const checkpoint = checkpointStore();
    const execution: NonNullable<Parameters<typeof collectSourceEvidence>[3]> = {
      signal: new AbortController().signal, runtimeOptions: { execution: "foreground" },
    };
    const write = jest.fn(async (key: string, value: unknown) => {
      await checkpoint.write(key, value);
      if (field === "signal") execution.signal = new AbortController().signal;
      else if (field === "checkpoint") execution.checkpoint = checkpointStore();
      else execution.runtimeOptions = { modelPath: "/changed.gguf" };
    });
    execution.checkpoint = { read: checkpoint.read, write };
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'))
      .mockResolvedValueOnce(generated(initial, true));
    await expect(collectSourceEvidence(source, "tasks", "en", execution)).rejects.toThrow("runtime changed");
    expect(model).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe(`tasks:split:0:${source.length}`);
    expect(await checkpoint.read(`tasks:split:0:${source.length}`)).not.toBeNull();
  });
});

describe("determiner coordination receives one initial predicate review", () => {
  test.each([
    "The episode outline the speaker and the updated guest list.",
    "The schedule, the participants and the revised attendance list.",
    "A route description a guide and an updated map.",
    "These notes, those labels and the current room chart.",
    "The editors review the schedule and the current participant list.",
    "The children choose the route and the current activity list.",
    "The editor reviews the schedule and the current participant list.",
    "The chemist calibrates the sensor and the new pressure gauge.",
  ])("reviews a possible list without locally deciding whether an unknown/present predicate is an action: %s", async (source) => {
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    const evidence = await collectSourceEvidence(source, "tasks", "en");
    expect(model).toHaveBeenCalledTimes(2);
    expect(evidence.filter((entry) => entry.kind === "active")).toEqual([]);
    const retry = model.mock.calls[1][0];
    expect(sourceOf(retry)).toBe(`[1] ${source}`);
    expect(retry).toContain("LITERAL_COORDINATION_REVIEW_START");
    expect(retry).toContain("not proof that the statement is a list");
    const rows = retry.match(/LITERAL_COORDINATION_REVIEW_START\n([\s\S]*?)\nLITERAL_COORDINATION_REVIEW_END/u)?.[1];
    expect(rows).toBeDefined();
    expect(JSON.parse(rows!)).toEqual({ id: 1, start: 0, end: source.length, quote: source });
  });

  test.each([
    "The editors review the schedule and the current participant list.",
    "The children choose the route and the current activity list.",
    "The editor reviews the schedule and the current participant list.",
    "The chemist calibrates the sensor and the new pressure gauge.",
    "The episode outline the speaker and the updated guest list.",
  ])("accepts the model's active whole-ID decision after one bounded review rather than pretending to prove a missing predicate: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const checkpoint = checkpointStore();
    const evidence = await collectSourceEvidence(source, "tasks", "en", { checkpoint });
    expect(model).toHaveBeenCalledTimes(2);
    expect(evidence).toEqual([expect.objectContaining({ quote: source, task: source, kind: "active", start: 0, end: source.length })]);
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint })).resolves.toEqual(evidence);
    expect(model).not.toHaveBeenCalled();
  });

  test.each([
    "Outline the speaker and the updated guest list.",
    "Please review the schedule and the current participant list.",
    "I will review the schedule and the current participant list.",
    "We must review the schedule and the current participant list.",
    "The editor will review the schedule and the current participant list.",
    "The editor needs to review the schedule and the current participant list.",
    "Sprawdzę harmonogram i aktualną listę uczestników.",
    "Trzeba sprawdzić harmonogram i aktualną listę uczestników.",
  ])("leaves explicit future, requests, imperative and Polish first-person obligations on the established path: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([expect.objectContaining({ quote: source, task: source, kind: "active" })]);
    expect(model).toHaveBeenCalledTimes(1);
  });

  test.each([
    '"The schedule the participants and the updated attendance list."',
    "‘The schedule the participants and the updated attendance list.’",
    "The schedule the participants and the updated attendance list?",
    "If approved the schedule the participants and the updated attendance list.",
    "The report says the schedule the participants and the updated attendance list.",
    "The schedule reportedly includes the participants and the updated attendance list.",
  ])("does not append coordination classification guidance to quoted, reported, conditional or question contexts: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    await collectSourceEvidence(source, "tasks", "en");
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0]).not.toContain("LITERAL_COORDINATION_REVIEW");
  });

  test("keeps repeated complete quotes distinct at original UTF16 offsets, including an astral prefix", async () => {
    const quote = "The schedule the participants and the updated attendance list.";
    const source = `😀 Source context. ${quote} ${quote}`;
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"},{"id":3,"kind":"active"}]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"uncertain"},{"id":3,"kind":"uncertain"}]}'));
    await collectSourceEvidence(source, "tasks", "en");
    expect(model).toHaveBeenCalledTimes(2);
    const block = model.mock.calls[1][0].match(/LITERAL_COORDINATION_REVIEW_START\n([\s\S]*?)\nLITERAL_COORDINATION_REVIEW_END/u)?.[1];
    expect(block).toBeDefined();
    const rows = block!.split("\n").map((line) => JSON.parse(line) as { id: number; start: number; end: number; quote: string });
    expect(rows.map((row) => row.id)).toEqual([2, 3]);
    expect(rows[0].start).toBe(source.indexOf(quote));
    expect(rows[1].start).toBe(source.lastIndexOf(quote));
    for (const row of rows) expect(source.slice(row.start, row.end)).toBe(row.quote);
  });

  test("rejects an invalid isolated response before publishing evidence or calling the model a third time", async () => {
    const quote = "The schedule the participants and the updated attendance list.";
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
    const review = jest.fn();
    await expect(collectSourceEvidence(quote, "tasks", "en", { onSourceReview: review })).rejects.toThrow("Invalid source task correction");
    expect(model).toHaveBeenCalledTimes(2);
    expect(review).not.toHaveBeenCalled();
  });
});

describe("Polish joined-clause guidance does not change unrelated English retries", () => {
  test.each([
    "This was background discussion about existing material rather than a new assignment to rewrite all the documents in the archive Nora will send the updated guest list to Maya before Wednesday.",
    "This was background discussion about existing material rather than a new assignment to rewrite all the documents in the archive Elliot will send the revised schedule to Jade before Thursday.",
    "This was background discussion about existing records rather than a new assignment to rewrite the catalog Vera will contact the supplier by Friday.",
    "Eliza completed the archiving yesterday and will verify the current cost before Friday.",
    "Eliza will prepare the updated report by Friday.",
  ])("keeps the prior whole-source English retry without Polish coordinated instruction/data: %s", async (source) => {
    model.mockResolvedValueOnce(generated('{"tasks":[]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const evidence = await collectSourceEvidence(source, "tasks", "en");
    expect(evidence).toEqual([expect.objectContaining({ start: 0, end: source.length, quote: source, task: source, kind: "active" })]);
    expect(model).toHaveBeenCalledTimes(2);
    const retry = model.mock.calls[1][0];
    expect(retry).not.toContain("A positive past action does not complete or cancel");
    expect(retry).not.toContain("LITERAL_COORDINATED_CLAUSES");
    expect(retry).toContain("[1] " + source);
    expect(retry).toContain("Neutral background about a different action does not itself make a separate literal commitment tentative.");
  });

  test("keeps the prior Polish single-action retry when no completed-plus-future data exists", async () => {
    const source = "Sprawdzę dostępność sali przed wysłaniem zaproszeń.";
    model.mockResolvedValueOnce(generated('{"tasks":[]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([expect.objectContaining({ quote: source, task: source })]);
    expect(model.mock.calls[1][0]).not.toContain("LITERAL_COORDINATED_CLAUSES");
    expect(model.mock.calls[1][0]).not.toContain("A positive past action does not complete or cancel");
    expect(model).toHaveBeenCalledTimes(2);
  });
});

describe("closed status descriptions do not create duplicate assignments", () => {
  test.each([
    "That work remains to be done.",
    "This task still remains to be completed.",
    "Ta czynność nadal pozostaje do wykonania.",
    "To zadanie pozostaje do zrobienia.",
    "Eliza has not cancelled the schedule assignment.",
    "These notes record current commitments; Eliza has not cancelled the schedule assignment.",
    "Nina has not canceled the report assignment.",
  ])("omits only a complete status statement rather than promoting it to active: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
  });

  test.each([
    "That work remains to be done by Friday and I will send the draft tomorrow.",
    "Eliza has not cancelled the schedule assignment and must send it by Friday.",
    "Ta czynność nadal pozostaje do wykonania i sprawdzę nowy raport jutro.",
    "Wczoraj Alicja obiecała, że wyśle aktualny harmonogram do piątku.",
    "Yesterday Eliza promised that she would send the current schedule by Friday.",
    "Alice finished the draft and promised to send the updated copy by Friday.",
    "Sprawdziłem dokumenty i obiecałem wysłać poprawiony raport jutro.",
  ])("preserves an actual literal obligation and current intention within the whole statement: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
      expect.objectContaining({ quote: source, task: source, kind: "active", start: 0, end: source.length }),
    ]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(isCompletedActionReview({ start: 0, end: source.length, quote: source,
      reason: "Completed source action needs whole-statement review (ID 1)" })).toBe(false);
  });
});

describe("Polish cancellation keeps a separately required current action", () => {
  test.each([
    "Rezerwacja pracowni bursztynowej została anulowana, więc musimy użyć pracowni szafirowej.",
    "Sala została odwołana, ale muszę zarezerwować nowy pokój.",
    "Nie kupujemy aparatu, więc musi sprawdzić obecny mikrofon.",
  ])("repairs a cancelled label without rewriting either literal clause: %s", async (source) => {
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
      expect.objectContaining({ task: source, quote: source, kind: "active" }),
    ]);
    expect(model).toHaveBeenCalledTimes(2);
  });
  test.each([
    "Sala została odwołana, więc nie musimy użyć nowego pokoju.",
    "Sala została odwołana, ale musimy nie kupować nowego sprzętu.",
    "Sala została odwołana, ale jeśli otrzymamy zgodę musimy użyć nowego pokoju.",
  ])("does not turn negated or qualified Polish requirements into active evidence: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
      expect.objectContaining({ task: source, kind: "cancelled" }),
    ]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("past discussion and archive descriptions cannot freeze as affirmative tasks", () => {
  test.each([
    "The group discussed their different purpose purposes, recognizing that a working note and a finished program serve different readers and listeners.",
    "The archive contained earlier descriptions of the colors and shapes of stones.",
    "W archiwum znajdowały się wcześniejsze opisy kolorów i kształtów kamieni.",
    "The group discussed the old drawing and recognized the previous author.",
  ])("omits a closed description or exposes an exact review when the model repeats active: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const review = jest.fn();
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "pl", { onWarning: warning, onSourceReview: review })).resolves.toEqual([]);
    if (model.mock.calls.length === 2) {
      expect(review).toHaveBeenCalledWith(expect.objectContaining({ start: 0, end: source.length, quote: source }));
      expect(warning).toHaveBeenCalledTimes(1);
    } else {
      expect(model).toHaveBeenCalledTimes(1);
      expect(review).not.toHaveBeenCalled();
    }
  });

  test.each([
    "The archive contained earlier descriptions but Nina will prepare the current list by Friday.",
    "The group discussed the background and will review the current report tomorrow.",
    "W archiwum znajdowały się wcześniejsze opisy i przygotuję nowy raport jutro.",
    "Sprawdziłem dokumenty i planuję wysłać poprawiony raport jutro.",
    "Alice finished the old draft and intends to send the updated copy by Friday.",
  ])("keeps current actions and intentions within past background: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([expect.objectContaining({ task: source, kind: "active" })]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(isCompletedActionReview({ start: 0, end: source.length, quote: source,
      reason: "Completed source action needs whole-statement review (ID 1)" })).toBe(false);
  });
});

const model = jest.mocked(generate);
const contextSize = jest.mocked(getContextWindowSize);
const measurePrompt = jest.mocked(measureFormattedPromptTokens);
const generated = (text: string, truncated = false) => ({
  text,
  ttftMs: 1,
  tokensPerSecond: 20,
  wallMs: 2,
  promptMs: 1,
  predictedMs: 1,
  promptTokens: 100,
  predictedTokens: 2,
  completion: {
    status: truncated ? ("stopped_limit" as const) : ("complete" as const),
    truncated,
    stoppedLimit: truncated,
    contextFull: false,
    interrupted: false,
    stoppedEos: !truncated,
    stoppingWord: "",
  },
});
const sourceOf = (prompt: string) =>
  prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];
const factPromptSource = (prompt: string) =>
  sourceOf(prompt).replace(/^\[\d+\] /gmu, "").split("\n").join(" ");
const isFactOutputPlan = (text: string) => /^\s*\{\s*"facts"\s*:/u.test(text);
const checkpointStore = (): ProcessingCheckpointStore => {
  const entries = new Map<string, unknown>();
  return {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, value) => {
      entries.set(key, value);
    },
  };
};

describe("completed source actions remain separate from unfinished commitments", () => {
  const historical = "The speakers resolved it by describing a visible landmark instead of repeating the same name Change was useful because it showed how clarification can happen naturally in a conversation.";

  test("rejects the exact recorded warm ID88 active classification and replays its literal review on resume", async () => {
    const source = [...Array.from({ length: 87 }, (_, index) => `The archived illustration ${index + 1} contains ordinary background material.`), historical].join(" ");
    const raw = '{"tasks":[{"id":88,"kind":"active"}]}';
    model.mockResolvedValue(generated(raw));
    const checkpoint = checkpointStore();
    const reviews: SourceReviewSpan[] = [];
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning, onSourceReview: (span) => reviews.push(span) })).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(2);
    expect(reviews).toEqual([expect.objectContaining({ start: source.indexOf(historical), end: source.length, quote: historical, reason: expect.stringContaining("Completed source action") })]);
    expect(warning).toHaveBeenCalledTimes(1);
    const retry = model.mock.calls[1][0];
    expect(retry).toContain("[88]");
    expect(retry).toContain(historical);
    model.mockClear(); warning.mockClear(); reviews.length = 0;
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning, onSourceReview: (span) => reviews.push(span) })).resolves.toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(reviews[0]?.quote).toBe(historical);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  test.each([
    "The volunteers completed the inventory yesterday.", "Alice finished the draft.",
    "We submitted the application yesterday.", "Zespół zakończył przegląd dokumentów wczoraj.",
    "Przygotowałem raport wczoraj.", "Anna wysłała dokumenty wczoraj.",
    "Will completed the report yesterday.",
  ])("omits only an affirmative closed completed description: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  test.each([
    "Alice will complete the inventory by Friday.", "The report must be completed by Friday.",
    "Alice completed the draft and will send the revised copy by Friday.",
    "Alice completed the draft Bob will send the revised copy by Friday.",
    "The group finished the first interview and must book the next session.",
    "They had not resolved the issue and must call the supplier.",
    "Zespół zakończy przegląd dokumentów do piątku.",
    "Zespół zakończył pierwszy przegląd i musi przygotować kolejne zestawienie.",
    "Sprawdziłem dokumenty i wyślę poprawiony raport do piątku.",
    "Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.",
    "Przegląd musi zostać zakończony do piątku.",
    "Omówiłem wcześniejszy harmonogram ale muszę przygotować nowe zestawienie.",
    "Anna obiecała wysłać nowy raport do piątku.",
    "Alice promised to send the updated report by Friday.",
  ])("preserves the complete source containing an unfinished action: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const evidence = await collectSourceEvidence(source, "tasks", "en");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ kind: "active", quote: source, task: source });
    expect(model).toHaveBeenCalledTimes(1);
  });

  test.each([
    "Nie skończyłem raportu ale muszę wysłać poprawioną wersję jutro.",
    "Nie zakończyłam pierwszego przeglądu ale sprawdzę brakujące dokumenty do piątku.",
    "I did not finish the report but must send the updated version tomorrow.",
  ])("does not let negated completion negate a separate new obligation: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const evidence = await collectSourceEvidence(source, "tasks", "pl");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ kind: "active", quote: source, task: source });
  });

  test.each([
    '"Alice completed the draft yesterday."', "If Alice completed the draft, that was useful.",
    "Alice completed the draft according to the archived report.",
    "Alice completed the draft and it was useful for the discussion.",
    "Anna zakończyła raport, jeśli wierzyć staremu opisowi.",
    "If Alice completed the draft, Bob will send the copy by Friday.",
    '"Alice completed the draft and will send the copy by Friday."',
    "Jeśli Anna zakończyła raport, wyśle poprawioną wersję do piątku.",
    "The volunteers completed the inventory yesterday it needs repair.",
    "Anna zakończyła opis i nie wyśle raportu jutro.",
  ])("keeps unsupported completed scope out of active evidence after one retry: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const reviews: SourceReviewSpan[] = [];
    await expect(collectSourceEvidence(source, "tasks", "en", { onSourceReview: (span) => reviews.push(span) })).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(2);
    expect(reviews[0]?.quote).toBe(source);
  });

  test("revalidates an old active completed-history checkpoint before returning it", async () => {
    const checkpoint = checkpointStore();
    const source = historical;
    await checkpoint.write(`tasks:0:${source.length}`, {
      version: "source-evidence-v15", source, start: 0, end: source.length,
      evidence: [{ id: `tasks:0:${source.length}:0`, start: 0, end: source.length, quote: source, task: source, kind: "active", importance: 2, change: false }],
      warnings: [], unresolved: [],
    });
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint })).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(2);
  });
});
beforeEach(() => {
  model.mockReset();
  contextSize.mockReturnValue(4096);
  measurePrompt.mockReset();
  measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
    Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12,
  );
});

describe("literal unresolved source review callbacks", () => {
  const unresolved = "my will prepare the outline by Thursday.";
  const content = `🧪 These materials provide ordinary context. ${unresolved}`;
  const seedResponse = (): void => {
    model.mockResolvedValueOnce(generated('{"tasks":[]}'));
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
  };

  test.each([false, true])("emits global literal review spans with checkpoint enabled=%s", async (saved) => {
    seedResponse();
    const reviews: SourceReviewSpan[] = [];
    const checkpoint = saved ? checkpointStore() : undefined;
    await collectSourceEvidence(content, "tasks", "en", { checkpoint, onSourceReview: (span) => reviews.push(span) });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ start: content.indexOf(unresolved), end: content.length, quote: unresolved });
    expect(reviews[0].reason.trim()).not.toBe("");
    expect(model).toHaveBeenCalledTimes(2);
    if (checkpoint) {
      model.mockClear();
      const resumed: SourceReviewSpan[] = [];
      await collectSourceEvidence(content, "tasks", "en", { checkpoint, onSourceReview: (span) => resumed.push(span) });
      expect(resumed).toEqual(reviews);
      expect(model).not.toHaveBeenCalled();
    }
  });

  test("propagates review consumer failure without another generation", async () => {
    seedResponse();
    await expect(collectSourceEvidence(content, "tasks", "en", {
      onSourceReview: () => { throw new Error("review consumer failed"); },
    })).rejects.toThrow("review consumer failed");
    expect(model).toHaveBeenCalledTimes(2);
  });

  test("observes cancellation from a review consumer before returning evidence", async () => {
    seedResponse();
    const controller = new AbortController();
    await expect(collectSourceEvidence(content, "tasks", "en", {
      signal: controller.signal, onSourceReview: () => controller.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(model).toHaveBeenCalledTimes(2);
  });

  test("regenerates a checkpoint with a fabricated unresolved source identity", async () => {
    seedResponse();
    const checkpoint = checkpointStore();
    await collectSourceEvidence(content, "tasks", "en", { checkpoint });
    const key = `tasks:0:${content.length}`;
    const value = await checkpoint.read(key) as { unresolved: { id: number; start: number; end: number; reason: string }[] };
    value.unresolved.push({ id: 999, start: 0, end: 2, reason: "fabricated identity" });
    model.mockClear();
    seedResponse();
    const reviews: SourceReviewSpan[] = [];
    await collectSourceEvidence(content, "tasks", "en", { checkpoint, onSourceReview: (span) => reviews.push(span) });
    expect(model).toHaveBeenCalledTimes(2);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].quote).toBe(unresolved);
  });
});

test.each(["someone", "somebody"])("keeps a literal indefinite actor for review without turning it into an active named task: %s", async actor => {
  const source = `${actor} will prepare the inventory list by Thursday.`;
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const onWarning = jest.fn();
  const onSourceReview = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning, onSourceReview });
  expect(evidence).toEqual([]);
  expect(onWarning).toHaveBeenCalled();
  expect(onSourceReview).toHaveBeenCalledWith(expect.objectContaining({ start: 0, end: source.length, quote: source }));
});

test("selects sparse literal fact IDs from a complete large input in one call", async () => {
  const source = "🧪 Final budget 1450. " + "Background example. ".repeat(38) + "Nora will send the guest list by Wednesday.";
  model.mockResolvedValue(generated('{"facts":[1,40]}'));
  const checkpoint = checkpointStore();
  const evidence = await collectSourceEvidence(source, "facts", "en", { checkpoint });
  expect(evidence.map((entry) => entry.quote)).toEqual([
    "🧪 Final budget 1450.",
    "Nora will send the guest list by Wednesday.",
  ]);
  expect(evidence.map(({ start, end }) => [start, end])).toEqual([[0, 21], [782, 825]]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(sourceOf(model.mock.calls[0][0])).toContain("[40] Nora will send the guest list by Wednesday.");
  expect(model.mock.calls[0][2]?.jsonSchema).toMatchObject({
    properties: { facts: { maxItems: 12, items: { type: "integer", enum: Array.from({ length: 40 }, (_, index) => index + 1) } } },
  });
  model.mockClear();
  await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
});

describe("sparse fact source ID extraction", () => {
  test.each(["en", "pl"] as const)("derives complete literal facts from integer IDs in %s", async (language) => {
    const source = '  Żaneta ma 🧪 wynik.\n\nThe label is "C:\\Temp".  ';
    model.mockResolvedValue(generated('{"facts":[2,1]}'));
    const evidence = await collectSourceEvidence(source, "facts", language);
    expect(evidence).toEqual([
      { id: "facts:0:48:1", start: 23, end: 46, quote: 'The label is "C:\\Temp".', kind: "fact", importance: 2 },
      { id: "facts:0:48:0", start: 2, end: 21, quote: "Żaneta ma 🧪 wynik.", kind: "fact", importance: 2 },
    ]);
    expect(sourceOf(model.mock.calls[0][0])).toBe('[1] Żaneta ma 🧪 wynik.\n[2] The label is "C:\\Temp".');
    expect(model.mock.calls[0][2]?.jsonSchema).toMatchObject({
      properties: { facts: { maxItems: 12, items: { type: "integer", enum: [1, 2] } } },
    });
    expect(model).toHaveBeenCalledTimes(1);
  });

  test("deduplicates selected IDs without merging separate identical occurrences", async () => {
    model.mockResolvedValue(generated('{"facts":[3,1,3]}'));
    await expect(collectSourceEvidence("Budget 1450. Review Friday. Budget 1450.", "facts", "en")).resolves.toEqual([
      { id: "facts:0:40:2", start: 28, end: 40, quote: "Budget 1450.", kind: "fact", importance: 2 },
      { id: "facts:0:40:0", start: 0, end: 12, quote: "Budget 1450.", kind: "fact", importance: 2 },
    ]);
    expect(model).toHaveBeenCalledTimes(1);
  });

  test.each([0, -1, 3, 1.5, "1", null, { id: 1, kind: "fact" }])("rejects an invalid sparse fact ID %p without checkpointing", async (id) => {
    model.mockResolvedValue(generated(JSON.stringify({ facts: [id] })));
    const checkpoint = checkpointStore();
    await expect(collectSourceEvidence("Budget 1450. Review Friday.", "facts", "en", { checkpoint })).rejects.toThrow("Invalid source fact selection");
    expect(model).toHaveBeenCalledTimes(2);
    expect(await checkpoint.read("facts:0:27")).toBeNull();
    expect(await checkpoint.read("facts:split:0:27")).toBeNull();
  });

  test("rejects more than twelve selections instead of accepting an unconstrained response", async () => {
    const source = Array.from({ length: 13 }, (_, index) => `Fact ${index}.`).join(" ");
    model.mockResolvedValue(generated(JSON.stringify({ facts: Array.from({ length: 13 }, (_, index) => index + 1) })));
    const checkpoint = checkpointStore();
    await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).rejects.toThrow("Too many source fact selections");
    expect(await checkpoint.read(`facts:0:${source.length}`)).toBeNull();
    expect(model).toHaveBeenCalledTimes(2);
  });

  test("uses the complete input range for pretty integer JSON without planning every sentence as output", async () => {
    const source = Array.from({ length: 100 }, (_, index) => `Statement ${index}.`).join(" ");
    model.mockResolvedValue(generated(JSON.stringify({ facts: [1, 100] }, null, 2)));
    const evidence = await collectSourceEvidence(source, "facts", "en");
    expect(evidence.map((entry) => entry.quote)).toEqual(["Statement 0.", "Statement 99."]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(sourceOf(model.mock.calls[0][0])).toContain("[100] Statement 99.");
    expect(measurePrompt.mock.calls.some(([input]) => isFactOutputPlan(input.userPrompt))).toBe(false);
  });

  test.each(["partial quote", "wrong offset", "wrong identity", "legacy version", "wire IDs"])("regenerates a fact checkpoint with %s", async (corruption) => {
    const source = "🧪 Budget 1450. Review Friday.";
    const checkpoint = checkpointStore();
    model.mockResolvedValue(generated('{"facts":[2]}'));
    const evidence = await collectSourceEvidence(source, "facts", "en", { checkpoint });
    const saved = await checkpoint.read("facts:0:30") as Record<string, unknown>;
    const entry = { ...evidence[0] };
    if (corruption === "partial quote") { entry.quote = "Friday."; entry.start = 23; }
    if (corruption === "wrong offset") entry.start += 1;
    if (corruption === "wrong identity") entry.id = "facts:0:30:0";
    await checkpoint.write("facts:0:30", {
      ...saved,
      ...(corruption === "legacy version" ? { version: "source-evidence-v12" } : {}),
      evidence: corruption === "wire IDs" ? [2] : [entry],
    });
    model.mockClear();
    await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).resolves.toEqual(evidence);
    expect(model).toHaveBeenCalledTimes(1);
  });

  test("keeps a full atomic sentence whose literal quote exceeds the output budget", async () => {
    const source = `The archive description contains ${"x".repeat(2100)}.`;
    model.mockResolvedValue(generated('{"facts":[1]}'));
    await expect(collectSourceEvidence(source, "facts", "en")).resolves.toEqual([
      { id: `facts:0:${source.length}:0`, start: 0, end: source.length, quote: source, kind: "fact", importance: 2 },
    ]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

test("derives a compound task statement from its ID without dropping either actor or deadline", async () => {
  const source =
    "Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek.";
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: [{ id: 1, kind: "active" }],
      }),
    ),
  );
  await expect(extractTasks(source, () => undefined)).resolves.toEqual([
    "Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek.",
  ]);
  expect(model).toHaveBeenCalledTimes(1);
});

test("does not recursively regenerate complete but fabricated evidence", async () => {
  model.mockResolvedValue(
    generated(
      '{"facts":[{"quote":"Invented payment due Friday","kind":"fact"}]}',
    ),
  );
  await expect(
    collectSourceEvidence("First real fact. Second real fact.", "facts", "en"),
  ).rejects.toThrow("Cannot extract complete source evidence");
  expect(model).toHaveBeenCalledTimes(2);
});

test("keeps the same full-range integer schema for one corrective retry", async () => {
  const source = "The production budget is 1450 dollars. The next review is November 8.";
  model.mockResolvedValueOnce(generated('{"facts":[99]}'));
  model.mockResolvedValueOnce(generated('{"facts":[1]}'));
  const evidence = await collectSourceEvidence(source, "facts", "en");
  const schema = model.mock.calls[0][2]?.jsonSchema;
  expect(schema).toMatchObject({ properties: { facts: { items: { enum: [1, 2] } } } });
  expect(model.mock.calls[1][2]?.jsonSchema).toEqual(schema);
  expect(sourceOf(model.mock.calls[1][0])).toBe("[1] The production budget is 1450 dollars.\n[2] The next review is November 8.");
  expect(model).toHaveBeenCalledTimes(2);
  expect(evidence[0]).toMatchObject({ quote: "The production budget is 1450 dollars.", start: 0, end: 38 });
});

test("rejects rewritten source attached to an ID and malformed sparse correction JSON", async () => {
  const source = "The production budget is 1450 dollars. The next review is November 8.";
  model.mockResolvedValueOnce(generated('{"facts":[{"id":1,"quote":"Invented production budget"}]}'));
  model.mockResolvedValueOnce(generated('{"facts":[1]}}'));
  const checkpoint = checkpointStore();
  await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).rejects.toThrow("Cannot extract complete source evidence");
  expect(model).toHaveBeenCalledTimes(2);
  expect(await checkpoint.read(`facts:0:${source.length}`)).toBeNull();
  expect(await checkpoint.read(`facts:split:0:${source.length}`)).toBeNull();
});

const actualV11FatalFactSource = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they show. The difference between a clear story and a collection of unrelated facts the discussion began with the way a familiar place can sound different to different people a regular walker, notices birds and footsteps while a visitor notices the traffic beyond the trees. Both descriptions belong to the same landscape, the earlier examples in the archive contained ordinary observations rather than dramatic events. Their value came from the speakers attention to a small detail in the explanation of. By that detail mattered to them, a photograph of the old railway bridge showed the shape of its supports against a pale sky in another photograph. The river occupied most of the frame, and the bridge appeared only at the edge. The pictures were background material for the conversation, they illustrated how the same subject can receive different emphasis without changing the place itself. The group compared the viewpoints and the language used to describe them. The riverside path contains several. All kinds of surface in the archive recordings footsteps sounded clear on the wooden section soft beside the grass and uneven near loose stones. ";
const actualV11FatalFactQuotes = [
  "The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday.",
  "The opening episode is about the Riverside Park and the old railway Bridge.",
  "The difference between a clear story and a collection of unrelated facts the discussion began with the way a familiar place can sound different to different people a regular walker, notices birds and footsteps while a visitor notices the traffic beyond the trees.",
  "The riverside path contains several.",
  "The examples from last year were useful because they show.",
  "The pictures were background material for the conversation, they illustrated how the same subject can receive different emphasis without changing the place itself.",
  "The group compared the viewpoints and the language used to describe them.",
  "The river occupied most of the frame, and the bridge appeared only at the edge.",
];
const actualV11FatalFactIds = [2, 3, 6, 13, 5, 11, 12, 10];

test.each([
  {
    response: "initial",
    selections: [0, 1, 2, 3, 4, 5, 6, 7, 1, 3, 4, 5, 6, 7],
    spans: [[66, 252], [253, 328], [493, 756], [1453, 1489], [434, 492], [1215, 1378], [1379, 1452], [1135, 1214]],
  },
  {
    response: "correction",
    selections: [0, 1, 6, 3, 4, 2, 5, 7, 1, 3, 4, 2, 5, 7],
    spans: [[66, 252], [253, 328], [1379, 1452], [1453, 1489], [434, 492], [493, 756], [1215, 1378], [1135, 1214]],
  },
])("preserves the eight distinct recorded iPhone v11 $response fact spans through sparse ID selection", async ({ selections, spans }) => {
  // The recorded tokenizer accepted this entire 1635-character fragment;
  // the generic character estimate would split it before the replay.
  measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
    isFactOutputPlan(userPrompt) ? 100 : Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12,
  );
  model.mockResolvedValue(generated(JSON.stringify({
    facts: [...new Set(selections.map((index) => actualV11FatalFactIds[index]))],
  })));
  const evidence = await collectSourceEvidence(actualV11FatalFactSource, "facts", "en");
  expect(evidence.map(({ start, end }) => [start, end])).toEqual(spans);
  expect(evidence.map(({ id }) => id)).toEqual(selections.slice(0, 8).map((index) => `facts:0:1635:${actualV11FatalFactIds[index] - 1}`));
  expect(evidence.map(({ quote }) => quote)).toEqual(selections.slice(0, 8).map((index) => actualV11FatalFactQuotes[index]));
  for (const entry of evidence) {
    expect(actualV11FatalFactSource.slice(entry.start, entry.end)).toBe(entry.quote);
    expect(entry).toMatchObject({ kind: "fact", importance: 2 });
  }
  expect(model).toHaveBeenCalledTimes(1);
});

test("preserves separate source occurrences even when their literal text is identical", async () => {
  model.mockResolvedValue(generated('{"facts":[1,2,3]}'));
  await expect(collectSourceEvidence("Budget 1450. Review Friday. Budget 1450.", "facts", "en")).resolves.toEqual([
    { id: "facts:0:40:0", start: 0, end: 12, quote: "Budget 1450.", kind: "fact", importance: 2 },
    { id: "facts:0:40:1", start: 13, end: 27, quote: "Review Friday.", kind: "fact", importance: 2 },
    { id: "facts:0:40:2", start: 28, end: 40, quote: "Budget 1450.", kind: "fact", importance: 2 },
  ]);
});

test("validates unknown IDs after a harmless sparse duplicate", async () => {
  model.mockResolvedValue(generated('{"facts":[1,1,2]}'));
  const checkpoint = checkpointStore();
  await expect(collectSourceEvidence("Budget 1450.", "facts", "en", { checkpoint })).rejects.toThrow("Invalid source fact selection");
  expect(model).toHaveBeenCalledTimes(2);
  expect(await checkpoint.read("facts:0:12")).toBeNull();
});

test("resumes deduplicated complete records with stable global UTF16 spans", async () => {
  const source = "🧪 Budget 1450. Review Friday. Budget 1450.";
  model.mockResolvedValue(generated('{"facts":[1,2,3,3,2]}'));
  const checkpoint = checkpointStore();
  const expected = [
    { id: "facts:0:43:0", start: 0, end: 15, quote: "🧪 Budget 1450.", kind: "fact", importance: 2 },
    { id: "facts:0:43:1", start: 16, end: 30, quote: "Review Friday.", kind: "fact", importance: 2 },
    { id: "facts:0:43:2", start: 31, end: 43, quote: "Budget 1450.", kind: "fact", importance: 2 },
  ];
  await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).resolves.toEqual(expected);
  const saved = await checkpoint.read("facts:0:43") as { evidence: SourceEvidence[] };
  expect(saved.evidence).toEqual(expected);
  model.mockClear();
  await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).resolves.toEqual(expected);
  expect(model).not.toHaveBeenCalled();
});

test("regenerates a fact checkpoint containing excess duplicate anchors", async () => {
  model.mockResolvedValue(generated('{"facts":[1]}'));
  const checkpoint = checkpointStore();
  const evidence = await collectSourceEvidence("Budget 1450.", "facts", "en", { checkpoint });
  const key = "facts:0:12";
  const stored = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...stored, evidence: [...evidence, { ...evidence[0], id: "facts:0:12:1" }] });
  model.mockClear();
  await expect(collectSourceEvidence("Budget 1450.", "facts", "en", { checkpoint })).resolves.toEqual(evidence);
  expect(model).toHaveBeenCalledTimes(1);
});

test("rejects a task text added to a source ID instead of discarding its conflicting meaning", async () => {
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: [
          {
            id: 1,
            task: "Bob will send the report by Friday.",
            kind: "active",
          },
        ],
      }),
    ),
  );
  await expect(
    collectSourceEvidence(
      "Alice will send the report by Friday.",
      "tasks",
      "en",
    ),
  ).rejects.toThrow("Cannot extract complete source evidence");
  expect(model).toHaveBeenCalledTimes(2);
});

test("retains an exact unpunctuated Unicode action with its source positions", async () => {
  const source = "  Żaneta wyśle 🧪 raport do jutra  ";
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
    {
      id: "tasks:0:35:0",
      start: 2,
      end: 33,
      quote: "Żaneta wyśle 🧪 raport do jutra",
      task: "Żaneta wyśle 🧪 raport do jutra",
      kind: "active",
      importance: 2,
      change: false,
    },
  ]);
});

test("warns and omits a persistently incorrect active label on an explicitly negated action", async () => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(
    collectSourceEvidence("We will not buy new equipment.", "tasks", "en", {
      onWarning: warning,
    }),
  ).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toContain(
    "Negated source action cannot be active",
  );
  expect(warning).toHaveBeenCalledTimes(1);
});

test("repairs a negated task classification once without changing its source quotation", async () => {
  model.mockResolvedValueOnce(
    generated('{"tasks":[{"id":1,"kind":"active"}]}'),
  );
  model.mockResolvedValueOnce(
    generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'),
  );
  const evidence = await collectSourceEvidence(
    "Nie zamówię drukarki.",
    "tasks",
    "pl",
  );
  expect(evidence).toEqual([
    {
      id: "tasks:0:21:0",
      start: 0,
      end: 21,
      quote: "Nie zamówię drukarki.",
      task: "Nie zamówię drukarki.",
      kind: "cancelled",
      importance: 2,
      change: false,
    },
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toContain(
    "Negated source action cannot be active",
  );
});

test.each([
  ["The next meeting is on Monday.", "en" as const],
  ["Spotkanie grupy odbędzie się w czwartek.", "pl" as const],
  ["Spotkanie organizacyjne odbędzie się 23 listopada o 15 45", "pl" as const],
  ["Spotkanie organizacyjne odbędzie się 23 listopada o 15:45.", "pl" as const],
  ["The planning meeting is on November 23 at 15 45", "en" as const],
  ["The equipment delivery date changed from Monday to Wednesday.", "en" as const],
  ["The package delivery date moved to Friday.", "en" as const],
  ["The delivery time has shifted from Monday to Tuesday.", "en" as const],
])(
  "locally omits a complete descriptive calendar statement without a corrective generation: %s",
  async (source, language) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const warning = jest.fn();
    await expect(
      collectSourceEvidence(source, "tasks", language, { onWarning: warning }),
    ).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  },
);

test.each([
  "Attend the meeting on Monday.",
  "The meeting will take place on Monday, and Maya will bring the report.",
])("retains an affirmative action involving a meeting: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
    source,
  ]);
});

const actualV9CalendarTopics =
  "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review";
const actualV9MalformedAction =
  "The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday.";
const actualV9FullSource = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts. Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running. Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review";

test("replays actual v9 task IDs with one shared correction, excludes calendar topics and persists the unresolved ASR actor", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":6,"kind":"active"},{"id":19,"kind":"active"},{"id":26,"kind":"cancelled"},{"id":27,"kind":"active"},{"id":28,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"uncertain"},{"id":26,"kind":"active"}]}'));
  const warning = jest.fn();
  const checkpoint = checkpointStore();
  const evidence = await collectSourceEvidence(actualV9FullSource, "tasks", "en", { onWarning: warning, checkpoint });
  expect(evidence.map((entry) => entry.quote)).toEqual([
    "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person.",
    "The north studio reservation was canceled so we must use the south studio for the recording.",
    "We will use the microphones that we already have and we must not buy any new cameras.",
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[2] ${actualV9MalformedAction}\n[26] The north studio reservation was canceled so we must use the south studio for the recording.`);
  expect(model.mock.calls[1][0]).not.toContain("Maya");
  expect(model.mock.calls[1][0]).not.toContain("topics for that review");
  for (const entry of evidence) expect(actualV9FullSource.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(actualV9FullSource, "tasks", "en", { onWarning: warning, checkpoint })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each(["active", "uncertain", "cancelled", "missing", "invalid_actor"])("keeps an unresolved source actor warning after a bounded malformed-action correction: %s", async (correction) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  const tasks = correction === "missing" ? [] : [{
    id: 1,
    kind: correction === "invalid_actor" ? "active" : correction,
    ...(correction === "invalid_actor" ? { actor: "Maya" } : {}),
  }];
  model.mockResolvedValueOnce(generated(JSON.stringify({ tasks })));
  const warning = jest.fn();
  const checkpoint = checkpointStore();
  await expect(collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { onWarning: warning, checkpoint })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[1] ${actualV9MalformedAction}`);
  expect(model.mock.calls[1][0]).toContain("unresolved subject");
  expect(model.mock.calls[1][0]).not.toContain("Maya");
  expect(warning).toHaveBeenCalledTimes(1);
  const stored = await checkpoint.read(`tasks:0:${actualV9MalformedAction.length}`) as {
    evidence: SourceEvidence[]; unresolved: { id: number; start: number; end: number }[]; warnings: string[];
  };
  expect(stored.evidence).toEqual([]);
  expect(stored.unresolved).toEqual([expect.objectContaining({ id: 1, start: 0, end: actualV9MalformedAction.length })]);
  expect(stored.warnings).toHaveLength(1);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { onWarning: warning, checkpoint })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each(["active", "uncertain", "cancelled"])("reviews a first-pass %s malformed owner without promoting it to an action", async (kind) => {
  model.mockResolvedValue(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each(["my", "your", "our", "his", "her", "their", "its"])("requests review only for a literal malformed possessive actor: %s", async (owner) => {
  const source = `The podcast description ends here ${owner} will prepare the first episode outline by Thursday.`;
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("retains a valid unrelated actor while an ASR-merged actor stays unresolved", async () => {
  const source = `${actualV9MalformedAction} Nora will send the updated guest list to Maya before Wednesday.`;
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: "Nora will send the updated guest list to Maya before Wednesday.", kind: "active", start: actualV9MalformedAction.length + 1 }),
  ]);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[1] ${actualV9MalformedAction}`);
  expect(model.mock.calls[1][0]).not.toContain("Maya");
  expect(warning).toHaveBeenCalledTimes(1);
});

test("does not checkpoint a malformed-subject correction cancelled by its signal", async () => {
  const controller = new AbortController();
  const checkpoint = checkpointStore();
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockImplementationOnce(async () => {
    controller.abort();
    return generated('{"tasks":[{"id":1,"kind":"active"}]}');
  });
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { checkpoint, signal: controller.signal, onWarning: warning })).rejects.toMatchObject({ name: "AbortError" });
  expect(model).toHaveBeenCalledTimes(2);
  expect(await checkpoint.read(`tasks:0:${actualV9MalformedAction.length}`)).toBeNull();
  expect(warning).not.toHaveBeenCalled();
});

test("does not restore an unresolved source actor as clean when both warning and issue metadata are removed", async () => {
  const checkpoint = checkpointStore();
  const key = `tasks:0:${actualV9MalformedAction.length}`;
  model.mockResolvedValue(generated('{"tasks":[]}'));
  await collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { checkpoint });
  const saved = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, warnings: [], unresolved: [] });
  model.mockClear();
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV9MalformedAction, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  const restored = await checkpoint.read(key) as { unresolved: { id: number }[] };
  expect(restored.unresolved.map((issue) => issue.id)).toEqual([1]);
});

test.each([
  'Alice said "my will prepare the outline by Thursday".',
  "Alice recalled that my will prepare the outline by Thursday.",
  "The previous policy was my will prepare the outline by Thursday.",
  "If agreed my will prepare the outline by Thursday.",
  "The description includes my will prepare the outline by Thursday unless Alice objects.",
  "Alice asked whether my will prepare the outline by Thursday.",
  "The description includes my will prepare the outline by Thursday?",
  "The description includes my will not prepare the outline by Thursday.",
  "The description includes my will never prepare the outline by Thursday.",
  "The description includes my will prepare nothing by Thursday.",
  "The description includes my will prepare neither outline by Thursday.",
  "The description includes nobody will prepare the outline by Thursday.",
  "The description includes my might prepare the outline by Thursday.",
  "The description includes my prepared the outline by Thursday.",
  "My will is strong before Thursday.",
  "The description includes my will discuss the outline by Thursday.",
  "The description includes my will prepare the outline.",
  "The description includes my will prepare the outline by Thursday and Bob might inspect it.",
  "The description includes my will prepare the outline that Bob will send by Thursday.",
  "Last year my will prepare the outline by Thursday.",
  "Yesterday my will prepare the outline by Thursday.",
  "Years ago my will prepare the outline by Thursday.",
  "The earlier discussion included my will prepare the outline by Thursday.",
  "The previous meeting recorded my will prepare the outline by Thursday.",
  "Alice wrote that my will prepare the outline by Thursday.",
  "The instruction reads my will prepare the outline by Thursday.",
])("does not mandate malformed-subject review outside the closed unfinished-action candidate: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each(["Maya", "Nora", "I", "We", "You", "He", "She", "They"])("retains an actual directly stated owner without the malformed-subject warning: %s", async (owner) => {
  const source = `${owner} will prepare the first episode outline by Thursday.`;
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  actualV9CalendarTopics,
  `${actualV9CalendarTopics}.`,
  "The next editorial review is on November 8 at two in the afternoon.",
  "The next review is on November eighth at two in the afternoon.",
  "The next planning review is scheduled for November twenty-first at eleven in the morning.",
  "The meeting will take place on November 8 at 2:00 in the afternoon.",
  "The appointment is on November 8 at twelve pm.",
  "The next meeting is on Monday at six in the evening the report and the revised schedule are the topics for that meeting.",
  "The next editorial review is on November 8 at two in the afternoon the episode outline, the speaker reply, and the updated guest list are the topics for that review.",
])("omits a closed descriptive review/date/topic statement without treating it as attendance: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  const checkpoint = checkpointStore();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning, checkpoint })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(sourceOf(model.mock.calls[0][0])).toBe(`[1] ${source}`);
  expect(warning).not.toHaveBeenCalled();
  model.mockClear();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning, checkpoint })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  "Attend the next editorial review on November 8 at two in the afternoon.",
  "We will attend the next editorial review on November 8 at two in the afternoon.",
  "The next editorial review is on November 8 at two in the afternoon and Maya will send the report.",
  "The next editorial review is on November 8 at two in the afternoon when Maya will send the report.",
  `${actualV9CalendarTopics} and Maya will send the report by Thursday.`,
  `${actualV9CalendarTopics} please attend the review.`,
  `${actualV9CalendarTopics} we must attend the review.`,
  `${actualV9CalendarTopics} Daniel should prepare the draft.`,
  "The next editorial review is on November 8 at two in the afternoon the report that Maya will send and the guest list are the topics for that review.",
])("retains whole literal attendance or action clauses adjacent to review topics: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence).toEqual([expect.objectContaining({ quote: source, task: source, kind: "active", start: 0, end: source.length })]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  { source: `${actualV9CalendarTopics}?`, kind: "uncertain" },
  { source: `If we agree ${actualV9CalendarTopics.toLowerCase()}`, kind: "uncertain" },
  { source: `Alice asked whether ${actualV9CalendarTopics.toLowerCase()}`, kind: "uncertain" },
  { source: `Alice said "${actualV9CalendarTopics}"`, kind: "uncertain" },
  { source: `‘${actualV9CalendarTopics}’`, kind: "uncertain" },
  { source: "The previous editorial review was on November 8 at two in the afternoon.", kind: "uncertain" },
  { source: "The next editorial review is not on November 8 at two in the afternoon.", kind: "cancelled" },
  { source: `${actualV9CalendarTopics} but we must not attend it.`, kind: "cancelled" },
])("does not infer a clean calendar omission from quoted, conditional, historical or negated text: $source", async ({ source, kind }) => {
  model.mockResolvedValue(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, kind, start: 0, end: source.length }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test("locally resolves a descriptive amount misclassified as cancelled without a warning", async () => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
  const warning = jest.fn();
  await expect(
    collectSourceEvidence(
      "The final allowance is 80 instead of 60.",
      "tasks",
      "en",
      { onWarning: warning },
    ),
  ).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test("repairs a mixed cancellation and new obligation without losing the affirmative action", async () => {
  const source =
    "The old order was cancelled, so we must prepare the replacement.";
  model.mockResolvedValueOnce(
    generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'),
  );
  model.mockResolvedValueOnce(
    generated('{"tasks":[{"id":1,"kind":"active"}]}'),
  );
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
    source,
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toContain(
    "Cancelled statement contains a new affirmative obligation",
  );
});

const physicalEnglishAsrSource =
  "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was $1200. Correction, the final approved budget is $1750. This final amount replaces the earlier budget. The red room reservation was canceled so we must use the green room for the workshop. We will use the equipment that we already have and we must not buy any new hardware. The next planning meeting is on October 12 the 10 in the morning. The workshop materials, the suppliers reply, and the updated schedule are the topics for that meeting";

// Exact 421-word source and complete first task response from the controlled
// Riverside Qwen replay. The model omitted ID 29 instead of misclassifying it.
const riversideSource = [
  "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places, everyday experiences, and the people who live in the neighbourhood. Maya will prepare the first episode outline by Thursday. The opening episode is about the riverside park and the old railway bridge. We discussed the atmosphere of the programme and the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts.",
  "Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking routes near the river, and the names of the older streets. Those topics were examples of possible conversation subjects, rather than a final running order. The programme is intended for residents with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates.",
  "The original production budget was 900 dollars. This amount appeared in the early draft of the project plan. The old draft also contained a description of a larger camera setup, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound and a conversation that listeners can follow easily.",
  "Nora will send the updated guest list to Maya before Wednesday. The list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were already available in the archive. The discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed, and its results were included in the background documents.",
  "Correction, the final approved production budget is 1450 dollars. This final amount replaces the earlier budget of 900 dollars. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at 2 in the afternoon. The episode outline, the speaker reply, and the updated guest list are the topics for that review.",
].join("\n\n");
const riversideFirstTasks =
  '{"tasks":[{"id":3,"kind":"active"},{"id":7,"kind":"active"},{"id":21,"kind":"active"}]}';
const riversideRoomTask =
  "The north studio reservation was canceled so we must use the south studio for the recording.";
const riversideValidatedTasks = [
  "Maya will prepare the first episode outline by Thursday.",
  "Daniel will contact the guest speaker by Tuesday.",
  "Nora will send the updated guest list to Maya before Wednesday.",
];

test("repairs only the omitted Riverside obligation through one model correction", async () => {
  model.mockResolvedValueOnce(generated(riversideFirstTasks));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":29,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(riversideSource, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([...riversideValidatedTasks, riversideRoomTask]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[29] ${riversideRoomTask}`);
  expect(model.mock.calls[1][0]).toContain(
    "Cancelled statement contains a new affirmative obligation (ID 29); preserve the required new action as active",
  );
  expect(model.mock.calls[1][2]?.jsonSchema).toMatchObject({
    properties: { tasks: { items: { properties: { id: { enum: [29] } } } } },
  });
  expect(warning).not.toHaveBeenCalled();
  for (const entry of evidence) expect(riversideSource.slice(entry.start, entry.end)).toBe(entry.quote);
});

test.each([
  '{"tasks":[]}',
  '{"tasks":[{"id":29,"kind":"uncertain"}]}',
  '{"tasks":[{"id":29,"kind":"cancelled"}]}',
  '{"tasks":[{"id":3,"kind":"cancelled"}]}',
  '{"tasks":[{"id":29,"kind":"active"},{"id":3,"kind":"cancelled"}]}',
])("persists a failed omitted-ID repair without losing validated tasks: %s", async (correction) => {
  model.mockResolvedValueOnce(generated(riversideFirstTasks));
  model.mockResolvedValueOnce(generated(correction));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(riversideSource, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual(riversideValidatedTasks);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  const saved = await checkpoint.read(`tasks:0:${riversideSource.length}`) as { unresolved: { id: number; start: number; end: number }[] };
  expect(saved.unresolved).toEqual([
    expect.objectContaining({ id: 29, start: riversideSource.indexOf(riversideRoomTask), end: riversideSource.indexOf(riversideRoomTask) + riversideRoomTask.length }),
  ]);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(riversideSource, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("reviews a first-pass uncertain direct replacement instead of silently omitting it", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(riversideRoomTask, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: riversideRoomTask, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

const ownedRequiredTask = "Nora will send the updated guest list to Maya before Wednesday.";
test.each(["omitted", "uncertain"])("reviews a directly owned deadline action initially %s without adding it locally", async (initial) => {
  const source = `Maya will prepare the outline by Thursday. ${ownedRequiredTask}`;
  model.mockResolvedValueOnce(generated(JSON.stringify({
    tasks: [{ id: 1, kind: "active" }, ...(initial === "uncertain" ? [{ id: 2, kind: "uncertain" }] : [])],
  })));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual(["Maya will prepare the outline by Thursday.", ownedRequiredTask]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[2] ${ownedRequiredTask}`);
  expect(warning).not.toHaveBeenCalled();
});

test.each(["uncertain", "cancelled", "omit"])("keeps a durable unresolved owned obligation after a corrective %s decision", async (kind) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  await expect(collectSourceEvidence(ownedRequiredTask, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  const saved = await checkpoint.read(`tasks:0:${ownedRequiredTask.length}`) as { unresolved: { id: number }[] };
  expect(saved.unresolved.map((issue) => issue.id)).toEqual([1]);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(ownedRequiredTask, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each([
  "Alice will contact the supplier by next Tuesday.",
  "Ada will submit the invoice by November 8 at 14:30.",
  "Maya and Daniel will finish the draft by 2026-11-08.",
  "I will check the stock before 08/11/2026.",
  "Noelle will send the guest list before Wednesday.",
  "Nobuko will submit the draft by Friday.",
  "Nonna will contact the guest speaker by Tuesday.",
])("reviews a closed omitted owner, action and explicit deadline: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind: "active", start: 0, end: source.length }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "Ada Lovelace will submit the invoice by November 8 at 14:30.",
  "Nobuko Mori will submit the draft by Friday.",
])("leaves omitted multiword owners to the model instead of claiming closed completeness proof: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each(["active", "uncertain"])("preserves the model's %s decision for a genuine multiword owner", async (kind) => {
  const source = "Ada Lovelace will submit the invoice by Friday.";
  model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "Nora will send the updated guest list.",
  "Nora will send the updated guest list before Wednesday if Alice agrees.",
  "If Alice agrees Nora will send the updated guest list before Wednesday.",
  "Nora will send the updated guest list before Wednesday unless Alice objects.",
  "Nora will send the updated guest list before Wednesday?",
  "Alice asked whether Nora will send the updated guest list before Wednesday.",
  "Alice said Nora will send the updated guest list before Wednesday.",
  "Nora recalled that she will send the updated guest list before Wednesday.",
  "‘Nora will send the updated guest list before Wednesday’ was the old rule.",
  "The previous policy was that Nora will send the updated guest list before Wednesday.",
  "Last Friday Nora will send the updated guest list before Wednesday.",
  "On Friday Nora will send the updated guest list before Wednesday.",
  "After Friday Nora will send the updated guest list before Wednesday.",
  "Yesterday Nora will send the updated guest list before Wednesday.",
  "Nora will have sent the updated guest list before Wednesday.",
  "Nora will not send the updated guest list before Wednesday.",
  "Nora will never send the updated guest list before Wednesday.",
  "Nora would send the updated guest list before Wednesday.",
  "Nora will keep the current guest list before Wednesday.",
  "The report will be ready before Wednesday.",
  "The meeting will finish before Wednesday.",
  "Nora who joined the team will send the guest list before Wednesday.",
  "Nora will prepare a draft that Alice will send before Wednesday.",
  "Nora will send the guest list and Alice might update it before Wednesday.",
  "Nora will discuss the guest list before Wednesday.",
  "Nobody will contact the guest speaker by Tuesday.",
  "Nothing will prepare the episode outline by Thursday.",
  "No One will send the list before Wednesday.",
  "Noone will send the list before Wednesday.",
  "None will send the list before Wednesday.",
  "Neither Alice will send the list before Wednesday.",
  "Nobody Else will contact the guest speaker by Tuesday.",
  "nobody will contact the guest speaker by Tuesday.",
  "nobody else will contact the guest speaker by Tuesday.",
  "Alice will send nothing by Friday.",
  "Alice will submit neither draft by Friday.",
  "Alice will send none by Friday.",
  "Alice will contact nobody by Friday.",
  "Alice will contact noone by Friday.",
  "Alice will contact no one by Friday.",
  "Maybe Alice will contact the guest speaker by Tuesday.",
  "Perhaps Alice will contact the guest speaker by Tuesday.",
  "Suppose Alice will contact the guest speaker by Tuesday.",
  "Imagine Alice will contact the guest speaker by Tuesday.",
  "Hopefully Alice will contact the guest speaker by Tuesday.",
  "Possibly Alice will contact the guest speaker by Tuesday.",
  "Likely Alice will contact the guest speaker by Tuesday.",
  "Who will contact the guest speaker by Tuesday",
  "What will prepare the episode outline by Thursday",
])("does not mandate an omitted assignment outside the closed direct-action grammar: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test("does not checkpoint or promote the omitted obligation when its correction is aborted", async () => {
  const controller = new AbortController();
  const checkpoint = checkpointStore();
  model.mockResolvedValueOnce(generated(riversideFirstTasks));
  model.mockImplementationOnce(async () => {
    controller.abort();
    return generated('{"tasks":[{"id":29,"kind":"active"}]}');
  });
  const warning = jest.fn();
  await expect(collectSourceEvidence(riversideSource, "tasks", "en", { checkpoint, signal: controller.signal, onWarning: warning })).rejects.toMatchObject({ name: "AbortError" });
  expect(model).toHaveBeenCalledTimes(2);
  expect(await checkpoint.read(`tasks:0:${riversideSource.length}`)).toBeNull();
  expect(warning).not.toHaveBeenCalled();
});

test("validates every first-pass selection before recovering an omitted source ID", async () => {
  model.mockResolvedValue(generated('{"tasks":[{"id":3,"kind":"active"},{"id":999,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(riversideSource, "tasks", "en", { onWarning: warning })).rejects.toThrow("Invalid source task selection");
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toContain("Previous response was rejected");
  expect(model.mock.calls[1][0]).not.toContain("Repair only the rejected source IDs");
  expect(warning).not.toHaveBeenCalled();
});

test("repairs selected semantic errors and omitted obligations in the same bounded scope", async () => {
  const source = "Maya will send the outline. Daniel will not buy a camera. The reservation was canceled so we must use the south studio.";
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"cancelled"},{"id":3,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => ({ quote: entry.quote, kind: entry.kind }))).toEqual([
    { quote: "Maya will send the outline.", kind: "active" },
    { quote: "Daniel will not buy a camera.", kind: "cancelled" },
    { quote: "The reservation was canceled so we must use the south studio.", kind: "active" },
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe("[2] Daniel will not buy a camera.\n[3] The reservation was canceled so we must use the south studio.");
  expect(warning).not.toHaveBeenCalled();
});

test("repairs two omitted whole statements without rediscovering them in the corrective subset", async () => {
  const source = "The order was canceled so Nora needs to prepare a replacement. Rezerwacja została anulowana więc należy użyć sali zielonej.";
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"},{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.quote)).toEqual([
    "The order was canceled so Nora needs to prepare a replacement.",
    "Rezerwacja została anulowana więc należy użyć sali zielonej.",
  ]);
  expect(evidence.every((entry) => entry.kind === "active")).toBe(true);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "The reservation was canceled.",
  "The reservation was canceled so we must not use the green room.",
  "The reservation was canceled so we must never use the green room.",
  "The reservation was canceled so we no longer have to use the green room.",
  "The reservation was canceled so we do not need to use the green room.",
  "The reservation was canceled so we must use the green room?",
  "The reservation was canceled so if Alice agrees we must use the green room.",
  "The reservation was canceled so we must use the green room unless Alice objects.",
  "The reservation was canceled so Alice asked whether we must use the green room.",
  "The reservation was canceled so Alice said we must use the green room.",
  "The reservation was canceled so Alice recalled that we must use the green room.",
  "The reservation was canceled so ‘we must use the green room’ was the old rule.",
  "The old rule was that the reservation was canceled so we must use the green room.",
  "The reservation was canceled so we must have used the green room.",
  "Rezerwacja została anulowana więc nie należy użyć sali zielonej.",
  "Rezerwacja została anulowana więc jeśli Anna się zgodzi trzeba użyć sali zielonej.",
  "Rezerwacja została anulowana więc Anna wspomniała że należy użyć sali zielonej.",
])("does not promote an omitted cancelled, negated, conditional, reported or historical statement: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  {
    condition: "cold",
    raw: '{"tasks":[{"id":2,"kind":"active"},{"id":3,"kind":"active"},{"id":4,"kind":"active"},{"id":8,"kind":"cancelled"},{"id":9,"kind":"uncertain"}]}',
    equipmentKind: "uncertain",
  },
  {
    condition: "warm",
    raw: '{"tasks":[{"id":2,"kind":"active"},{"id":3,"kind":"active"},{"id":4,"kind":"active"},{"id":8,"kind":"cancelled"},{"id":9,"kind":"active"},{"id":10,"kind":"uncertain"},{"id":11,"kind":"uncertain"}]}',
    equipmentKind: "active",
  },
])("repairs only the mixed room obligation in the physical $condition ASR response", async ({ raw, equipmentKind }) => {
  model.mockResolvedValueOnce(generated(raw));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":8,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(physicalEnglishAsrSource, "tasks", "en", { onWarning: warning });
  expect(evidence.find((entry) => entry.start === 336)).toMatchObject({
    kind: "active",
    quote: "The red room reservation was canceled so we must use the green room for the workshop.",
  });
  expect(evidence.find((entry) => entry.start === 422)).toMatchObject({
    kind: equipmentKind,
    quote: "We will use the equipment that we already have and we must not buy any new hardware.",
  });
  expect(evidence.filter((entry) => entry.start < 210).map((entry) => entry.task)).toEqual([
    "Alice will prepare the workshop materials by Friday.",
    "Bob will contact the supplier by Tuesday.",
    "Emma will send the updated schedule to Alice before Wednesday.",
  ]);
  expect(sourceOf(model.mock.calls[1][0])).toBe("[8] The red room reservation was canceled so we must use the green room for the workshop.");
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
  for (const entry of evidence) expect(physicalEnglishAsrSource.slice(entry.start, entry.end)).toBe(entry.quote);
});

test.each([
  ["en", "The old order was canceled so we must prepare the replacement."],
  ["en", "The old order was cancelled, so we must prepare the replacement."],
  ["en", "The old order was cancelled and Nora needs to prepare the replacement."],
  ["en", "The old order was cancelled; therefore we have to prepare the replacement."],
  ["en", "The old room and the earlier order were canceled so we must arrange a replacement."],
  ["pl", "Rezerwacja sali została anulowana więc należy użyć sali zielonej."],
  ["pl", "Rezerwacja sali została odwołana, zatem trzeba użyć sali zielonej."],
  ["pl", "Poprzednie zamówienie anulowano ale Nora powinna przygotować nowe."],
] as const)("repairs an affirmative obligation after cancellation independent of punctuation: %s %s", async (language, source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", language, { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind: "active", start: 0, end: source.length }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "The reservation was canceled so we must not use the green room.",
  "The reservation was canceled, so we must not use the green room.",
  "The reservation was canceled, so we must never use the green room.",
  "The reservation was canceled so we do not have to book another room.",
  "The reservation was canceled so we no longer have to use the green room.",
  "The reservation was canceled so we need not use the green room.",
  "The reservation was canceled so we do not need to use the green room.",
  "The reservation was canceled so we don’t have to use the green room.",
  "The reservation was canceled so Alice doesn’t have to use the green room.",
  "The reservation was canceled so we didn't need to use the green room.",
  "The reservation was canceled so nobody needs to use the green room.",
  "The reservation was canceled so we have no need to use the green room.",
  "The reservation was canceled, so we must use another room?",
  "The reservation was canceled so Alice asked whether we must use the green room.",
  "The reservation was canceled, so if Alice agrees we must use another room.",
  "The reservation was canceled, so we must use another room unless Alice objects.",
  "The reservation was canceled, so we must use another room only if Alice agrees.",
  "Rezerwacja została anulowana więc nie należy użyć sali zielonej.",
  "Rezerwacja została anulowana, więc trzeba nie używać sali zielonej.",
  "Rezerwacja została anulowana, więc jeśli Anna się zgodzi trzeba użyć sali zielonej.",
  "Rezerwacja została anulowana więc należy użyć sali zielonej chyba że Anna się nie zgodzi.",
  "Rezerwacja została anulowana, więc należy użyć sali zielonej?",
  "Rezerwacja została anulowana więc Anna zapytała czy należy użyć sali zielonej.",
])("does not force a negated, conditional or questioned replacement into an affirmative task: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind: "cancelled" }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "We will use the equipment that we already have and we must not buy any new hardware.",
  "Alice will prepare the materials and Bob must not buy new hardware.",
  "Nora will inspect the shelves but Alice should not order new parts.",
  "We will use the old equipment and Alice and Bob must not buy new hardware.",
])("does not negate an earlier affirmative main action using a later coordinated prohibition: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "We will not use the equipment and we must not buy new hardware.",
  "We will no longer use the equipment and we must not buy new hardware.",
  "We will neither use the equipment nor buy supplies and we must not buy new hardware.",
  "Alice and Bob must not buy any hardware.",
  "Alice and Will must not buy any hardware.",
  "Alice and Will and Bob must not buy hardware and Nora must not order parts.",
  "The parcel that Alice will send must not contain batteries.",
  "The equipment that Alice and Bob must not buy is unavailable.",
  "We must not buy hardware.",
  "Do not use the red room.",
  "Nie używać sali czerwonej.",
])("still rejects a genuine main negation as active: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

const partiallyInvalidTaskSource =
  "Nora will send the invoice by Friday. Olga will pay 80 by Friday. Ian will test the microphone on Tuesday.";
const partiallyInvalidTasks = generated(
  '{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"cancelled"},{"id":3,"kind":"active"}]}',
);

// Exact task generations from both complete build-2 iPhone runs. The second
// response changed a valid green-room action while failing to repair ID 11.
const iphoneTaskSource =
  "Notatka ze spotkania zespołu biblioteki. Rozmawialiśmy o jesiennych warsztatach, rezerwacji sal i poprawie informacji dla czytelników. Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek. Budżet pierwszych warsztatów wynosi 1200 złotych. Nie zamówimy nowych laptopów, ponieważ obecny sprzęt wystarczy. Spotkanie podsumowujące odbędzie się 12 października o godzinie 10:00. Nie ustaliliśmy jeszcze liczby uczestników. Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.\n\nNa zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.";
const iphoneFirstTaskResponse =
  '{"tasks":[{"id":3,"kind":"active"},{"id":8,"kind":"active"},{"id":9,"kind":"active"},{"id":10,"kind":"active"},{"id":11,"kind":"cancelled"}]}';
const iphoneRegressiveTaskResponse =
  '{"tasks":[{"id":3,"kind":"active"},{"id":8,"kind":"active"},{"id":9,"kind":"active"},{"id":10,"kind":"cancelled"},{"id":11,"kind":"cancelled"}]}';
const iphoneAcceptedTasks = [
  "Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek.",
  "Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.",
  "Na zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą.",
  "Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej.",
];

test("preserves every valid first-pass iPhone task and avoids the exact regressive retry for a descriptive amount", async () => {
  model.mockResolvedValueOnce(generated(iphoneFirstTaskResponse));
  model.mockResolvedValueOnce(generated(iphoneRegressiveTaskResponse));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(iphoneTaskSource, "tasks", "pl", {
    onWarning: warning,
  });
  expect(evidence.map((entry) => entry.task)).toEqual(iphoneAcceptedTasks);
  expect(evidence.every((entry) => entry.kind === "active")).toBe(true);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test("restores the locally resolved iPhone task checkpoint without a model call or warning", async () => {
  model.mockResolvedValueOnce(generated(iphoneFirstTaskResponse));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(iphoneTaskSource, "tasks", "pl", {
    checkpoint,
    onWarning: warning,
  });
  expect(evidence.map((entry) => entry.task)).toEqual(iphoneAcceptedTasks);
  expect(warning).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(1);
  model.mockClear();
  await expect(
    collectSourceEvidence(iphoneTaskSource, "tasks", "pl", {
      checkpoint,
      onWarning: warning,
    }),
  ).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  { tasks: [{ id: 1, kind: "cancelled" }, { id: 999, kind: "active" }] },
  { tasks: [{ id: 1, kind: "cancelled" }, { id: 1, kind: "active" }] },
  { tasks: [{ id: 1, kind: "cancelled", quote: "rewritten" }] },
  { tasks: [{ id: 1, kind: "other" }] },
  { tasks: [{ id: 1, kind: "cancelled", change: "true" }] },
])("validates every source ID and schema before locally omitting a descriptive amount: %j", async ({ tasks }) => {
  model.mockResolvedValue(generated(JSON.stringify({ tasks })));
  const warning = jest.fn();
  await expect(collectSourceEvidence("The budget is 90 dollars.", "tasks", "en", { onWarning: warning })).rejects.toThrow("Invalid source task selection");
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "Pay 1750 dollars by Friday.",
  "Zapłacę 1750 złotych do piątku.",
  "The budget is 1750, and Alice must send the invoice.",
  "Budżet wynosi 1750 złotych, a Anna ma wysłać fakturę.",
  "Budżet wynosi 1750 złotych i Anna wyśle fakturę.",
  "The meeting will take place on Monday, and Maya will bring the report.",
  "The meeting will be held on Friday when Anna will send reminders.",
  "Spotkanie odbędzie się w piątek podczas którego Marta przygotuje listę materiałów.",
  "The equipment delivery date changed from Monday to Wednesday when Anna will send reminders.",
  "Change the equipment delivery date to Friday.",
])("retains a complete affirmative action containing an amount or calendar description: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([source]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test("leaves unfamiliar descriptive wording unresolved instead of inferring a safe omission", async () => {
  const source = "The allowance rises from 80 to 90.";
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"cancelled"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"omit","reason":"non_action"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("retains the bounded partial-result contract after an initial structural failure and a semantic retry failure", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":999,"kind":"active"}]}'));
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("persists validated tasks with a warning when a corrective prompt exceeds context without generating it", async () => {
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
    userPrompt.startsWith("/no_think\nRepair only")
      ? 4096
      : Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12,
  );
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("repairs a negated action without removing another owner's validated commitment", async () => {
  const source = "Alice will send the report by Friday. Bob will not buy the printer.";
  model.mockResolvedValueOnce(
    generated('{"tasks":[{"id":1,"kind":"active","change":true},{"id":2,"kind":"active"}]}'),
  );
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"cancelled"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", {
    onWarning: warning,
  });
  expect(evidence.map((entry) => ({ task: entry.task, kind: entry.kind, change: entry.change }))).toEqual([
    { task: "Alice will send the report by Friday.", kind: "active", change: true },
    { task: "Bob will not buy the printer.", kind: "cancelled", change: false },
  ]);
  expect(warning).not.toHaveBeenCalled();
  const schema = model.mock.calls[1][2]?.jsonSchema as {
    properties: { tasks: { items: { properties: { id: { enum: number[] } } } } };
  };
  expect(schema.properties.tasks.items.properties.id.enum).toEqual([2]);
  expect(sourceOf(model.mock.calls[1][0])).toBe("[2] Bob will not buy the printer.");
});

test.each([
  "Alice will pay 1750 by Friday.",
  "Zapłacę 1750 złotych do piątku.",
  "The budget is 1750, and Alice must send the invoice.",
  "Budżet wynosi 1750 złotych, a Anna ma wysłać fakturę.",
  "Budżet wynosi 1750 złotych i Anna wyśle fakturę.",
  "The old order was cancelled, so we must prepare the replacement.",
  "Do not buy the printer.",
])("keeps an unresolved warning when correction tries to omit a source action: %s", async (source) => {
  model.mockResolvedValueOnce(generated(
    JSON.stringify({ tasks: [{ id: 1, kind: source === "Do not buy the printer." ? "active" : "cancelled" }] }),
  ));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"omit","reason":"non_action"}]}'));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each([
  '{"tasks":[]}',
  '{"tasks":[{"id":2,"kind":"omit"}]}',
  '{"tasks":[{"id":2,"kind":"omit","reason":"completed"}]}',
  '{"tasks":[{"id":2,"kind":"omit","reason":"non_action"},{"id":2,"kind":"omit","reason":"non_action"}]}',
  '{"tasks":[{"id":999,"kind":"active"}]}',
  '{"tasks":[{"id":1,"kind":"cancelled"},{"id":2,"kind":"omit","reason":"non_action"}]}',
  '{"tasks":[{"id":2,"kind":"omit","reason":"non_action","quote":"rewritten"}]}',
  '{"tasks":[{"id":2,"kind":"uncertain","reason":"non_action"}]}',
  '{"tasks":[{"id":2,"kind":"other"}]}',
  '{"tasks":[{"id":2,"kind":"active","change":"true"}]}',
  '{"tasks":[{"id":2,"kind":"omit","reason":"non_action"}],"extra":true}',
])("retains frozen first-pass tasks with a warning for malformed or out-of-scope correction: %s", async (correction) => {
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockResolvedValueOnce(generated(correction));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(2);
});

test("does not checkpoint a cancelled semantic correction or start another recovery call", async () => {
  const controller = new AbortController();
  const checkpoint = checkpointStore();
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockImplementationOnce(async () => {
    controller.abort();
    return generated('{"tasks":[{"id":2,"kind":"omit","reason":"non_action"}]}');
  });
  const warning = jest.fn();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, signal: controller.signal, onWarning: warning })).rejects.toMatchObject({ name: "AbortError" });
  expect(await checkpoint.read(`tasks:0:${partiallyInvalidTaskSource.length}`)).toBeNull();
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test("checkpoints validated tasks with a durable warning when corrective generation rejects", async () => {
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockRejectedValueOnce(new Error("Native completion failed"));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("propagates initial generation failure without checkpointing a partial result", async () => {
  model.mockRejectedValueOnce(new Error("Native completion failed"));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning })).rejects.toThrow("Native completion failed");
  expect(await checkpoint.read(`tasks:0:${partiallyInvalidTaskSource.length}`)).toBeNull();
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([false, true])("propagates corrective generation abort without checkpointing (signal aborted: %s)", async (abortSignal) => {
  const controller = new AbortController();
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockImplementationOnce(async () => {
    if (abortSignal) controller.abort();
    const error = new Error("Generation aborted");
    error.name = "AbortError";
    throw error;
  });
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, signal: controller.signal, onWarning: warning })).rejects.toMatchObject({ name: "AbortError" });
  expect(await checkpoint.read(`tasks:0:${partiallyInvalidTaskSource.length}`)).toBeNull();
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test.each(["active", "uncertain"])(
  "locally omits a complete descriptive amount selected as %s",
  async (kind) => {
    model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: [{ id: 1, kind: "active" }, { id: 2, kind }, { id: 3, kind: "active" }] })));
    const warning = jest.fn();
    const source = "Nora will send the invoice by Friday. The final allowance is 80 instead of 60. Ian will test the microphone on Tuesday.";
    const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
    expect(evidence.map((entry) => entry.task)).toEqual([
      "Nora will send the invoice by Friday.",
      "Ian will test the microphone on Tuesday.",
    ]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  },
);

test("resolves several rejected IDs in source order and retains an independent valid owner", async () => {
  const source = "Nora will send the invoice. The final allowance is 80 instead of 60. Ian will not buy the printer.";
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"cancelled"},{"id":3,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":3,"kind":"cancelled"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => ({ task: entry.task, kind: entry.kind }))).toEqual([
    { task: "Nora will send the invoice.", kind: "active" },
    { task: "Ian will not buy the printer.", kind: "cancelled" },
  ]);
  expect(warning).not.toHaveBeenCalled();
});

test("persists only the unresolved real action after an explicit descriptive omission", async () => {
  const source = "Nora will send the invoice. The final allowance is 80 instead of 60. Ian will pay 80 by Friday.";
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"cancelled"},{"id":3,"kind":"cancelled"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":3,"kind":"omit","reason":"non_action"}]}'));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual(["Nora will send the invoice."]);
  const stored = await checkpoint.read(`tasks:0:${source.length}`) as { unresolved: { id: number }[] };
  expect(stored.unresolved.map((issue) => issue.id)).toEqual([3]);
  model.mockClear();
  warning.mockClear();
  await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("retains valid first-pass tasks after an incomplete bounded semantic correction", async () => {
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockResolvedValueOnce(generated('{"tasks":[', true));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("restores a resolved semantic correction after cancellation at the durable checkpoint", async () => {
  model.mockResolvedValueOnce(partiallyInvalidTasks);
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"}]}'));
  const checkpoint = checkpointStore();
  const controller = new AbortController();
  await expect(collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    signal: controller.signal,
    checkpoint: {
      read: checkpoint.read,
      write: async (key, value) => {
        await checkpoint.write(key, value);
        controller.abort();
      },
    },
  })).rejects.toMatchObject({ name: "AbortError" });
  model.mockClear();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Olga will pay 80 by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
});

test("retains valid source tasks with an explicit warning after one unsuccessful semantic retry", async () => {
  model.mockResolvedValue(partiallyInvalidTasks);
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(
    partiallyInvalidTaskSource,
    "tasks",
    "en",
    { onWarning: warning },
  );
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(warning.mock.calls[0][0]).toContain(
    "Review the suggestions before adding tasks.",
  );
  expect(warning.mock.calls[0][0]).not.toMatch(/\bID\s*\d|\d+:\d+/);
});

test("restores and re-emits a persisted partial task warning without regenerating completed source", async () => {
  model.mockResolvedValue(partiallyInvalidTasks);
  const checkpoint = checkpointStore();
  const firstWarning = jest.fn();
  await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    checkpoint,
    onWarning: firstWarning,
  });
  model.mockClear();
  const restoredWarning = jest.fn();
  const evidence = await collectSourceEvidence(
    partiallyInvalidTaskSource,
    "tasks",
    "en",
    { checkpoint, onWarning: restoredWarning },
  );
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Nora will send the invoice by Friday.",
    "Ian will test the microphone on Tuesday.",
  ]);
  expect(model).not.toHaveBeenCalled();
  expect(restoredWarning).toHaveBeenCalledTimes(1);
  expect(restoredWarning.mock.calls[0][0]).toBe(firstWarning.mock.calls[0][0]);
});

test("propagates a partial checkpoint storage failure without another model call or premature warning", async () => {
  model.mockResolvedValue(partiallyInvalidTasks);
  const warning = jest.fn();
  await expect(
    collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
      checkpoint: {
        read: async () => null,
        write: async () => {
          throw new Error("database is locked");
        },
      },
      onWarning: warning,
    }),
  ).rejects.toThrow("database is locked");
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test("does not salvage a structurally invalid source ID hidden after a semantic task error", async () => {
  model.mockResolvedValue(
    generated(
      '{"tasks":[{"id":2,"kind":"cancelled"},{"id":999,"kind":"active"}]}',
    ),
  );
  const warning = jest.fn();
  await expect(
    collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
      onWarning: warning,
    }),
  ).rejects.toThrow("Invalid source task selection");
  expect(warning).not.toHaveBeenCalled();
});

test("omits a declarative schedule change while retaining a direct rescheduling instruction", async () => {
  model.mockResolvedValue(
    generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"active"}]}'),
  );
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(
    "The inspection time changed from Monday to Wednesday. Change the inspection time to Friday.",
    "tasks",
    "en",
    { onWarning: warning },
  );
  expect(evidence.map((entry) => entry.task)).toEqual([
    "Change the inspection time to Friday.",
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([undefined, null, [12], [""], "warning"])(
  "does not restore a partial result with invalid warning metadata: %s",
  async (warnings) => {
    model.mockResolvedValue(partiallyInvalidTasks);
    const checkpoint = checkpointStore();
    await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
      checkpoint,
    });
    const key = `tasks:0:${partiallyInvalidTaskSource.length}`;
    const saved = (await checkpoint.read(key)) as Record<string, unknown>;
    await checkpoint.write(key, { ...saved, warnings });
    model.mockClear();
    const warning = jest.fn();
    const evidence = await collectSourceEvidence(
      partiallyInvalidTaskSource,
      "tasks",
      "en",
      { checkpoint, onWarning: warning },
    );
    expect(evidence.map((entry) => entry.task)).toEqual([
      "Nora will send the invoice by Friday.",
      "Ian will test the microphone on Tuesday.",
    ]);
    expect(model).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
  },
);

test("does not restore a partial result as clean when its warning or unresolved list has been removed", async () => {
  model.mockResolvedValue(partiallyInvalidTasks);
  const checkpoint = checkpointStore();
  await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    checkpoint,
  });
  const key = `tasks:0:${partiallyInvalidTaskSource.length}`;
  const saved = (await checkpoint.read(key)) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, warnings: [] });
  model.mockClear();
  const warning = jest.fn();
  await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    checkpoint,
    onWarning: warning,
  });
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  await checkpoint.write(key, { ...saved, unresolved: [] });
  model.mockClear();
  warning.mockClear();
  await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    checkpoint,
    onWarning: warning,
  });
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("propagates restored warning callback failures without regenerating completed source", async () => {
  model.mockResolvedValue(partiallyInvalidTasks);
  const checkpoint = checkpointStore();
  await collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
    checkpoint,
  });
  model.mockClear();
  await expect(
    collectSourceEvidence(partiallyInvalidTaskSource, "tasks", "en", {
      checkpoint,
      onWarning: () => {
        throw new Error("warning consumer failed");
      },
    }),
  ).rejects.toThrow("warning consumer failed");
  expect(model).not.toHaveBeenCalled();
});

test("retains separate source positions for identical quotations in prepared evidence", async () => {
  model.mockResolvedValue(
    generated(
      '{"facts":[1,3]}',
    ),
  );
  const evidence = await collectSourceEvidence(
    "Send report. Cancel that. Send report.",
    "facts",
    "en",
  );
  const prepared = evidenceText(evidence);
  expect(prepared).toContain("source 0:12) Send report.");
  expect(prepared).toContain("source 26:38) Send report.");
});

test("does not spend recovery budget on successful initial coverage fragments", async () => {
  contextSize.mockReturnValue(1000);
  const source = "An important source decision with its own number 42. ".repeat(
    250,
  );
  const analyzed: string[] = [];
  model.mockImplementation(async (prompt, _onToken, options) => {
    analyzed.push(factPromptSource(prompt));
    return generated(
      JSON.stringify({
        facts: generatedFactIds(options).slice(0, 12),
      }),
    );
  });
  const evidence = await collectSourceEvidence(source, "facts", "en");
  expect(analyzed.join(" ")).toBe(source.trim());
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(model.mock.calls.length).toBeGreaterThan(8);
});

const recoverySource = (count: number) => Array.from(
  { length: count },
  (_, index) => `Statement ${index} records an independent source decision. `,
).join("");
const measureRecoveryStatements = () => {
  contextSize.mockReturnValue(1024);
  measurePrompt.mockImplementation(async ({ userPrompt }) =>
    // An estimate can fit even when actual generation later stops at its limit.
    // Keep these tests focused on counting every recovery child and retry.
    isFactOutputPlan(userPrompt)
      ? 100
      : (sourceOf(userPrompt).match(/Statement \d+/gu)?.length ?? 0) * 40,
  );
};
const completeRecoveryRange = (text: string) => generated(JSON.stringify({
  facts: [...text.matchAll(/^\[(\d+)\] /gmu)].map((match) => Number(match[1])),
}));

const generatedFactIds = (options: Parameters<typeof generate>[2]): number[] => {
  const schema = options?.jsonSchema as {
    properties: { facts: { items: { enum: number[] } } };
  };
  return schema.properties.facts.items.enum;
};

test("analyzes all 4589 reference words through input-budget ranges with sparse output", async () => {
  const source = ENGLISH_AUDIO_FIXTURE_DATA["en-audio-30min-v1"].referenceTranscript;
  const checkpoint = checkpointStore();
  const completedRanges: { start: number; end: number; source: string }[] = [];
  const completedPrompts: string[] = [];
  model.mockImplementation(async (prompt, _onToken, options) => {
    const facts = generatedFactIds(options).slice(0, 12);
    const text = JSON.stringify({ facts });
    if (Math.ceil(Array.from(text).length / 4) > (options?.nPredict ?? 0))
      return generated(JSON.stringify({ facts: facts.slice(0, 1) }), true);
    completedPrompts.push(factPromptSource(prompt));
    return generated(text);
  });
  const evidence = await collectSourceEvidence(source, "facts", "en", { checkpoint: {
    read: checkpoint.read,
    write: async (key, value) => {
      await checkpoint.write(key, value);
      if (/^facts:\d+:\d+$/u.test(key)) completedRanges.push(value as { start: number; end: number; source: string });
    },
  } });
  expect(completedPrompts.join(" ")).toBe(source.replace(/\s+/gu, " "));
  expect(completedRanges.map((range) => range.source).join("")).toBe(source);
  expect(model.mock.calls.length).toBeLessThan(40);
  expect(model.mock.calls.every(([, , options]) => options?.nPredict === 512)).toBe(true);
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
  let end = 0;
  for (const range of completedRanges) {
    expect(range.start).toBe(end);
    const stored = await checkpoint.read(`facts:${range.start}:${range.end}`) as { source: string };
    expect(stored.source).toBe(source.slice(range.start, range.end));
    expect(range.end).toBe(range.start + range.source.length);
    end = range.end;
  }
  expect(end).toBe(source.length);
  expect(evidence.length).toBeLessThanOrEqual(completedRanges.length * 12);
});

test("extracts an input-fit atomic fact sentence whose full quote exceeds the output budget", async () => {
  const source = `The archive description contains ${"x".repeat(2100)}.`;
  const checkpoint = checkpointStore();
  model.mockResolvedValue(generated('{"facts":[1]}'));
  await expect(collectSourceEvidence(source, "facts", "en", { checkpoint })).resolves.toEqual([
    { id: `facts:0:${source.length}:0`, start: 0, end: source.length, quote: source, kind: "fact", importance: 2 },
  ]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(await checkpoint.read(`facts:0:${source.length}`)).toMatchObject({ source });
});

test("restores escaped literal units in one complete input range with exact UTF16 offsets", async () => {
  const first = 'The path is "C:\\Temp\\ä🧪" and the note contains a\t tab.';
  const second = 'The second note contains "quoted text" and a 漢 character.';
  const source = `${first}\n\n${second}`;
  model.mockResolvedValue(generated('{"facts":[1,2]}'));
  const evidence = await collectSourceEvidence(source, "facts", "en");
  expect(evidence.map((entry) => entry.quote)).toEqual([first, second]);
  expect(model).toHaveBeenCalledTimes(1);
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
});

test("stops before generation when cancellation occurs during complete input tokenization", async () => {
  const controller = new AbortController();
  const write = jest.fn();
  measurePrompt.mockImplementation(async () => {
    controller.abort();
    return 100;
  });
  await expect(collectSourceEvidence("The archive contains a literal decision.", "facts", "en", {
    signal: controller.signal,
    checkpoint: { read: async () => null, write },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(model).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test("resumes input-budget ranges without regenerating an abort-checkpointed whole range", async () => {
  const source = ENGLISH_AUDIO_FIXTURE_DATA["en-audio-30min-v1"].referenceTranscript;
  const checkpoint = checkpointStore();
  const controller = new AbortController();
  model.mockImplementation(async (_prompt, _onToken, options) => generated(JSON.stringify({
    facts: generatedFactIds(options).slice(0, 12),
  })));
  await expect(collectSourceEvidence(source, "facts", "en", {
    signal: controller.signal,
    checkpoint: {
      read: checkpoint.read,
      write: async (key, value) => {
        await checkpoint.write(key, value);
        controller.abort();
      },
    },
  })).rejects.toMatchObject({ name: "AbortError" });
  const completed = sourceOf(model.mock.calls[0][0]);
  expect(completed).toMatch(/^\[1\] These are the planning notes/);
  expect(model.mock.calls[0][2]?.nPredict).toBe(512);
  model.mockClear();
  const evidence = await collectSourceEvidence(source, "facts", "en", { checkpoint });
  expect(model.mock.calls.some(([prompt]) => sourceOf(prompt) === completed)).toBe(false);
  expect(evidence[0].start).toBe(0);
  expect(model.mock.calls.at(-1)?.[0]).toContain("The next editorial review is on November 8 at 2 in the afternoon.");
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
});

test("leaves task input planning unchanged by the fact output budget", async () => {
  const source = `The archived description contains ${"x".repeat(2100)}.`;
  model.mockResolvedValue(generated('{"tasks":[]}'));
  await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(sourceOf(model.mock.calls[0][0])).toBe(`[1] ${source}`);
  expect(measurePrompt.mock.calls.some(([input]) => isFactOutputPlan(input.userPrompt))).toBe(false);
});

test("covers both initial ranges after twelve legitimate bounded child calls", async () => {
  measureRecoveryStatements();
  const source = recoverySource(24);
  model.mockImplementation(async (prompt) => {
    const text = sourceOf(prompt);
    return (text.match(/Statement \d+/gu)?.length ?? 0) > 3
      ? generated('{"facts":[', true)
      : completeRecoveryRange(text);
  });
  const evidence = await collectSourceEvidence(source, "facts", "en");
  expect(evidence.map((entry) => entry.quote).join(" ")).toBe(source.trim());
  expect(model).toHaveBeenCalledTimes(14);
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
});

test("keeps the global 32-call recovery ceiling across many initial ranges", async () => {
  measureRecoveryStatements();
  const source = recoverySource(96);
  model.mockImplementation(async (prompt) => {
    const text = sourceOf(prompt);
    return (text.match(/Statement \d+/gu)?.length ?? 0) > 1
      ? generated('{"facts":[', true)
      : completeRecoveryRange(text);
  });
  await expect(collectSourceEvidence(source, "facts", "en")).rejects.toThrow("recovery generation limit reached");
  // Two initial calls and 32 charged child/retry calls; no partial success.
  expect(model).toHaveBeenCalledTimes(34);
});

test("resumes multi-range subdivisions after abort without regenerating a completed child", async () => {
  measureRecoveryStatements();
  const source = recoverySource(24);
  const checkpoint = checkpointStore();
  const controller = new AbortController();
  model.mockImplementation(async (prompt) => {
    const text = sourceOf(prompt);
    return (text.match(/Statement \d+/gu)?.length ?? 0) > 3
      ? generated('{"facts":[', true)
      : completeRecoveryRange(text);
  });
  await expect(collectSourceEvidence(source, "facts", "en", {
    signal: controller.signal,
    checkpoint: {
      read: checkpoint.read,
      write: async (key, value) => {
        await checkpoint.write(key, value);
        if (!key.includes(":split:")) controller.abort();
      },
    },
  })).rejects.toMatchObject({ name: "AbortError" });
  const completedChild = sourceOf(model.mock.calls[2][0]);
  expect(model).toHaveBeenCalledTimes(3);
  model.mockClear();
  const evidence = await collectSourceEvidence(source, "facts", "en", { checkpoint });
  expect(evidence.map((entry) => entry.quote).join(" ")).toBe(source.trim());
  expect(model.mock.calls.some(([prompt]) => sourceOf(prompt) === completedChild)).toBe(false);
  expect(model).toHaveBeenCalledTimes(11);
});

test("stops repeated incomplete subdivisions before spending an unbounded recovery budget", async () => {
  const source = Array.from(
    { length: 16 },
    (_, index) => `Statement ${index}. `,
  ).join("");
  model.mockImplementation(async (prompt) => {
    const text = sourceOf(prompt);
    return text.trim().split(/\.\s+/).length > 1
      ? generated('{"facts":[', true)
      : generated(JSON.stringify({ facts: [1] }));
  });
  await expect(collectSourceEvidence(source, "facts", "en")).rejects.toThrow(
    "recovery generation limit reached",
  );
  expect(model).toHaveBeenCalledTimes(9);
});

test("does not regenerate or subdivide valid evidence after a checkpoint write fails", async () => {
  const source =
    "Alice will send the report by Friday. Bob will test it on Tuesday.";
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: [
          {
            id: 1,
            kind: "active",
          },
        ],
      }),
    ),
  );
  const write = jest.fn(async () => {
    throw new Error("database is locked");
  });
  await expect(
    collectSourceEvidence(source, "tasks", "en", {
      checkpoint: { read: async () => null, write },
    }),
  ).rejects.toThrow("database is locked");
  expect(model).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});

test("keeps source actor and deadline in each task and excludes descriptions and negated actions", async () => {
  const source =
    "We reviewed the audio tests for the mobile application. The new interface is easier to read. Alice will send the report by Friday. Bob will test offline English transcription on Tuesday. The team decided to keep the current model until the benchmark is finished. We will not buy any new hardware. The next meeting is on October 8.";
  model.mockImplementation(async (prompt) => {
    if (prompt.includes("\nEARLIER\n"))
      return generated(
        JSON.stringify({ links: [], unlinked: true, uncertain: false }),
      );
    return generated(
      JSON.stringify({
        tasks: [
          {
            id: 3,
            kind: "active",
          },
          {
            id: 4,
            kind: "active",
          },
          {
            id: 6,
            kind: "cancelled",
          },
        ],
      }),
    );
  });
  await expect(extractTasks(source, () => undefined, "en")).resolves.toEqual([
    "Alice will send the report by Friday.",
    "Bob will test offline English transcription on Tuesday.",
  ]);
});

test("splits unbroken Unicode input without dropping or breaking any source character", async () => {
  contextSize.mockReturnValue(180);
  const source = "🧪Ą漢".repeat(300);
  const ranges = await splitSourceByPromptBudget(source, {
    system: "sys",
    prompt: (text) => `source:${text}`,
    nPredict: 32,
  });
  expect(ranges.length).toBeGreaterThan(1);
  expect(ranges.map((range) => range.text).join("")).toBe(source);
  let end = 0;
  for (const range of ranges) {
    expect(range.start).toBe(end);
    expect(range.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    expect(
      Math.ceil(Array.from("syssource:" + range.text).length / 4) +
        12 +
        32 +
        24,
    ).toBeLessThanOrEqual(180);
    end = range.end;
  }
  expect(end).toBe(source.length);
});

test("accepts a fitting single astral character as a complete source range", async () => {
  await expect(
    splitSourceByPromptBudget("🧪", {
      system: "system",
      prompt: (source) => source,
      nPredict: 32,
    }),
  ).resolves.toEqual([{ start: 0, end: 2, text: "🧪" }]);
});

test("rejects truncated atomic task extraction instead of severing its deadline", async () => {
  const source = "Send report by Friday.";
  model.mockResolvedValue(generated('{"tasks":[', true));
  await expect(extractTasks(source, () => undefined, "en")).rejects.toThrow();
  expect(model).toHaveBeenCalledTimes(1);
});

test("retains distinct decimal values in task deduplication", async () => {
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: [
          {
            id: 1,
            kind: "active",
            change: false,
          },
          {
            id: 2,
            kind: "active",
            change: false,
          },
        ],
      }),
    ),
  );
  await expect(
    extractTasks("Pay 1.2 zloty. Pay 12 zloty.", () => undefined, "en"),
  ).resolves.toEqual(["Pay 1.2 zloty.", "Pay 12 zloty."]);
});

test("does not accept empty facts as coverage of a substantive long note", async () => {
  model.mockResolvedValue(generated('{"facts":[]}'));
  const source = "The final decision is to cancel launch on Friday. ".repeat(
    500,
  );
  await expect(
    prepareGlobalSource(
      source,
      [{ system: "summary", prompt: (input) => input, nPredict: 256 }],
      "en",
    ),
  ).rejects.toThrow();
});

test("analyzes all fragments and retries truncated extraction by subdividing source", async () => {
  const analyzed: string[] = [];
  measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
    isFactOutputPlan(userPrompt) ? 100 : Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12,
  );
  model.mockImplementation(async (prompt, _token, options) => {
    const source = factPromptSource(prompt);
    expect(
      Math.ceil(Array.from((options?.system ?? "") + prompt).length / 4) +
        12 +
        (options?.nPredict ?? 0) +
        24,
    ).toBeLessThanOrEqual(4096);
    if (source.length > 1500) return generated('{"facts":[', true);
    analyzed.push(source);
    return generated(
      JSON.stringify({
        facts: generatedFactIds(options).slice(0, 12),
      }),
    );
  });
  const source =
    "Początek 🧪. " + "Środek rozmowy. ".repeat(180) + " Decyzja na końcu.";
  const evidence = await collectSourceEvidence(source, "facts", "pl");
  expect(analyzed.join(" ")).toBe(source.replace(/\s+/gu, " "));
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(evidence.length).toBeLessThanOrEqual(analyzed.length * 12);
  expect(model.mock.results.length).toBeGreaterThan(analyzed.length);
});

test("resumes validated subdivisions after cancellation instead of regenerating completed input", async () => {
  const checkpoint = checkpointStore();
  const controller = new AbortController();
  const completed: string[] = [];
  const source = "Pierwsza połowa. Druga połowa.";
  model.mockImplementation(async (prompt, _onToken, options) => {
    const text = factPromptSource(prompt);
    if (text === source) return generated('{"facts":[', true);
    completed.push(text);
    return generated(
      JSON.stringify({ facts: generatedFactIds(options).slice(0, 12) }),
    );
  });
  const store: ProcessingCheckpointStore = {
    read: checkpoint.read,
    write: async (key, value) => {
      await checkpoint.write(key, value);
      if (key.startsWith("facts:0:") && !key.includes("split"))
        controller.abort();
    },
  };
  await expect(
    collectSourceEvidence(source, "facts", "pl", {
      signal: controller.signal,
      checkpoint: store,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  const calls = model.mock.calls.length;
  const evidence = await collectSourceEvidence(source, "facts", "pl", {
    checkpoint,
  });
  expect(evidence.map((entry) => entry.quote).join(" ")).toBe(source);
  expect(
    model.mock.calls.slice(calls).map((call) => factPromptSource(call[0])),
  ).toEqual([source.slice(source.indexOf("Druga"))]);
});

test("rejects fabricated evidence even when the model returns valid JSON", async () => {
  model.mockResolvedValue(
    generated(
      '{"facts":[{"quote":"Invented payment due Friday","kind":"fact","importance":3}]}',
    ),
  );
  await expect(
    collectSourceEvidence("No payment is due.", "facts", "en"),
  ).rejects.toThrow("Cannot extract complete source evidence");
});

test("fails explicitly if a one-character input repeatedly exhausts output", async () => {
  model.mockResolvedValue(generated('{"facts":[', true));
  await expect(collectSourceEvidence("Ą", "facts", "pl")).rejects.toThrow(
    "Cannot extract complete source evidence",
  );
  expect(model).toHaveBeenCalledTimes(1);
});

test("reduces every group through multiple levels using existing source IDs only", async () => {
  const evidence: SourceEvidence[] = Array.from(
    { length: 500 },
    (_, index) => ({
      id: `f${index}`,
      start: index,
      end: index + 1,
      quote: `Decision ${index}: ` + "source statement ".repeat(30),
      kind: "decision",
      importance: 2,
    }),
  );
  const groups: string[][] = [];
  model.mockImplementation(async (prompt) => {
    const ids = [
      ...prompt.split("EVIDENCE_START\n")[1].matchAll(/\[(f\d+)\]/g),
    ].map((match) => match[1]);
    groups.push(ids);
    return generated(JSON.stringify({ ids: [ids[0], ids.at(-1)] }));
  });
  const selected = await selectGlobalEvidence(
    evidence,
    [{ system: "summary", prompt: (source) => source, nPredict: 256 }],
    "en",
    { checkpoint: checkpointStore() },
  );
  const firstLevel = new Set(groups.flat());
  expect(evidence.every((entry) => firstLevel.has(entry.id))).toBe(true);
  expect(groups.flat().filter((id) => id === "f0").length).toBeGreaterThan(1);
  expect(selected.some((entry) => entry.id === "f499")).toBe(true);
  expect(selected.every((entry) => evidence.includes(entry))).toBe(true);
  for (let index = 0; index < model.mock.calls.length; index += 1) {
    const options = model.mock.calls[index][2];
    expect(options?.jsonSchema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: { type: "string", enum: groups[index] },
        },
      },
    });
    expect(options?.nPredict).toBe(256);
  }
});

test("a required literal topic survives every reduction level and checkpoint replay", async () => {
  const evidence: SourceEvidence[] = Array.from({ length: 200 }, (_, index) => ({
    id: `f${index}`, start: index, end: index + 1,
    quote: `Source ${index}: ` + "existing descriptive material ".repeat(25), kind: "fact", importance: 2,
  }));
  const required = evidence[0];
  const checkpoint = checkpointStore();
  model.mockImplementation(async prompt => {
    const ids = [...prompt.split("EVIDENCE_START\n")[1].matchAll(/\[(f\d+)\]/gu)].map(match => match[1]);
    return generated(JSON.stringify({ ids: [ids.at(-1)] }));
  });
  const requests = [{ system: "summary", prompt: (source: string) => source, nPredict: 256 }];
  const selected = await selectGlobalEvidence(evidence, requests, "en", { checkpoint }, [required.id]);
  expect(selected).toContain(required);
  expect(selected.length).toBeLessThan(evidence.length);
  for (const [prompt] of model.mock.calls) {
    expect(jest.mocked(measureFormattedPromptTokens).mock.calls.some(([request]) => request.userPrompt === prompt)).toBe(true);
  }
  model.mockClear();
  expect(await selectGlobalEvidence(evidence, requests, "en", { checkpoint }, [required.id])).toEqual(selected);
  expect(model).not.toHaveBeenCalled();
});

test.each([
  '{"ids":["invented"]}',
  '{"ids":[]}',
  '{"ids":["f0",3]}',
  '{"ids":["f0","f0","f0","f0","f0","f0","f0"]}',
  '{"ids":["f0"]}}',
])("rejects invalid reduction output despite generation constraints and does not checkpoint it: %s", async (raw) => {
  const evidence: SourceEvidence[] = Array.from({ length: 4 }, (_, index) => ({
    id: `f${index}`,
    start: index * 12,
    end: index * 12 + 11,
    quote: `Decision ${index}.`,
    kind: "decision",
    importance: 2,
  }));
  contextSize.mockReturnValue(1024);
  measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
    systemPrompt === "summary"
      ? (userPrompt.match(/\[f\d+\]/gu)?.length ?? 0) * 350
      : 100,
  );
  model.mockResolvedValue(generated(raw));
  const checkpoint = checkpointStore();
  await expect(selectGlobalEvidence(
    evidence,
    [{ system: "summary", prompt: (source) => source, nPredict: 256 }],
    "en",
    { checkpoint },
  )).rejects.toThrow();
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0]).toBe(model.mock.calls[0][0]);
  expect(model.mock.calls[1][2]?.jsonSchema).toEqual(model.mock.calls[0][2]?.jsonSchema);
  expect(await checkpoint.read("reduce:0:0")).toBeNull();
});

test("keeps short notes on the direct path without evidence generations", async () => {
  await expect(
    prepareGlobalSource(
      "A short note.",
      [{ system: "system", prompt: (source) => source, nPredict: 256 }],
      "en",
    ),
  ).resolves.toBe("A short note.");
  expect(model).not.toHaveBeenCalled();
});

test("returns more than eight source-anchored tasks with their original relative dates", async () => {
  const tasks = Array.from(
    { length: 12 },
    (_, index) => `Przygotować dokument ${index + 1} do jutra`,
  );
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: tasks.map((_task, index) => ({ id: index + 1, kind: "active" })),
      }),
    ),
  );
  await expect(
    extractTasks(tasks.join(". ") + ".", () => undefined, "pl"),
  ).resolves.toEqual(tasks.map((task) => task + "."));
});

test("does not turn no-task text, questions or negated actions into active tasks", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  await expect(
    extractTasks("Rozmowa o pogodzie.", () => undefined),
  ).resolves.toEqual([]);
  model.mockResolvedValueOnce(
    generated(
      JSON.stringify({
        tasks: [
          {
            id: 1,
            kind: "cancelled",
          },
          {
            id: 2,
            kind: "uncertain",
          },
        ],
      }),
    ),
  );
  await expect(
    extractTasks("Nie wysyłać raportu. Może wysłać raport?", () => undefined),
  ).resolves.toEqual([]);
});

test("reconciles a source-backed cancellation with the earlier task and preserves a changed date", async () => {
  const entries = [
    {
      quote: "Send report by Monday.",
      kind: "active",
    },
    {
      quote: "Cancel Send report.",
      kind: "cancelled",
    },
    {
      quote: "Instead Send report by Friday.",
      kind: "active",
      change: true,
    },
  ];
  model.mockResolvedValueOnce(
    generated(
      JSON.stringify({
        tasks: entries.map((entry, index) => ({
          id: index + 1,
          kind: entry.kind,
          change: entry.change,
        })),
      }),
    ),
  );
  model.mockImplementation(async (prompt) => {
    const earlier = JSON.parse(
      prompt.split("\nEARLIER\n")[1].split("\nLATER\n")[0],
    ) as SourceEvidence[];
    return generated(
      JSON.stringify({
        links: [
          {
            earlierId: earlier[0].id,
            earlierAction: "Send report",
            laterAction: "Send report",
          },
        ],
        unlinked: false,
        uncertain: false,
      }),
    );
  });
  await expect(
    extractTasks(
      entries.map((entry) => entry.quote).join(" "),
      () => undefined,
      "en",
    ),
  ).resolves.toEqual(["Instead Send report by Friday."]);
});

test("does not accept an action that strips a negation from its source quote", async () => {
  model.mockResolvedValue(
    generated(
      JSON.stringify({
        tasks: [
          {
            quote: "Do not send the report.",
            task: "send the report",
            kind: "active",
          },
        ],
      }),
    ),
  );
  await expect(
    extractTasks("Do not send the report.", () => undefined, "en"),
  ).rejects.toThrow();
});

test("retains the earlier task with a warning when a pronoun cancellation cannot be source-linked", async () => {
  model.mockResolvedValueOnce(
    generated(
      JSON.stringify({
        tasks: [
          { id: 1, kind: "active" },
          {
            id: 2,
            kind: "cancelled",
          },
        ],
      }),
    ),
  );
  model.mockResolvedValue(
    generated(JSON.stringify({ links: [], unlinked: true, uncertain: true })),
  );
  const warning = jest.fn();
  await expect(
    extractTasks("Send report. Actually cancel that.", () => undefined, "en", {
      onWarning: warning,
    }),
  ).resolves.toEqual(["Send report."]);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("keeps a repeated commitment that is reinstated after an earlier cancellation", async () => {
  model.mockResolvedValueOnce(
    generated(
      JSON.stringify({
        tasks: [
          { id: 1, kind: "active" },
          {
            id: 2,
            kind: "cancelled",
          },
          { id: 3, kind: "active" },
        ],
      }),
    ),
  );
  model.mockImplementation(async (prompt) => {
    const earlier = JSON.parse(
      prompt.split("\nEARLIER\n")[1].split("\nLATER\n")[0],
    ) as SourceEvidence[];
    return generated(
      JSON.stringify({
        links: [
          {
            earlierId: earlier[0].id,
            earlierAction: "Send report",
            laterAction: "Send report",
          },
        ],
        unlinked: false,
        uncertain: false,
      }),
    );
  });
  await expect(
    extractTasks(
      "Send report. Cancel Send report. Send report.",
      () => undefined,
      "en",
    ),
  ).resolves.toEqual(["Send report."]);
});

test("fails closed when whole raw discovery exceeds context while preserving all 800 repeated sentences and the final decision", async () => {
  const source =
    "Discussion of available options. ".repeat(800) +
    "The final decision is to cancel launch on Friday.";
  const analyzed: string[] = [];
  const discoveryPreflights: { sourceData: { source: string; text: string }[]; targetSources: string[] }[] = [];
  const ordinaryMeasurement = measurePrompt.getMockImplementation()!;
  measurePrompt.mockImplementation(async input => {
    const count = await ordinaryMeasurement(input);
    if (input.userPrompt.startsWith('{"sourceData"')) {
      const payload = JSON.parse(input.userPrompt) as typeof discoveryPreflights[number];
      expect(input.jsonSchema).toBeDefined();
      expect(payload.sourceData).toHaveLength(801);
      expect(payload.sourceData.map(unit => unit.text).join(" ")).toBe(source);
      expect(payload.sourceData[0]).toEqual({ source: "S1", text: "Discussion of available options." });
      expect(payload.sourceData[800]).toEqual({ source: "S801", text: "The final decision is to cancel launch on Friday." });
      expect(count).toBeGreaterThan(4096);
      discoveryPreflights.push(payload);
    }
    return count;
  });
  model.mockImplementation(async (prompt, _token, options) => {
    expect(
      Math.ceil(Array.from((options?.system ?? "") + prompt).length / 4) +
        12 +
        (options?.nPredict ?? 0) +
        24,
    ).toBeLessThanOrEqual(4096);
    const requestSchema = options?.jsonSchema as { properties?: Record<string, unknown> } | undefined;
    if (requestSchema?.properties && "category" in requestSchema.properties) {
      const purpose = requestSchema.properties.purposeId as { enum: readonly number[] };
      expect(purpose.enum.length).toBeGreaterThan(0);
      return generated(JSON.stringify({ purposeId: purpose.enum[0], category: "Praca" }));
    }
    if (prompt.includes("Summarize the following note")) {
      expect(prompt).toContain("cancel launch on Friday");
      const selected = prompt.match(
        /\[(\d+)\] The final decision is to cancel launch on Friday\./,
      );
      if (!selected)
        throw new Error(
          "Final decision is missing from the numbered summary source",
        );
      const schema = options?.jsonSchema as { properties: { sentences: { minItems: number } } };
      return generated(JSON.stringify({ sentences: [
        ...Array.from({ length: schema.properties.sentences.minItems - 1 }, (_, index) => index + 1),
        Number(selected[1]),
      ] }));
    }
    if (prompt.includes("Select source statement IDs containing action items"))
      return generated(JSON.stringify({ tasks: [] }));
    if (requestSchema?.properties && "facts" in requestSchema.properties) {
      const text = factPromptSource(prompt);
      analyzed.push(text);
      const last = text.includes("The final decision");
      return generated(
        JSON.stringify({
          facts: [last ? Number(sourceOf(prompt).match(/\[(\d+)\] The final decision/)?.[1]) : 1],
        }),
      );
    }
    if (prompt.includes("Give a title"))
      return generated("Launch decision and options");
    return generated("Praca");
  });
  const result = await processNoteWithLlm(
    source,
    () => undefined,
    undefined,
    "en",
    { checkpoint: checkpointStore() },
  );
  expect(analyzed.join(" ")).toBe(source);
  expect(analyzed.at(-1)).toContain("The final decision is to cancel launch on Friday.");
  expect(result).toMatchObject({ title: "Launch decision and options", tags: ["Praca"] });
  // Approved interim availability boundary, not a repaired long-note requirement.
  expect(result.summary).toBe("");
  expect(result.summaryDocument).toBeNull();
  expect(result.failedFields).toEqual(["summary"]);
  expect(result.warnings).toEqual([
    "A reliable summary could not be created. Your source note has been kept.",
    "The summary could not be verified. Your complete transcript has been kept.",
  ]);
  expect(discoveryPreflights.length).toBeGreaterThan(0);
  expect(discoveryPreflights.some(page => page.targetSources.length === 1)).toBe(true);
  expect(model.mock.calls.some(([prompt]) => prompt.startsWith('{"sourceData"'))).toBe(false);
});

const actualV10FullSource = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they show. The difference between a clear story and a collection of unrelated facts Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday. The list contains the names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker and the updated guest list. Are the topics for that review";

const actualV10Daniel = "The difference between a clear story and a collection of unrelated facts Daniel will contact the guest speaker by Tuesday.";
const actualV10Calendar = "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker and the updated guest list.";
const actualV10InitialTasks = '{"tasks":[{"id":17,"kind":"active"},{"id":25,"kind":"cancelled"},{"id":26,"kind":"active"},{"id":27,"kind":"active"},{"id":28,"kind":"uncertain"}]}';

test("requests one bounded review for the exact physical v10 omitted terminal assignment, preserving the entire source ID", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV10Daniel, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: actualV10Daniel, task: actualV10Daniel, start: 0, end: actualV10Daniel.length, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[1] ${actualV10Daniel}`);
  expect(warning).not.toHaveBeenCalled();
});

test.each(["active", "uncertain", "cancelled"])("omits the exact physical v10 closed nominal calendar tail for model kind %s", async (kind) => {
  model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV10Calendar, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "The comparison of the two drafts Ada will submit the invoice by December 9 at 14:30.",
  "A short description of the workload Noelle will send the list before Monday.",
  "The difference between prose and notes Nobuko will finish the draft by 2026-12-09.",
])("reviews another literal terminal owner without rewriting the descriptive prefix: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
});

test.each([
  "The example was that Daniel will contact the guest speaker by Tuesday.",
  "The example Daniel will contact the guest speaker by Tuesday.",
  "The assumption Daniel will contact the guest speaker by Tuesday.",
  "The possibility Daniel will contact the guest speaker by Tuesday.",
  "The proposed arrangement Daniel will contact the guest speaker by Tuesday.",
  "The absence of an obligation Daniel will contact the guest speaker by Tuesday.",
  "The lack of a requirement Daniel will contact the guest speaker by Tuesday.",
  "The report says Daniel will contact the guest speaker by Tuesday.",
  "The evidence suggests Daniel will contact the guest speaker by Tuesday.",
  "The forecast predicts Daniel will contact the guest speaker by Tuesday.",
  "The analysis implies Daniel will contact the guest speaker by Tuesday.",
  "The production budget according to Daniel will contact the guest speaker by Tuesday.",
  "The historical account from last year Daniel will contact the guest speaker by Tuesday.",
  "The background from yesterday Daniel will contact the guest speaker by Tuesday.",
  "If approved Daniel will contact the guest speaker by Tuesday.",
  "The comparison of the drafts Daniel will contact the guest speaker by Tuesday unless approved.",
  'The comparison of the drafts "Daniel will contact the guest speaker by Tuesday."',
  "The comparison of the drafts ‘Daniel will contact the guest speaker by Tuesday’.",
  "The comparison of the drafts Daniel will contact the guest speaker by Tuesday?",
  "The person who joined Daniel will contact the guest speaker by Tuesday.",
  "The comparison which Daniel will contact the guest speaker by Tuesday.",
  "The comparison that Daniel will contact the guest speaker by Tuesday.",
  "The comparison did not establish Daniel will contact the guest speaker by Tuesday.",
  "The comparison without approval Daniel will contact the guest speaker by Tuesday.",
  "The comparison of no drafts Daniel will contact the guest speaker by Tuesday.",
  "The comparison of the drafts Daniel will not contact the guest speaker by Tuesday.",
  "The comparison of the drafts Daniel will contact nobody by Tuesday.",
  "The comparison of the drafts Daniel will contact no guest by Tuesday.",
  "The comparison of the drafts Alice and Daniel will contact the guest speaker by Tuesday.",
  "The comparison of the drafts and Daniel will contact the guest speaker by Tuesday.",
  "The comparison of the drafts Ada Lovelace will contact the guest speaker by Tuesday.",
  "The comparison Alice will send a draft and Daniel will contact the guest speaker by Tuesday.",
  "The comparison of the drafts Daniel will contact the speaker and Nora will send the list by Tuesday.",
  "The comparison of the drafts Daniel will contact the guest speaker.",
  "The comparison of the drafts Will will contact the guest speaker by Tuesday.",
  "The comparison of the drafts my will contact the guest speaker by Tuesday if approved.",
])("does not mandate terminal assignment review for a reported, negated or ambiguous unit: %s", async (source) => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});

test.each([
  "The next planning review is on December 9 at three in the afternoon the draft the speaker and the revised list.",
  "The next meeting is on Friday the current report and the speaker are the topics for that meeting.",
])("omits only another closed literal calendar and nominal list: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each([
  "The next editorial review is on November 8 at two in the afternoon the speaker and the updated guest list must arrive before lunch.",
  "The next editorial review is on November 8 at two in the afternoon the speaker will send the outline.",
  "The next editorial review is on November 8 at two in the afternoon please attend.",
  "The next editorial review is on November 8 at two in the afternoon the outline which Nora will send.",
  "The next editorial review is on November 8 at two in the afternoon the unknown sculpture.",
  "If approved the next editorial review is on November 8 at two in the afternoon the outline.",
  '"The next editorial review is on November 8 at two in the afternoon the outline."',
  "The report stated the next editorial review is on November 8 at two in the afternoon the outline.",
  "The next editorial review was on November 8 at two in the afternoon the outline.",
  "The next editorial review is on November 8 at two in the afternoon the outline?",
])("preserves model evidence when a calendar suffix contains action or unsupported context: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(1);
});

test.each([false, true])("replays exact physical v10 IDs with a shared correction and durable actor warning (old correction: %s)", async (oldCorrection) => {
  model.mockResolvedValueOnce(generated(actualV10InitialTasks));
  model.mockResolvedValueOnce(generated(oldCorrection
    ? '{"tasks":[{"id":2,"kind":"uncertain"},{"id":25,"kind":"active"}]}'
    : '{"tasks":[{"id":2,"kind":"uncertain"},{"id":6,"kind":"active"},{"id":25,"kind":"active"}]}'));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(actualV10FullSource, "tasks", "en", { checkpoint, onWarning: warning });
  expect(evidence.some((entry) => entry.quote === actualV10Calendar)).toBe(false);
  expect(evidence.some((entry) => entry.quote === actualV10Daniel)).toBe(!oldCorrection);
  expect(evidence.some((entry) => entry.quote.includes("my will"))).toBe(false);
  expect(evidence.some((entry) => entry.quote.startsWith("Maya will"))).toBe(false);
  for (const entry of evidence) expect(actualV10FullSource.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[2] ${actualV9MalformedAction}\n[6] ${actualV10Daniel}\n[25] The north studio reservation was canceled so we must use the south studio for the recording.`);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear(); warning.mockClear();
  await expect(collectSourceEvidence(actualV10FullSource, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("keeps a selected uncertain terminal assignment visibly unresolved after one correction and on resume", async () => {
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
  const warning = jest.fn();
  const checkpoint = checkpointStore();
  await expect(collectSourceEvidence(actualV10Daniel, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear(); warning.mockClear();
  await expect(collectSourceEvidence(actualV10Daniel, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("rejects a terminal assignment checkpoint that loses both its active evidence and unresolved metadata", async () => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const checkpoint = checkpointStore();
  const key = `tasks:0:${actualV10Daniel.length}`;
  await collectSourceEvidence(actualV10Daniel, "tasks", "en", { checkpoint });
  const saved = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, warnings: [], unresolved: [] });
  model.mockClear();
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualV10Daniel, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  const restored = await checkpoint.read(key) as { unresolved: { id: number }[] };
  expect(restored.unresolved.map((issue) => issue.id)).toEqual([1]);
});

describe("standalone required actions survive a leading coordinating word", () => {
  test.each([
    "i muszę omówić co dalej z inżynierem",
    "I muszę omówić co dalej z inżynierem",
    "oraz muszę omówić co dalej z inżynierem",
    "i muszę pokazać postępy w aplikacji",
    "and I must review the invoice",
    "and we must prepare the report",
  ])("recognizes the omitted requirement despite its leading coordinator: %s", (text) => {
    expect(hasStandaloneRequiredActionCandidate(text)).toBe(true);
  });

  test.each([
    "i muszę omówić",
    "i nie muszę omówić co dalej z inżynierem",
    "i może muszę omówić co dalej z inżynierem",
    '"i muszę omówić co dalej z inżynierem"',
    "i muszę omówić co dalej z inżynierem jeśli dostanę zgodę",
    "i muszę omówić co dalej z inżynierem wczoraj",
    "i muszę omówić co dalej z inżynierem?",
  ])("keeps qualified, negated, quoted or incomplete wording out of the gate: %s", (text) => {
    expect(hasStandaloneRequiredActionCandidate(text)).toBe(false);
  });

  test.each([
    "muszę przygotować raport",
    "Muszę sprawdzić raport.",
    "I must review the invoice.",
  ])("keeps the established positive cases unchanged: %s", (text) => {
    expect(hasStandaloneRequiredActionCandidate(text)).toBe(true);
  });

  test("requests the bounded whole-ID correction for the exact phone unit", async () => {
    const source = "i muszę omówić co dalej z inżynierem";
    model.mockResolvedValueOnce(generated('{"tasks":[]}'))
      .mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
      expect.objectContaining({ quote: source, task: source, kind: "active" }),
    ]);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0]).toContain(`[1] ${source}`);
  });

  test("keeps a bare coordinated modal without an object out of the correction path", async () => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    await expect(collectSourceEvidence("i muszę omówić", "tasks", "pl")).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("task output budget", () => {
  const dense = (count: number): string =>
    Array.from({ length: count }, (_, index) => `Please review document number ${index + 1} today.`).join(" ");

  test("keeps the base budget for short sources", async () => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    await collectSourceEvidence(dense(10), "tasks", "en");
    expect(model.mock.calls[0][2]?.nPredict).toBe(512);
  });

  test("gives dense ranges headroom so one call does not truncate and split", async () => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    await collectSourceEvidence(dense(60), "tasks", "en");
    expect(model.mock.calls[0][2]?.nPredict).toBe(60 * 11 + 48);
  });

  test("never grows past the room left in the context window", async () => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    measurePrompt.mockImplementation(async () => contextSize() - 600);
    try {
      await collectSourceEvidence(dense(60), "tasks", "en");
    } finally {
      measurePrompt.mockImplementation(async ({ systemPrompt, userPrompt }) =>
        Math.ceil(Array.from(systemPrompt + userPrompt).length / 4) + 12);
    }
    const first = model.mock.calls[0][2]?.nPredict ?? 0;
    expect(first).toBeLessThanOrEqual(Math.max(512, 600 - 24));
  });
});
