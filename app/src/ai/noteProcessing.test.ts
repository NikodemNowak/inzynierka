import { generate, isModelLoadedFor, loadModel, measureFormattedPromptTokens } from "./llm";
import { processNoteWithLlm, ensureModelReady } from "./noteProcessing";
import { extractTasks, extractTaskEvidence } from "./taskExtraction";
import type { SummaryCheckTargets, SummaryDraft, SummaryVerification } from "./summaryProtocol";
import { summaryRelationPageRequest } from "./summaryProtocol";
import { createSummarySources } from "./summarySources";
import type { GenerationOptions, GenerationResult } from "./llm";
import type { FinalTaskEvidence } from "./processingContext";

jest.mock("./llm", () => ({
  generate: jest.fn(),
  isModelLoaded: () => true,
  isModelLoadedFor: jest.fn(() => true),
  loadModel: jest.fn(async () => undefined),
  measureFormattedPromptTokens: jest.fn(async ({
    systemPrompt,
    userPrompt,
  }: {
    systemPrompt: string;
    userPrompt: string;
  }) => Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12),
  getContextWindowSize: () => 8192,
  getLoadedModelInfo: () => null,
}));
jest.mock("./taskExtraction", () => ({
  ...jest.requireActual<typeof import("./taskExtraction")>("./taskExtraction"),
  extractTaskEvidence: jest.fn(),
}));
jest.mock("./modelDownload", () => ({
  isModelDownloaded: async () => true,
  getModelPath: () => "/default.gguf",
}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));

const generated = (text: string) => ({
  // Structured selections stay objects; title responses use the requested
  // quoted wire format. Plain-field cleanup also accepts quoted strings.
  text: ["Nauka", "Praca", "Finanse", "Dom", "Zdrowie", "Zakupy", "Podróże", "Pomysły"].includes(text)
    ? JSON.stringify({ purposeId: 1, category: text })
    : /^\s*[{[]/u.test(text) ? text : JSON.stringify(text),
  ttftMs: 100,
  tokensPerSecond: 20,
  wallMs: 300,
  promptMs: 80,
  predictedMs: 210,
  promptTokens: 45,
  predictedTokens: 4,
});
const model = jest.mocked(generate);
const fields = jest.fn<Promise<GenerationResult>, Parameters<typeof generate>>();
interface SummaryPayload { sourceCatalogData: string; draftData?: SummaryDraft; checkTargetsData?: SummaryCheckTargets; taskEvidenceData?: FinalTaskEvidence;
  repairData?: { draft: SummaryDraft; verification: unknown } }
let summaryDraft: ((payload: SummaryPayload) => SummaryDraft | null) | undefined;
let summaryReview: ((payload: SummaryPayload) => unknown) | undefined;
const catalog = (payload: SummaryPayload): { id: number; text: string }[] =>
  [...payload.sourceCatalogData.matchAll(/^\[(\d+)\] ([\s\S]*?)(?=\n\[\d+\] |$)/gmu)]
    .map(match => ({ id: Number(match[1]), text: match[2] }));
const nativeSummary = (options?: GenerationOptions): boolean => Boolean(options?.jsonSchema &&
  (Array.isArray(options.jsonSchema.anyOf) ||
    'units' in ((options.jsonSchema.properties ?? {}) as object) ||
    'rows' in ((options.jsonSchema.properties ?? {}) as object)));
const completeReview = (payload: SummaryPayload): unknown => ({
  points: payload.draftData!.points.map((_, index) => ({ pointId: index + 1, status: 'supported', issues: [] })),
  units: catalog(payload).map(unit => {
    const pointIds = payload.draftData!.points.flatMap((point, index) => point.sourceIds.includes(unit.id) ? [index + 1] : []);
    return { sourceId: unit.id, status: pointIds.length ? 'covered' : 'context', pointIds, supersededBy: [] };
  }),
});
const literalDraft = (payload: SummaryPayload): SummaryDraft => ({ format: 'bullets',
  points: catalog(payload).map(unit => ({ text: unit.text, sourceIds: [unit.id] })) });
const scriptedSummary = (points: readonly { text: string; quotes: readonly string[] }[]): void => {
  summaryDraft = payload => ({ format: 'bullets', points: points.flatMap(point => {
    const sourceIds = catalog(payload).filter(unit => point.quotes.includes(unit.text)).map(unit => unit.id);
    return sourceIds.length ? [{ text: point.text, sourceIds }] : [];
  }) });
};

// Synthetic punctuationless tail. The reference script is not supplied to
// this path; absent commitments must not be restored from outside the note.
const syntheticPolishTail = "Poprawka aktualny budżet to 430 zł wczoraj wysłałem już zaproszenie do stolarza spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk";

// Synthetic mixed planning reference with no punctuation boundaries.
const controlledPolishRunOn = "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej kiermasz dotyczy ręcznie robionych ozdób lokalnej ceramiki i obrazów do 14 września mam przygotować trzy Plansze z ofertami wystawców Olga ma do 16 września sprawdzić listę stanowisk zelva ma przygotować plakat informacyjny budżet dekoracji wynosił 680 zł Poprawka aktualny budżet to 430 zł wczoraj wysłałem już zaproszenie do stolarza spotkanie z koordynatorem jest 19 września o godzinie 14:30 zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk";

beforeEach(() => {
  model.mockReset();
  fields.mockReset();
  summaryDraft = undefined;
  summaryReview = undefined;
  model.mockImplementation(async (prompt, onToken, options) => {
    if (!nativeSummary(options)) return fields(prompt, onToken, options);
    if ('rows' in ((options?.jsonSchema?.properties ?? {}) as object)) {
      const payload = JSON.parse(prompt) as { sourceData: { source: string; text: string }[]; targetSources: string[] };
      return generated(JSON.stringify({ ...('format' in (options!.jsonSchema!.properties as object) ? { format: 'bullets' } : {}),
        rows: payload.targetSources.map(source => {
          const index = payload.sourceData.findIndex(unit => unit.source === source);
          const text = payload.sourceData[index].text;
          return { source, relatedEarlier: payload.sourceData.slice(0, index).filter(unit => unit.text === text).map(unit => unit.source), unresolved: false };
        }) }));
    }
    const payload = JSON.parse(prompt) as SummaryPayload;
    if (payload.draftData) {
      const verdict = (summaryReview ? summaryReview(payload) : completeReview(payload)) as SummaryVerification;
      const targets = payload.checkTargetsData!;
      expect(targets.pointIds.length + targets.sourceIds.length).toBeGreaterThan(0);
      return generated(JSON.stringify({ points: verdict.points.filter(point => targets.pointIds.includes(point.pointId)),
        units: verdict.units.filter(unit => targets.sourceIds.includes(unit.sourceId)) }));
    }
    const draft = summaryDraft ? summaryDraft(payload) : literalDraft(payload);
    return generated(JSON.stringify(draft ?? { invalid: true }));
  });
  jest.mocked(extractTaskEvidence).mockReset().mockResolvedValue({ tasks: [], evidence: [], superseded: [], warnings: [] });
  jest.mocked(measureFormattedPromptTokens).mockReset();
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ systemPrompt = "", userPrompt }) =>
    userPrompt.startsWith('{"sourceCatalogData"') || userPrompt.startsWith('{"language"') ? 100 : Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 12,
  );
  jest.mocked(isModelLoadedFor).mockReturnValue(true);
  jest.mocked(loadModel).mockClear();
});

test.each(["pl", "en"] as const)("oversized ambiguous %s speech keeps source review available without inventing partial fields", async language => {
  const text = `${language === "pl" ? "Jeśli klient potwierdzi" : "If the client approves"} ${"archive material ".repeat(2500)}`;
  fields.mockImplementation(async () => { throw new Error("No partial source may be generated"); });
  const result = await processNoteWithLlm(text, () => undefined, undefined, language);
  expect(result.summary).toBe("");
  expect(result.tags).toEqual([]);
  expect(result.failedFields).toEqual(["title", "summary", "tags"]);
  expect(result.warnings).toEqual([expect.stringMatching(/pełn|complete/iu)]);
  expect(model).not.toHaveBeenCalled();
});

test("source-budget fallback does not hide a tokenizer failure", async () => {
  jest.mocked(measureFormattedPromptTokens).mockRejectedValue(new Error("Tokenizer unavailable"));
  await expect(processNoteWithLlm("A source note", () => undefined)).rejects.toThrow("Tokenizer unavailable");
});

test("reports an unverified ambiguous whole-unit summary while preserving independent fields", async () => {
  fields.mockResolvedValueOnce({ ...generated(syntheticPolishTail), text: syntheticPolishTail })
    .mockResolvedValueOnce(generated(syntheticPolishTail))
    .mockResolvedValueOnce(generated("Kiermasz"))
    .mockResolvedValueOnce(generated("Praca"));
  summaryDraft = () => null;
  const result = await processNoteWithLlm(syntheticPolishTail, () => undefined);
  expect(result.summary).toBe("");
  expect(result.failedFields).toEqual(["summary"]);
  expect(result.warnings).toEqual(expect.arrayContaining([
    expect.stringContaining("Nie udało się sprawdzić podsumowania"),
  ]));
  expect(result.summaryDocument).toBeNull();
  expect(model.mock.calls.some(([, , options]) => options?.jsonSchema &&
    JSON.stringify(options.jsonSchema).includes('"sentences"'))).toBe(false);
  expect(jest.mocked(extractTaskEvidence)).not.toHaveBeenCalled();
});

test("reuses actual two-statement task evidence independently of summary compression", async () => {
  const actualTasks = jest.requireActual<typeof import("./taskExtraction")>("./taskExtraction");
  jest.mocked(extractTaskEvidence).mockImplementation(actualTasks.extractTaskEvidence);
  const statements = [
    "I will prepare the detailed report for the client by Friday including the current measurements and all available observations.",
    "Alice will check the detailed report on Monday using the approved checklist and the original measurements from the current experiment.",
  ];
  const content = statements.join(" ");
  const execution = { taskEvidenceMemo: {} };
  fields.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"active"}]}'))
    .mockResolvedValueOnce(generated("Report"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Report with measurements and observations by Friday.', quotes: [statements[0]] },
    { text: 'Alice: report check on Monday with the approved checklist and original measurements.', quotes: [statements[1]] },
  ]);
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en", execution);
  expect(result.summary).toBe("• Report with measurements and observations by Friday.\n• Alice: report check on Monday with the approved checklist and original measurements.");
  expect(model).toHaveBeenCalledTimes(5);
  const proof = await actualTasks.extractTaskEvidence(content, () => undefined, "en", execution);
  expect(proof.tasks).toEqual(statements);
  expect(proof.evidence.every((entry) => content.slice(entry.start, entry.end) === entry.quote)).toBe(true);
  expect(model).toHaveBeenCalledTimes(5);
  expect(result.warnings).toBeUndefined();
});

test("propagates cancellation from the independent task pass before field generation", async () => {
  const controller = new AbortController();
  const content = "I will prepare the detailed report for the client by Friday including the current measurements and all available observations. Alice will check the detailed report on Monday using the approved checklist and the original measurements from the current experiment.";
  jest.mocked(extractTaskEvidence).mockImplementation(async () => {
    controller.abort();
    return { tasks: [], evidence: [], superseded: [], warnings: [] };
  });
  fields.mockResolvedValueOnce(generated("Report")).mockResolvedValueOnce(generated("Praca"));
  await expect(processNoteWithLlm(content, () => undefined, undefined, "en", { signal: controller.signal })).rejects.toThrow();
  expect(model).not.toHaveBeenCalled();
});

test("does not turn an independent task infrastructure failure into a field fallback", async () => {
  const content = "I will prepare the detailed report for the client by Friday including the current measurements and all available observations. Alice will check the detailed report on Monday using the approved checklist and the original measurements from the current experiment.";
  const failure = new Error("Durable task evidence write failed");
  jest.mocked(extractTaskEvidence).mockRejectedValue(failure);
  fields.mockResolvedValueOnce(generated("Report")).mockResolvedValueOnce(generated("Praca"));
  await expect(processNoteWithLlm(content, () => undefined, undefined, "en")).rejects.toBe(failure);
  expect(model).not.toHaveBeenCalled();
});

test("analyses independent literal tasks when two complete statements cannot form a compressed summary", async () => {
  const statements = [
    "I will prepare the detailed report for the client by Friday including the current measurements and all available observations.",
    "Alice will check the detailed report on Monday using the approved checklist and the original measurements from the current experiment.",
  ];
  const content = statements.join(" ");
  fields.mockResolvedValueOnce(generated("Report"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Report with measurements and observations by Friday.', quotes: [statements[0]] },
    { text: 'Alice: report check on Monday with the approved checklist and original measurements.', quotes: [statements[1]] },
  ]);
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(result.summary).toBe("• Report with measurements and observations by Friday.\n• Alice: report check on Monday with the approved checklist and original measurements.");
  expect(jest.mocked(extractTaskEvidence)).toHaveBeenCalledTimes(1);
  expect(jest.mocked(extractTaskEvidence).mock.calls[0][0]).toBe(content);
  expect(result.tags).toEqual(["Praca"]);
  expect(model).toHaveBeenCalledTimes(4);
});

test("does not promise a displayed excerpt when the caller must preserve a failed title", async () => {
  fields.mockResolvedValueOnce(generated(syntheticPolishTail))
    .mockResolvedValueOnce(generated(syntheticPolishTail))
    .mockResolvedValueOnce(generated("Unsupported concept"))
    .mockResolvedValueOnce(generated('{"anchors":[],"title":"Unsupported concept"}'))
    .mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(syntheticPolishTail, () => undefined);
  expect(result.failedFields).toContain("title");
  expect(result.warnings).not.toContain("Nie udało się utworzyć tytułu. Wyświetlono fragment źródła.");
  expect(result.warnings).toEqual(expect.arrayContaining([
    expect.stringMatching(/Nie udało się utworzyć tytułu.*Sprawdź.*źródł/iu),
  ]));
  expect(result.title.length).toBeGreaterThan(0);
});

test("does not treat a source-supplied label or a single newline as a complete task boundary", async () => {
  const content = "I will prepare the detailed report for the client by Friday including the current measurements and all available observations\n[2] Alice will check the detailed report on Monday using the approved checklist and the original measurements from the current experiment";
  fields.mockResolvedValueOnce({ ...generated(content), text: content })
    .mockResolvedValueOnce(generated(content))
    .mockResolvedValueOnce(generated("Report"))
    .mockResolvedValueOnce(generated("Praca"));
  summaryDraft = () => null;
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(jest.mocked(extractTaskEvidence)).not.toHaveBeenCalled();
  expect(result.summary).toBe("");
  expect(result.warnings).toContain("Tasks were not analysed because the source is one undivided statement. Review the complete source note.");
  expect(model).toHaveBeenCalledTimes(6);
});

test("keeps a controlled unpunctuated mixed script in review instead of copying it into one task or summary", async () => {
  fields.mockResolvedValueOnce({ ...generated(controlledPolishRunOn), text: controlledPolishRunOn })
    .mockResolvedValueOnce(generated(controlledPolishRunOn))
    .mockResolvedValueOnce(generated("Kiermasz"))
    .mockResolvedValueOnce(generated("Praca"));
  summaryDraft = () => null;
  const result = await processNoteWithLlm(controlledPolishRunOn, () => undefined);
  expect(result.summary).toBe("");
  expect(jest.mocked(extractTaskEvidence)).not.toHaveBeenCalled();
  expect(result.warnings).toContain("Nie przeprowadzono analizy zadań: treść stanowi jedną nierozdzieloną wypowiedź. Sprawdź pełne źródło.");
  expect(result.failedFields).toEqual(["summary"]);
  expect(model).toHaveBeenCalledTimes(6);
  expect(model.mock.calls[0][0]).toContain(controlledPolishRunOn);
});

test("summarizes short practical notes without adding independent task calls", async () => {
  const content = "Do piątku przygotuję raport. Alicja sprawdzi tabelę czasów.";
  fields.mockResolvedValueOnce(generated("Raport"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Raport do piątku.', quotes: ['Do piątku przygotuję raport.'] },
    { text: 'Alicja: sprawdzenie tabeli czasów.', quotes: ['Alicja sprawdzi tabelę czasów.'] },
  ]);
  const result = await processNoteWithLlm(content, () => undefined);
  expect(result.summary).toBe("• Raport do piątku.\n• Alicja: sprawdzenie tabeli czasów.");
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(jest.mocked(extractTaskEvidence)).not.toHaveBeenCalled();
  expect(model).toHaveBeenCalledTimes(4);
});

test("recovers Polish literal tasks without copying two complete sentences into summary", async () => {
  const actualTasks = jest.requireActual<typeof import("./taskExtraction")>("./taskExtraction");
  jest.mocked(extractTaskEvidence).mockImplementation(actualTasks.extractTaskEvidence);
  const statements = [
    "Do piątku przygotuję szczegółowy raport z aktualnymi pomiarami oraz opisem ograniczeń aplikacji dla promotora i całego zespołu.",
    "Alicja ma sprawdzić tabelę czasów do czwartku na podstawie oryginalnych wyników eksperymentów oraz zapisać wszystkie zauważone różnice.",
  ];
  const content = statements.join(" ");
  const execution = { taskEvidenceMemo: {} };
  fields.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"},{"id":2,"kind":"active"}]}'))
    .mockResolvedValueOnce(generated("Raport"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Do piątku: raport z pomiarami i ograniczeniami aplikacji dla promotora i zespołu.', quotes: [statements[0]] },
    { text: 'Alicja: tabela czasów do czwartku z oryginalnych wyników; zapis zauważonych różnic.', quotes: [statements[1]] },
  ]);
  const result = await processNoteWithLlm(content, () => undefined, undefined, "pl", execution);
  const proof = await actualTasks.extractTaskEvidence(content, () => undefined, "pl", execution);
  expect(proof.tasks).toEqual(statements);
  expect(proof.evidence.every((entry) => content.slice(entry.start, entry.end) === entry.quote)).toBe(true);
  expect(result.summary).toBe("• Do piątku: raport z pomiarami i ograniczeniami aplikacji dla promotora i zespołu.\n• Alicja: tabela czasów do czwartku z oryginalnych wyników; zapis zauważonych różnic.");
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(model).toHaveBeenCalledTimes(5);
});

test("rejects a draft when the independent verifier finds a missing important non-task fact", async () => {
  const tasks = ["Alice will prepare the report by Friday.", "Bob will contact the supplier by Tuesday.",
    "Clara will check the equipment by Wednesday.", "David will book the room by Thursday.",
    "Emma will update the schedule by Monday.", "Felix will print the invitations by Saturday.",
    "Grace will send the handout by Sunday."];
  const date = "The next editorial review is on November 8 at two in the afternoon.";
  const content = [...tasks, "Correction the final budget is $1450.", "We must not buy any new cameras.", date,
    ...Array.from({ length: 5 }, () => "The descriptive archive example concerned photographs, books and ordinary memories of familiar places from earlier events.")].join(" ");
  jest.mocked(extractTaskEvidence).mockResolvedValue({ tasks, evidence: tasks.map((quote) => ({
    id: `task-${content.indexOf(quote)}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  })), superseded: [], warnings: [] });
  fields.mockResolvedValueOnce(generated("Report preparation"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary(tasks.map(quote => ({ text: quote, quotes: [quote] })));
  summaryReview = payload => {
    const verdict = completeReview(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
    const missing = catalog(payload).filter(unit => [date, "Correction the final budget is $1450.", "We must not buy any new cameras."].includes(unit.text)).map(unit => unit.id);
    verdict.units = verdict.units.map(unit => missing.includes(unit.sourceId) ? { ...unit, status: 'missing', pointIds: [] } : unit);
    return verdict;
  };
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(result.summary).not.toContain(date);
  expect(result.warnings).toContain("The summary could not be verified. Your complete transcript has been kept.");
  expect(result.summaryDocument).toBeNull();
  expect(result.failedFields).toContain("summary");
});

test.each([5, 7])("retains all %s final commitments and exact long source when full discovery exceeds context", async (count) => {
  const tasks = [
    "Alice will prepare the workshop report by Friday.",
    "Bob will contact the workshop supplier by Tuesday.",
    "Clara will test the workshop microphone on Wednesday.",
    "David will print the workshop invitations by Thursday.",
    "Emma will confirm the workshop venue by Monday.",
    "Felix will check the workshop projector on Saturday.",
    "Grace will send the workshop agenda by Sunday.",
  ].slice(0, count);
  const sentences = Array.from({ length: 100 }, (_, index) =>
    `The workshop discussion included background item ${index} about books music holidays weather travel and lunch preferences while everyone shared memories without making any further decisions or assigning any additional work.`);
  tasks.forEach((quote, index) => sentences.splice(8 + index * 15, 0, quote));
  const content = sentences.join(" ");
  // Isolate original-vs-prepared summary capacity here. The model stub emits
  // three sparse IDs per input range and does not simulate reduction.
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ systemPrompt = "", userPrompt }) =>
    userPrompt.startsWith('{"sourceCatalogData"') || userPrompt.startsWith('{"language"') || !systemPrompt && /^\{\s*"facts":/u.test(userPrompt)
      ? 100
      : userPrompt.startsWith('{"sourceCatalogData"') || userPrompt.startsWith('{"language"') ? 100 : Math.ceil((systemPrompt.length + userPrompt.length) / 3) + 12,
  );
  const proof: FinalTaskEvidence = { tasks, evidence: tasks.map((quote) => ({
    id: `task-${content.indexOf(quote)}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  })), superseded: [], warnings: [] };
  jest.mocked(extractTaskEvidence).mockResolvedValue(proof);
  fields.mockImplementation(async (prompt) => {
    if (prompt.includes("Read ALL source statements")) {
      const source = prompt.match(/SOURCE_START\n([\s\S]*?)\nSOURCE_END/)?.[1];
      if (!source) throw new Error("Missing fact source");
      const ids = [...source.matchAll(/^\[(\d+)\] /gmu)].slice(0, 3)
        .map((match) => Number(match[1]));
      return generated(JSON.stringify({ facts: ids }));
    }
    return generated(prompt.includes("Give a title") ? "Workshop" : "Praca");
  });
  scriptedSummary(tasks.map(quote => ({ text: quote, quotes: [quote] })));
  const diagnosticUnits = createSummarySources(content);
  for (const includeFormat of [true, false]) {
    const wire = summaryRelationPageRequest(diagnosticUnits, [1], "en", includeFormat);
    const prompt = wire.request.prompt("");
    const promptTokens = await measureFormattedPromptTokens({ systemPrompt: wire.request.system, userPrompt: prompt, jsonSchema: wire.schema });
    expect(promptTokens + wire.request.nPredict + 24).toBeGreaterThan(8192);
  }
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(result.summary).toBe("");
  expect(result.summaryDocument).toBeNull();
  expect(result.failedFields).toEqual(["summary"]);
  expect(result.warnings).toEqual(["A reliable summary could not be created. Your source note has been kept.",
    "The summary could not be verified. Your complete transcript has been kept."]);
  expect(result.title).toBe("Workshop");
  expect(result.tags).toEqual(["Praca"]);
  expect(extractTaskEvidence).toHaveBeenCalledTimes(1);
  expect(jest.mocked(extractTaskEvidence).mock.calls[0][0]).toBe(content);
  expect(proof.tasks).toEqual(tasks);
  for (const entry of proof.evidence) expect(content.slice(entry.start, entry.end)).toBe(entry.quote);
  tasks.forEach(quote => expect(content).toContain(quote));
  expect(model.mock.calls.some(([prompt]) => prompt.includes("Read ALL source statements"))).toBe(true);
  expect(model.mock.calls.filter(([, , options]) => nativeSummary(options))).toHaveLength(0);
  const discoveryMeasurements = jest.mocked(measureFormattedPromptTokens).mock.calls.filter(([input]) => input.userPrompt.startsWith('{"sourceData"'));
  expect(discoveryMeasurements.length).toBeGreaterThan(0);
  for (const [input] of discoveryMeasurements) {
    expect(JSON.parse(input.userPrompt).sourceData).toEqual(createSummarySources(content).map(unit => ({ source: `S${unit.id}`, text: unit.text })));
  }
});

test.each([5, 7])("verifies all %s actors and deadlines plus final availability across measured bounded windows", async count => {
  const facts = [
    { quote: "Alice will prepare the workshop report by Friday.", text: "Alice: workshop report by Friday." },
    { quote: "Bob will contact the workshop supplier by Tuesday.", text: "Bob: workshop supplier contact by Tuesday." },
    { quote: "Clara will test the workshop microphone on Wednesday.", text: "Clara: workshop microphone test on Wednesday." },
    { quote: "David will print the workshop invitations by Thursday.", text: "David: workshop invitations by Thursday." },
    { quote: "Emma will confirm the workshop venue by Monday.", text: "Emma: workshop venue confirmation by Monday." },
    { quote: "Felix will check the workshop projector on Saturday.", text: "Felix: workshop projector check on Saturday." },
    { quote: "Grace will send the workshop agenda by Sunday.", text: "Grace: workshop agenda by Sunday." },
  ].slice(0, count);
  const background = "People discussed old photographs without making decisions.";
  const statements = Array.from({ length: 51 - count }, () => background);
  facts.forEach((fact, index) => statements.splice(Math.floor(index * 50 / (count - 1)), 0, fact.quote));
  const availability = "On Friday I have no classes.";
  const content = [...statements, availability].join(" ");
  const tasks = facts.map(fact => fact.quote);
  const proof: FinalTaskEvidence = { tasks, evidence: tasks.map(quote => ({ id: `task:${content.indexOf(quote)}`,
    start: content.indexOf(quote), end: content.indexOf(quote) + quote.length, quote, task: quote, kind: "active", importance: 2, change: false })),
    superseded: [], warnings: [] };
  jest.mocked(extractTaskEvidence).mockResolvedValue(proof);
  // Keep the original character-cost formula for every actual schema/prompt;
  // no special cheap summary/discovery path or enlarged model context.
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ systemPrompt = "", userPrompt }) =>
    Math.ceil((systemPrompt.length + userPrompt.length) / 3) + 12);
  fields.mockImplementation(async prompt => generated(prompt.includes("Give a title") ? "Workshop" : "Praca"));
  scriptedSummary([...facts.map(fact => ({ text: fact.text, quotes: [fact.quote] })),
    { text: "Friday: no classes.", quotes: [availability] }]);
  const units = createSummarySources(content);
  const discovery = summaryRelationPageRequest(units, [1], "en", true);
  const promptTokens = await measureFormattedPromptTokens({ systemPrompt: discovery.request.system,
    userPrompt: discovery.request.prompt(""), jsonSchema: discovery.schema });
  expect(promptTokens + discovery.request.nPredict + 24).toBeLessThanOrEqual(8192);
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(result.summary).toBe(facts.map(fact => `• ${fact.text}`).join("\n") + "\n• Friday: no classes.");
  expect(result.summaryDocument?.source).toBe(content);
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(result.title).toBe("Workshop");
  expect(result.tags).toEqual(["Praca"]);
  expect(proof.tasks).toEqual(tasks);
  expect(proof.tasks).not.toContain(availability);
  for (const entry of proof.evidence) expect(content.slice(entry.start, entry.end)).toBe(entry.quote);
  const drafts = model.mock.calls.filter(([, , options]) => Array.isArray(options?.jsonSchema?.anyOf));
  expect(drafts.length).toBeGreaterThan(1);
  const initialDrafts = drafts.filter(([prompt]) => {
    const payload = JSON.parse(prompt) as { repairData?: unknown; reconciliationData?: unknown };
    return !payload.repairData && !payload.reconciliationData;
  });
  expect(initialDrafts.length).toBeGreaterThan(1);
  expect(initialDrafts.flatMap(([prompt]) => catalog(JSON.parse(prompt) as SummaryPayload).map(unit => unit.id))).toEqual(units.map(unit => unit.id));
  const draftScopes = drafts.map(([prompt]) => (JSON.parse(prompt) as SummaryPayload).sourceCatalogData);
  expect(new Set(draftScopes).size).toBeGreaterThan(1);
  const seen = draftScopes.flatMap(sourceCatalogData => catalog({ sourceCatalogData }).map(unit => unit.text));
  for (const quote of [...tasks, availability]) expect(seen).toContain(quote);
  const relations = model.mock.calls.filter(([, , options]) => "rows" in ((options?.jsonSchema?.properties ?? {}) as object));
  expect(relations.length).toBeGreaterThan(0);
  for (const [prompt] of relations) {
    expect(JSON.parse(prompt).sourceData).toEqual(units.map(unit => ({ source: `S${unit.id}`, text: unit.text })));
  }
});

test.each(['final-only', 'with-object', 'with-replacement'].flatMap((citation) => [
  { citation, final: "Correction, the final approved production budget is 1450 dollars." },
  { citation, final: "Correction the final approved production budget is 1450 dollars." },
]))("keeps the final amount and date with grounded correction citations: $citation / $final", async ({ citation, final }) => {
  const tasks = ["Maya will prepare the first episode outline by Thursday.", "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "The north studio reservation was canceled so we must use the south studio for the recording."];
  const policy = "We will use the microphones that we already have and we must not buy any new cameras.";
  const event = "The next editorial review is on November 8 at 2 in the afternoon.";
  const content = ["These are planning notes for the community podcast.", tasks[0], tasks[1], "The original production budget was 900 dollars.",
    "We discussed the local archive and historical photographs without making further decisions or assigning any additional work.", tasks[2],
    final, "This final amount replaces the earlier budget of 900 dollars.", tasks[3], policy, event,
    "The discussion continued with unrelated topics about music, weather, holidays and travel while everyone shared memories and personal opinions without assigning any additional work."].join(" ");
  jest.mocked(extractTaskEvidence).mockResolvedValue({ tasks, evidence: tasks.map((quote) => ({
    id: `task-${content.indexOf(quote)}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  })), superseded: [], warnings: [] });
  fields.mockResolvedValueOnce(generated("Community podcast"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Community podcast: Maya prepares the first episode outline by Thursday.', quotes: ['These are planning notes for the community podcast.', tasks[0]] },
    { text: 'Daniel: contact the guest speaker by Tuesday.', quotes: [tasks[1]] },
    { text: 'Nora: updated guest list to Maya before Wednesday.', quotes: [tasks[2]] },
    { text: 'Final production budget: 1450 dollars.', quotes: [final, ...(citation === 'with-object' ? ['The original production budget was 900 dollars.'] : citation === 'with-replacement' ? ['This final amount replaces the earlier budget of 900 dollars.'] : [])] },
    { text: 'North studio canceled; use the south studio.', quotes: [tasks[3]] },
    { text: 'Use existing microphones; no new cameras.', quotes: [policy] },
    { text: 'Editorial review: November 8 at 2 in the afternoon.', quotes: [event] },
  ]);
  summaryReview = payload => {
    const verdict = completeReview(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
    const old = catalog(payload).find(unit => unit.text === 'The original production budget was 900 dollars.');
    const current = catalog(payload).find(unit => unit.text === final);
    if (old && current) verdict.units = verdict.units.map(unit => unit.sourceId === old.id ? { ...unit, status: 'superseded', pointIds: [], supersededBy: [current.id] } : unit);
    return verdict;
  };
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(result.summary).toBe("• Community podcast: Maya prepares the first episode outline by Thursday.\n• Daniel: contact the guest speaker by Tuesday.\n• Nora: updated guest list to Maya before Wednesday.\n• Final production budget: 1450 dollars.\n• North studio canceled; use the south studio.\n• Use existing microphones; no new cameras.\n• Editorial review: November 8 at 2 in the afternoon.");
  expect(result.summaryDocument?.source).toBe(content);
  expect(result.summaryDocument?.points[0].sources.map(range => content.slice(range.start, range.end)))
    .toEqual(['These are planning notes for the community podcast.', tasks[0]]);
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
});

test("restores one current next review when the valid model selection omits its source quote", async () => {
  const tasks = ["Maya will prepare the first episode outline by Thursday.", "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "The north studio reservation was canceled so we must use the south studio for the recording."];
  const final = "Correction, the final approved production budget is 1450 dollars.";
  const policy = "We will use the microphones that we already have and we must not buy any new cameras.";
  const event = "The next editorial review is on November 8 at 2 in the afternoon.";
  const content = ["These are planning notes for the community podcast.", tasks[0], tasks[1], "The original production budget was 900 dollars.",
    "We discussed the local archive and historical photographs without making further decisions or assigning any additional work.", tasks[2],
    final, "This final amount replaces the earlier budget of 900 dollars.", tasks[3], policy, event,
    "The discussion continued with unrelated topics about music, weather, holidays and travel while everyone shared memories and personal opinions without assigning any additional work."].join(" ");
  jest.mocked(extractTaskEvidence).mockResolvedValue({ tasks, evidence: tasks.map((quote) => ({
    id: `task-${content.indexOf(quote)}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  })), superseded: [], warnings: [] });
  fields.mockResolvedValueOnce(generated("Community podcast"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Community podcast: Maya prepares the first episode outline by Thursday.', quotes: ['These are planning notes for the community podcast.', tasks[0]] },
    { text: 'Daniel: contact the guest speaker by Tuesday.', quotes: [tasks[1]] },
    { text: 'Nora: updated guest list to Maya before Wednesday.', quotes: [tasks[2]] },
    { text: 'Final production budget: 1450 dollars.', quotes: [final] },
    { text: 'North studio canceled; use the south studio.', quotes: [tasks[3]] },
    { text: 'Use existing microphones; no new cameras.', quotes: [policy] },
    { text: 'Editorial review: November 8 at 2 in the afternoon.', quotes: [event] },
  ]);
  const pathway: { kind: string; eventPresent?: boolean; eventStatus?: string }[] = [];
  const completeDraft = summaryDraft!;
  summaryDraft = payload => {
    let draft = completeDraft(payload)!;
    const eventId = catalog(payload).find(unit => unit.text === event)!.id;
    if (!payload.repairData) {
      draft = { ...draft, points: draft.points.filter(point => !point.sourceIds.includes(eventId)) };
    } else {
      expect(payload.repairData.draft.points.some(point => point.sourceIds.includes(eventId))).toBe(false);
      expect(payload.repairData.verification).toMatchObject({ units: expect.arrayContaining([
        { sourceId: eventId, status: 'missing', pointIds: [], supersededBy: [] },
      ]) });
    }
    pathway.push({ kind: payload.repairData ? 'repair' : 'draft', eventPresent: draft.points.some(point => point.sourceIds.includes(eventId)) });
    return draft;
  };
  summaryReview = payload => {
    const verdict = completeReview(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
    const old = catalog(payload).find(unit => unit.text === 'The original production budget was 900 dollars.');
    const current = catalog(payload).find(unit => unit.text === final);
    if (old && current) verdict.units = verdict.units.map(unit => unit.sourceId === old.id ? { ...unit, status: 'superseded', pointIds: [], supersededBy: [current.id] } : unit);
    const eventId = catalog(payload).find(unit => unit.text === event)!.id;
    verdict.units = verdict.units.map(unit => unit.sourceId === eventId && !unit.pointIds.length ? { ...unit, status: 'missing' } : unit);
    if (payload.checkTargetsData!.sourceIds.includes(eventId))
      pathway.push({ kind: 'review', eventStatus: verdict.units.find(unit => unit.sourceId === eventId)!.status });
    return verdict;
  };
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en");
  expect(pathway).toEqual([
    { kind: 'draft', eventPresent: false }, { kind: 'review', eventStatus: 'missing' },
    { kind: 'repair', eventPresent: true }, { kind: 'review', eventStatus: 'covered' },
  ]);
  expect(result.summary).toBe("• Community podcast: Maya prepares the first episode outline by Thursday.\n• Daniel: contact the guest speaker by Tuesday.\n• Nora: updated guest list to Maya before Wednesday.\n• Final production budget: 1450 dollars.\n• North studio canceled; use the south studio.\n• Use existing microphones; no new cameras.\n• Editorial review: November 8 at 2 in the afternoon.");
  expect(result.summaryDocument?.source).toBe(content);
  expect(result.summaryDocument?.points[0].sources.map(range => content.slice(range.start, range.end)))
    .toEqual(['These are planning notes for the community podcast.', tasks[0]]);
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
});

test("passes final task evidence and its partial warnings to the independent summary review", async () => {
  const content = "We discussed the report and assorted unrelated introductory topics. Alice will prepare the report by Friday. Bob will contact the supplier by Tuesday. The final budget is 1750 dollars. The next meeting is on Monday at 10:00. We spent the rest of the meeting discussing books, travel destinations, the weather and plans for various holidays without any further decisions.";
  const quote = "Bob will contact the supplier by Tuesday.";
  const proof: FinalTaskEvidence = { tasks: [quote], evidence: [{
    id: "task-bob", start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
    quote, task: quote, kind: "active", importance: 2, change: false,
  }], superseded: [], warnings: ["Unresolved task change"] };
  jest.mocked(extractTaskEvidence).mockResolvedValue(proof);
  fields.mockResolvedValueOnce(generated("Report budget"))
    .mockResolvedValueOnce(generated("Praca"));
  summaryReview = payload => {
    expect(payload.taskEvidenceData).toEqual(proof);
    return completeReview(payload);
  };
  const result = await processNoteWithLlm(content, () => undefined, undefined, "en", { taskEvidenceMemo: {} });
  expect(result.summary).toContain(quote);
  expect(result.summary).toContain("The next meeting is on Monday at 10:00.");
  expect(result.failedFields).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(proof.warnings).toEqual(["Unresolved task change"]);
});

test.each(["Checkpoint failed", "Callback failed", "Task evidence runtime changed during processing"])("propagates task-proof infrastructure failure before summary generation: %s", async (message) => {
  jest.mocked(extractTaskEvidence).mockRejectedValue(new Error(message));
  const content = "Alice will prepare the report by Friday. Bob will contact the supplier by Tuesday. We spent the remainder of the meeting discussing assorted unrelated introductory topics, books and the weather without reaching any further decisions.";
  await expect(processNoteWithLlm(content, () => undefined, undefined, "en")).rejects.toThrow(message);
  expect(model).not.toHaveBeenCalled();
});

test.each([false, true])("isolates an oversized optional title rewrite from other fields (rewrite needed: %s)", async (rewriteNeeded) => {
  const source = "Workshop budget remains unchanged for this week.";
  jest.mocked(measureFormattedPromptTokens).mockImplementation(async ({ userPrompt }) =>
    userPrompt.startsWith("/no_think\nFirst select") && userPrompt.includes(source)
      ? 8192
      : 100,
  );
  fields.mockResolvedValueOnce(generated(rewriteNeeded ? "Budget repayment" : "Workshop budget"));
  fields.mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.tags).toEqual(["Praca"]);
  expect(result.summary).toBe("• Workshop budget remains unchanged for this week.");
  expect(model).toHaveBeenCalledTimes(4);
  if (rewriteNeeded) {
    expect(result.failedFields).toEqual(["title"]);
    expect(result.warnings).toHaveLength(1);
  } else {
    expect(result.title).toBe("Workshop budget");
    expect(result.warnings).toBeUndefined();
  }
});

test("reuses the exact custom warm context without reporting a model load", async () => {
  const status = jest.fn(),
    loaded = jest.fn();
  expect(
    await ensureModelReady(status, loaded, {
      runtimeOptions: { modelPath: "/benchmark.gguf", speculative: true },
    }),
  ).toBeNull();
  expect(status).not.toHaveBeenCalled();
  expect(loaded).not.toHaveBeenCalled();
  expect(loadModel).not.toHaveBeenCalled();
});

test("loads the application default when a different benchmark context is resident", async () => {
  jest.mocked(isModelLoadedFor).mockReturnValue(false);
  await ensureModelReady(() => undefined);
  expect(loadModel).toHaveBeenCalledWith(
    "/default.gguf",
    expect.any(Function),
    expect.any(Object),
  );
});

test("generates an English title and summary while keeping category IDs canonical", async () => {
  const content =
    "No meeting is planned for Friday. Alice needs the client report by Thursday and Bob will review the invoice on Monday. We also discussed the budget for next month and agreed to prepare a shorter report for the team.";
  fields
    .mockResolvedValueOnce(generated("Title: No meeting on Friday"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Friday: no meeting.', quotes: ['No meeting is planned for Friday.'] },
    { text: 'Alice needs the client report by Thursday; Bob reviews the invoice on Monday.', quotes: ['Alice needs the client report by Thursday and Bob will review the invoice on Monday.'] },
    { text: 'Next-month budget discussed; shorter team report agreed.', quotes: ['We also discussed the budget for next month and agreed to prepare a shorter report for the team.'] },
  ]);
  const result = await processNoteWithLlm(
    content,
    () => undefined,
    undefined,
    "en",
  );
  expect(result).toMatchObject({
    title: "No meeting on Friday",
    summary:
      "• Friday: no meeting.\n• Alice needs the client report by Thursday; Bob reviews the invoice on Monday.\n• Next-month budget discussed; shorter team report agreed.",
    tags: ["Praca"],
  });
  expect(model.mock.calls[0][0]).toContain("sourceCatalogData");
  expect(model.mock.calls[0][2]?.system).toContain("English");
  expect(model.mock.calls[2][0]).toContain("Give a title");
  expect(model.mock.calls[2][2]?.system).toContain("English");
  expect(model.mock.calls[3][0]).toContain("Praca: carrying out or coordinating organized projects");
  expect(model.mock.calls[3][2]?.jsonSchema).toMatchObject({
    required: ["purposeId", "category"],
    properties: { category: { enum: expect.arrayContaining(["Praca", "Nauka", "brak"]) } },
  });
});

test("extracts English tasks in the note language", async () => {
  fields.mockResolvedValueOnce(
    generated(
      JSON.stringify({
        tasks: [
          { id: 1, kind: "active" },
          { id: 2, kind: "active" },
        ],
      }),
    ),
  );
  await expect(
    extractTasks("Note the invoice number. Call Alice.", () => undefined, "en"),
  ).resolves.toEqual(["Note the invoice number.", "Call Alice."]);
  expect(model.mock.calls[0][0]).toContain("Note the invoice number.");
  expect(model.mock.calls[0][2]?.system).toContain("English");
});

test("rejects cancellation without committing a summary or starting later fields", async () => {
  const controller = new AbortController();
  model.mockImplementationOnce(async () => {
    controller.abort();
    return generated("A client report is needed.");
  });
  await expect(
    processNoteWithLlm(
      "Alice needs the client report by Thursday and Bob will review the invoice on Monday. We also discussed the budget for next month and agreed to prepare a shorter report for the team.",
      () => undefined,
      undefined,
      "en",
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(model).toHaveBeenCalledTimes(1);
});

test("keeps a valid title and categories when summary generation fails", async () => {
  fields
    .mockResolvedValueOnce(generated("Client report and invoice"))
    .mockResolvedValueOnce(generated("Praca"));
  const content =
    "Alice needs the client report by Thursday and Bob will review the invoice on Monday. We also discussed the budget for next month and agreed to prepare a shorter report for the team. We spent half an hour discussing unrelated books and travel without reaching any further decisions.";
  summaryDraft = () => null;
  const result = await processNoteWithLlm(
    content,
    () => undefined,
    undefined,
    "en",
  );
  expect(result).toEqual(
    expect.objectContaining({
      title: "Client report and invoice",
      summary: "",
      summaryDocument: null,
      failedFields: ["summary"],
      tags: ["Praca"],
    }),
  );
  expect(result.warnings).toEqual(expect.arrayContaining([expect.any(String)]));
});

test("rejects a fluent but invented connection between a cancellation and the budget", async () => {
  const content =
    "Rozmawialiśmy przez dłuższy czas o salach i planach na warsztaty. Marta przygotuje materiały do piątku. Budżet wynosi 1200 złotych. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.";
  fields
    .mockResolvedValueOnce(generated("Budżet warsztatów"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([{ text: 'Anulowanie sali zastąpiło budżet kwotą 1750 zł.', quotes: ['Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej.', 'Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.'] }]);
  summaryReview = payload => ({
    points: payload.draftData!.points.map((_, index) => ({ pointId: index + 1, status: 'unsupported', issues: ['correction'] })),
    units: catalog(payload).map(unit => ({ sourceId: unit.id, status: 'uncertain', pointIds: [], supersededBy: [] })),
  });
  const result = await processNoteWithLlm(content, () => undefined);
  expect(result.summary).toBe("");
  expect(result.failedFields).toContain("summary");
});

test("retains the final source correction after independent summary verification and keeps later fields usable", async () => {
  const content =
    "Rozmawialiśmy przez dłuższy czas o salach i planach na warsztaty. Marta przygotuje materiały do piątku. Budżet wynosi 1200 złotych. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych. Później długo rozmawialiśmy o pogodzie i książkach bez dalszych ustaleń.";
  fields
    .mockResolvedValueOnce(generated("Budżet warsztatów"))
    .mockResolvedValueOnce(generated("Praca"));
  scriptedSummary([
    { text: 'Rozmowa o salach i planach warsztatów; Marta: materiały do piątku.', quotes: ['Rozmawialiśmy przez dłuższy czas o salach i planach na warsztaty.', 'Marta przygotuje materiały do piątku.'] },
    { text: 'Końcowy budżet: 1750 złotych.', quotes: ['Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.'] },
  ]);
  summaryReview = payload => {
    const verdict = completeReview(payload) as { points: unknown[]; units: { sourceId: number; status: string; pointIds: number[]; supersededBy: number[] }[] };
    verdict.units = verdict.units.map(unit => unit.sourceId === 3 ? { ...unit, status: 'superseded', supersededBy: [4] } : unit);
    return verdict;
  };
  const result = await processNoteWithLlm(content, () => undefined);
  expect(result.summary).toBe(
    "• Rozmowa o salach i planach warsztatów; Marta: materiały do piątku.\n• Końcowy budżet: 1750 złotych.",
  );
  expect(result.summaryDocument?.source).toBe(content);
  expect(result.summaryDocument?.points[0].sources.map(range => content.slice(range.start, range.end)))
    .toEqual(['Rozmawialiśmy przez dłuższy czas o salach i planach na warsztaty.', 'Marta przygotuje materiały do piątku.']);
  expect(result.tags).toEqual(["Praca"]);
  expect(result.failedFields).toBeUndefined();
  expect(model).toHaveBeenCalledTimes(4);
});

test("rejects an invented title deadline while preserving an exact source fallback", async () => {
  fields
    .mockResolvedValueOnce(generated("Client report by Friday"))
    .mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(
    "Alice needs the client report by Thursday.",
    () => undefined,
    undefined,
    "en",
  );
  expect(result.title).toBe("Alice needs the client report by");
  expect(result.failedFields).toContain("title");
});

const workshopSource =
  "Notatka ze spotkania zespołu biblioteki. Rozmawialiśmy o jesiennych warsztatach, rezerwacji sal i poprawie informacji dla czytelników. Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek. Budżet pierwszych warsztatów wynosi 1200 złotych. Nie zamówimy nowych laptopów, ponieważ obecny sprzęt wystarczy. Spotkanie podsumowujące odbędzie się 12 października o godzinie 10:00. Nie ustaliliśmy jeszcze liczby uczestników. Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.\n\nNa zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.";

test("repairs the iPhone repayment title from the whole workshop source", async () => {
  scriptedSummary([
    { text: "Jesienne warsztaty biblioteki, rezerwacje sal i informacja dla czytelników.", quotes: ["Notatka ze spotkania zespołu biblioteki.", "Rozmawialiśmy o jesiennych warsztatach, rezerwacji sal i poprawie informacji dla czytelników."] },
    { text: "Marta: materiały do piątku; Piotr: telefon do prowadzącego we wtorek.", quotes: ["Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek."] },
    { text: "Bez nowych laptopów; obecny sprzęt wystarczy.", quotes: ["Nie zamówimy nowych laptopów, ponieważ obecny sprzęt wystarczy."] },
    { text: "Spotkanie: 12 października, 10:00.", quotes: ["Spotkanie podsumowujące odbędzie się 12 października o godzinie 10:00."] },
    { text: "Liczba uczestników nieustalona.", quotes: ["Nie ustaliliśmy jeszcze liczby uczestników."] },
    { text: "Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.", quotes: ["Sprawdzę dostępność większej sali przed wysłaniem zaproszeń."] },
    { text: "Poprawiony harmonogram do Anny przed środą.", quotes: ["Na zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą."] },
    { text: "Czerwona sala anulowana; użyć zielonej.", quotes: ["Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej."] },
    { text: "Końcowy budżet: 1750 złotych.", quotes: ["Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych."] },
  ]);
  summaryReview = payload => {
    const verdict = completeReview(payload) as SummaryVerification;
    return { ...verdict, units: verdict.units.map(unit => unit.sourceId === 4
      ? { ...unit, status: "superseded", pointIds: [], supersededBy: [11] } : unit) };
  };
  fields
    .mockResolvedValueOnce(generated("<think>\n\n</think>\n\nSpłata budżetu"))
    .mockResolvedValueOnce(
      generated(
        JSON.stringify({
          title: "Jesienne warsztaty biblioteki",
          anchors: [1, 2],
        }),
      ),
    )
    .mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(workshopSource, () => undefined);
  expect(result.title).toBe("Jesienne warsztaty biblioteki");
  expect(result.failedFields).toBeUndefined();
  expect(result.tags).toEqual(["Praca"]);
  expect(result.summary).toBe("• Jesienne warsztaty biblioteki, rezerwacje sal i informacja dla czytelników.\n• Marta: materiały do piątku; Piotr: telefon do prowadzącego we wtorek.\n• Bez nowych laptopów; obecny sprzęt wystarczy.\n• Spotkanie: 12 października, 10:00.\n• Liczba uczestników nieustalona.\n• Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.\n• Poprawiony harmonogram do Anny przed środą.\n• Czerwona sala anulowana; użyć zielonej.\n• Końcowy budżet: 1750 złotych.");
  expect(result.summaryDocument?.source).toBe(workshopSource);
  const rewrite = model.mock.calls.find(([, , options]) => options?.nPredict === 160)!;
  expect(rewrite[0]).toContain("1750");
  expect(rewrite[0]).toContain("sali zielonej");
});

test.each([
  {
    language: "pl" as const,
    source: "Biblioteka przygotuje jesienne warsztaty dla czytelników.",
    title: "Organizacja jesiennych warsztatów",
    rewritten: "Jesienne warsztaty biblioteki",
    anchors: [1],
  },
  {
    language: "en" as const,
    source: "Alice will pay off the loan this month.",
    title: "Alice's debt repayment",
    rewritten: "Alice's loan this month",
    anchors: [1],
  },
])("rewrites a paraphrase with source anchors without discarding its topic in $language", async (fixture) => {
  fields
    .mockResolvedValueOnce(generated(fixture.title))
    .mockResolvedValueOnce(
      generated(
        JSON.stringify({ title: fixture.rewritten, anchors: fixture.anchors }),
      ),
    )
    .mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(
    fixture.source,
    () => undefined,
    undefined,
    fixture.language,
  );
  expect(result.title).toBe(fixture.rewritten);
  expect(result.failedFields).toBeUndefined();
  expect(result.tags).toEqual(["Praca"]);
});

test.each([
  '{"anchors":[1],"title":"Debt settlement"}',
  '{"anchors":[2],"title":"Invoice payment"}',
  '{"anchors":[1],"title":"Invoice 900 payment"}',
])("uses the source fallback after one invalid title grounding response", async (response) => {
  fields
    .mockResolvedValueOnce(generated("Debt settlement"))
    .mockResolvedValueOnce(generated(response))
    .mockResolvedValueOnce(generated("Praca"));
  const result = await processNoteWithLlm(
    "The invoice is due on Thursday.",
    () => undefined,
    undefined,
    "en",
  );
  expect(result.title).toBe("The invoice is due on Thursday");
  expect(result.failedFields).toEqual(["title"]);
  expect(result.tags).toEqual(["Praca"]);
  expect(model).toHaveBeenCalledTimes(5);
});

test.each([
  "Alice needs the client report by Thursday and Bob will review the invoice on Monday while we continue discussing the budget for next month and prepare a shorter version for the team",
  "Alice needs the client report by Thursday and Bob will review the invoice on Monday. We discussed the budget for next month and agreed to prepare a shorter version for the entire team.",
])(
  "summarizes sparse sources independently of old extractive compression eligibility",
  async (content) => {
    if (!content.includes(". ")) fields.mockResolvedValueOnce(generated(content)).mockResolvedValueOnce(generated(content));
    fields
      .mockResolvedValueOnce(generated("Client report and invoice"))
      .mockResolvedValueOnce(generated("Praca"));
    scriptedSummary([
      { text: 'Alice needs the client report by Thursday; Bob reviews the invoice on Monday.', quotes: [content.split('. ')[0] + (content.includes('. ') ? '.' : '')] },
      { text: 'Next-month budget discussed; shorter team report agreed.', quotes: [content.includes('. ') ? 'We discussed the budget for next month and agreed to prepare a shorter version for the entire team.' : content] },
    ]);
    const result = await processNoteWithLlm(
      content,
      () => undefined,
      undefined,
      "en",
    );
    expect(result.title).toBe("Client report and invoice");
    expect(result.summary).toContain("• Alice needs the client report by Thursday; Bob reviews the invoice on Monday.");
    expect(result.tags).toEqual(["Praca"]);
    expect(result.failedFields ?? []).toEqual([]);
    expect(model).toHaveBeenCalledTimes(content.includes(". ") ? 4 : 6);
  },
);

test("repairs the actual English debt title without adding an absent plan", async () => {
  const source = "We reviewed repayment of the bank loan. The debt is 12000 pounds.";
  fields
    .mockResolvedValueOnce(generated("Debt Repayment Plan"))
    .mockResolvedValueOnce(generated('{"anchors":[1,2],"title":"Debt repayment"}'))
    .mockResolvedValueOnce(generated("Finanse"));
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.title).toBe("Debt repayment");
  expect(result.failedFields).toBeUndefined();
  expect(model.mock.calls[3][0]).toContain('"supportedWords":["Debt","Repayment"]');
  expect(model.mock.calls[3][2]?.temperature).toBe(0.1);
  expect(model.mock.calls[3][2]?.jsonSchema).toBeDefined();
});

const physicalV10Source = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they show. The difference between a clear story and a collection of unrelated facts Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday. The list contains the names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker and the updated guest list. Are the topics for that review";

// Exact physical v10 source/raw selections; generation is the only AI boundary
// stub. The actual evidence parser, bounded correction, task proof and summary
// merge run together. No registered reference is supplied to this path.
test("restores the physical v10 terminal assignment through model correction while preserving incomplete ASR and checkpoint warnings", async () => {
  const actualTasks = jest.requireActual<typeof import("./taskExtraction")>("./taskExtraction");
  jest.mocked(extractTaskEvidence).mockImplementation(actualTasks.extractTaskEvidence);
  const saved = new Map<string, unknown>();
  const checkpoint = {
    read: async (key: string) => saved.get(key) ?? null,
    write: async (key: string, value: unknown) => { saved.set(key, value); },
  };
  const onWarning = jest.fn();
  const execution = { checkpoint, onWarning, taskEvidenceMemo: {} };
  fields.mockResolvedValueOnce(generated('{"tasks":[{"id":17,"kind":"active"},{"id":25,"kind":"cancelled"},{"id":26,"kind":"active"},{"id":27,"kind":"active"},{"id":28,"kind":"uncertain"}]}'));
  // This smaller physical source falls below the measured prefix-cost gate;
  // retain the original complete task-proof-before-summary sequence.
  fields.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"uncertain"},{"id":6,"kind":"active"},{"id":25,"kind":"active"}]}'));
  fields.mockResolvedValueOnce(generated("Community Podcast Planning"));
  fields.mockResolvedValueOnce(generated("Nauka"));
  summaryDraft = () => null;
  const result = await processNoteWithLlm(physicalV10Source, () => undefined, undefined, "en", execution);
  const required = [
    "The difference between a clear story and a collection of unrelated facts Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "Correction the final approved production budget is $1450.",
    "The north studio reservation was canceled so we must use the south studio for the recording.",
    "We will use the microphones that we already have and we must not buy any new cameras.",
    "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker and the updated guest list.",
  ];
  expect(result.summary).toBe("");
  expect(result.summaryDocument).toBeNull();
  expect(result.summary).not.toContain("This final amount replaces");
  expect(result.summary).not.toContain("Maya will prepare");
  expect(result.summary.trim().split(/\s+/u).length).toBeLessThan(physicalV10Source.trim().split(/\s+/u).length * 0.8);
  expect(result.failedFields).toEqual(["summary"]);
  expect(result.warnings).toHaveLength(2);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(model).toHaveBeenCalledTimes(6);
  const proof = await actualTasks.extractTaskEvidence(physicalV10Source, () => undefined, "en", execution);
  expect(proof.tasks).toEqual([required[0], required[1], required[3], required[4]]);
  expect(proof.evidence.every((entry) => physicalV10Source.slice(entry.start, entry.end) === entry.quote)).toBe(true);
  expect(proof.warnings).toHaveLength(1);
  expect(proof.tasks).not.toContain(required[5]);
  const completed = await checkpoint.read(`tasks:0:${physicalV10Source.length}`) as { warnings: string[]; unresolved: { id: number }[] };
  expect(completed.warnings).toHaveLength(1);
  expect(completed.unresolved.map((issue) => issue.id)).toEqual([2]);
  model.mockClear(); onWarning.mockClear();
  // Fresh invocation memo exercises durable evidence, not only same-run cache.
  await expect(actualTasks.extractTaskEvidence(physicalV10Source, () => undefined, "en", { checkpoint, onWarning, taskEvidenceMemo: {} })).resolves.toEqual(proof);
  expect(model).not.toHaveBeenCalled();
  expect(onWarning).toHaveBeenCalledTimes(1);
});
