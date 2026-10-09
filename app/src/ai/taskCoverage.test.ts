import { generate, measureFormattedPromptTokens } from "./llm";
import { collectSourceEvidence, getClosedPolishJoinedCurrentWitness } from "./sourcePipeline";
import type { ProcessingCheckpointStore } from "./processingContext";

jest.mock("./llm", () => ({
  generate: jest.fn(),
  getContextWindowSize: () => 8192,
  getLoadedModelInfo: () => null,
  measureFormattedPromptTokens: jest.fn(async () => 100),
}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);
const measurePrompt = jest.mocked(measureFormattedPromptTokens);
const generated = (text: string) => ({
  text, ttftMs: 1, tokensPerSecond: 20, wallMs: 2, promptMs: 1,
  predictedMs: 1, promptTokens: 100, predictedTokens: 2,
  completion: {
    status: "complete" as const, truncated: false, stoppedLimit: false,
    contextFull: false, interrupted: false, stoppedEos: true, stoppingWord: "",
  },
});
const checkpointStore = (): ProcessingCheckpointStore => {
  const entries = new Map<string, unknown>();
  return {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, value) => { entries.set(key, value); },
  };
};
const sourceOf = (prompt: string): string =>
  prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];

// Literal source units from the physical v13 audio30 run, not its reference.
const actualNora = "This was background discussion about existing material rather than a new assignment to rewrite all the documents in the archive Nora will send the updated guest list to Maya before Wednesday.";
const actualMalformedActor = "The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday.";
const existingDaniel = "Daniel will contact the guest speaker by Tuesday.";

beforeEach(() => {
  model.mockReset();
  measurePrompt.mockReset();
  measurePrompt.mockResolvedValue(100);
});

const literalActionClauses = (prompt: string): {
  id: number; start: number; end: number; quote: string;
}[] => {
  expect(prompt).toContain("LITERAL_ACTION_CLAUSES_START\n");
  const block = prompt.split("LITERAL_ACTION_CLAUSES_START\n")[1]
    .split("\nLITERAL_ACTION_CLAUSES_END")[0];
  return block.split("\n").map((line) => JSON.parse(line) as {
    id: number; start: number; end: number; quote: string;
  });
};

describe("current action joined to a completed source clause", () => {
  const joined = [
    { language: "pl" as const, source: "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem." },
    { language: "en" as const, source: "Eliza completed the archive cleanup yesterday and will verify the current cost by Friday." },
    { language: "pl" as const, source: "Hana sprawdziła dokument w poniedziałek i przygotuje nowy raport do czwartku." },
    { language: "en" as const, source: "Nina finished the old draft yesterday but will send the updated report before Tuesday." },
  ];
  describe.each(joined)("$language $source", ({ language, source }) => {
    test.each(["omitted", "uncertain", "cancelled"] as const)("repairs %s using the complete source, then resumes exactly once", async (kind) => {
      model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: kind === "omitted" ? [] : [{ id: 1, kind }] })));
      model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
      const checkpoint = checkpointStore();
      const warning = jest.fn();
      const execution = { checkpoint, onWarning: warning };
      const expected = [expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "active" })];
      await expect(collectSourceEvidence(source, "tasks", language, execution)).resolves.toEqual(expected);
      expect(model).toHaveBeenCalledTimes(2);
      expect(sourceOf(model.mock.calls[1][0])).toBe("[1] " + source);
      expect(warning).not.toHaveBeenCalled();
      model.mockClear();
      await expect(collectSourceEvidence(source, "tasks", language, execution)).resolves.toEqual(expected);
      expect(model).not.toHaveBeenCalled();
    });

    test("does not infer an explicit owner from a bare capitalized token after an uncertain retry", async () => {
      model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
      const warning = jest.fn();
      const review = jest.fn();
      await expect(collectSourceEvidence(source, "tasks", language, { onWarning: warning, onSourceReview: review })).resolves.toEqual([]);
      expect(model).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(review).toHaveBeenCalledWith(expect.objectContaining({ quote: source, start: 0, end: source.length }));
    });
  });

  test.each([
    "If Nina finished the draft she will send the report by Friday.",
    '"Nina finished the draft and will send the report by Friday".',
    "Nina finished the draft and might send the report by Friday.",
    "Nina finished the draft and will not send the report by Friday.",
    "Nina finished the draft according to an old report and will send the report by Friday.",
    "My finished the draft and will send the report by Friday.",
    "Jeśli Hana sprawdziła dokument, przygotuje raport do czwartku.",
    "Hana sprawdziła dokument i nie przygotuje raportu do czwartku.",
    "Hana sprawdziła dokument i podobno przygotuje raport do czwartku.",
    "Hana sprawdziła dokument i przygotowała raport do czwartku.",
  ])("does not mandate an omitted qualified, negated, ambiguous or completed sentence: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "pl", { onWarning: warning })).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });
});

describe("closed Polish completed-plus-current witness", () => {
  test.each([
    "Klient zakończył archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Kierowniczka sprawdziła dokument w poniedziałek i przygotuje nowy raport do czwartku.",
    "Koordynatorka przygotowała poprzedni raport i wyśle aktualną listę do wtorku.",
  ])("proves exact explicit subject and both full contiguous clauses without rewriting them: %s", (source) => {
    const proof = getClosedPolishJoinedCurrentWitness(source);
    expect(proof).not.toBeNull();
    for (const span of [proof!.owner, proof!.completed, proof!.current]) expect(source.slice(span.start, span.end)).toBe(span.text);
    expect(proof!.owner.start).toBe(0);
    expect(proof!.completed.text).toContain(proof!.owner.text);
    expect(proof!.current.end).toBe(source.length);
  });

  test.each([
    "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Niedawno zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Ostatnio zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Prawdopodobnie zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Zwykle zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Kiedyś zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Wtedy zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Natychmiast zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Cicho zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Głośno zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Spokojnie zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Przedwczoraj zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Przedtem zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Znowu zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Tymczasem zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Niegdyś zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Nadal zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Pewnie zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Przypuszczalnie zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Jeśli klient zakończył archiwizację wczoraj, sprawdzi aktualny koszt przed piątkiem.",
    "Klient zakończył archiwizację wczoraj i podobno sprawdzi aktualny koszt przed piątkiem.",
    "Klient zakończył archiwizację wczoraj i nie sprawdzi aktualnego kosztu przed piątkiem.",
    "Klient zakończył archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem jeśli będzie zgoda.",
    '"Klient zakończył archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem".',
    "Klient zakończył archiwizację wczoraj i sprawdzi koszt chyba przed piątkiem.",
    "Klient zakończył archiwizację wczoraj i sprawdzi koszt projektu przed piątkiem.",
    "Klient zakończył archiwizację wczoraj i sprawdzi koszt przed 2026-12-09.",
    "Jeśli Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Wczoraj zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Dziś zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Rano wysłała raport i sprawdzi aktualny koszt przed piątkiem.",
    "Później zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Następnie zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Teraz zakończyła archiwizację i sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi koszt chyba przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi koszt projektu przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi koszt przed 2026-12-09.",
    "Alicja zakończyła raport firma poleci i sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i podobno sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i nie sprawdzi aktualnego kosztu przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem jeśli będzie zgoda.",
    '"Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem".',
    "Alicja powiedziała, że zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "My zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Moja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Alicja i Bruno zakończyli archiwizację wczoraj i sprawdzą aktualny koszt przed piątkiem.",
    "Alicja Nowak zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyłam archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i Bruno sprawdzi aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem?",
    "Alicja zakończyła archiwizację wczoraj i planuje sprawdzić aktualny koszt przed piątkiem.",
    "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem albo kupi sprzęt.",
  ])("does not prove or promote a qualified/ambiguous/non-closed current scope: %s", async (source) => {
    expect(getClosedPolishJoinedCurrentWitness(source)).toBeNull();
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    const result = await collectSourceEvidence(source, "tasks", "pl");
    expect(result.some((entry) => entry.kind === "active")).toBe(false);
  });
});

test("the joined retry carries only exact past/following clause data at original UTF16 offsets", async () => {
  const joined = "Alicja zakończyła archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.";
  const source = "🧪 Descriptive context. " + joined;
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"uncertain"}]}'));
  const review = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "pl", { onSourceReview: review })).resolves.toEqual([]);
  const prompt = model.mock.calls[1][0];
  expect(prompt).toContain("LITERAL_COORDINATED_CLAUSES_START\n");
  const data = JSON.parse(prompt.split("LITERAL_COORDINATED_CLAUSES_START\n")[1].split("\nLITERAL_COORDINATED_CLAUSES_END")[0]) as {
    id: number; completed: { start: number; end: number; quote: string }; following: { start: number; end: number; quote: string };
  };
  expect(data.id).toBe(2);
  for (const span of [data.completed, data.following]) expect(source.slice(span.start, span.end)).toBe(span.quote);
  expect(data.completed.quote).toBe("Alicja zakończyła archiwizację wczoraj");
  expect(data.following.quote).toBe("sprawdzi aktualny koszt przed piątkiem.");
  expect(prompt).toContain("A positive past action does not complete or cancel a separate affirmative finite future action");
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ quote: joined }));
  expect(model).toHaveBeenCalledTimes(2);
});

test("a literal human-role subject may resolve uncertain only after the single bounded retry", async () => {
  const source = "Klient zakończył archiwizację wczoraj i sprawdzi aktualny koszt przed piątkiem.";
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "pl", { onWarning: warning })).resolves.toEqual([expect.objectContaining({ task: source, quote: source, kind: "active" })]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

describe("standalone positive requirements request whole-source coverage", () => {
  test.each([
    ["en", "We must use the existing lamps."], ["pl", "Trzeba użyć istniejących lamp."],
    ["en", "Nina needs to review the current document."], ["pl", "Musimy przygotować nowy raport."],
  ])("reviews an omitted explicit unfinished action in %s without inventing a deadline", async (language, source) => {
    model.mockResolvedValueOnce(generated('{"tasks":[]}'));
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", language as "pl" | "en")).resolves.toEqual([expect.objectContaining({ task: source, quote: source, kind: "active" })]);
    expect(model).toHaveBeenCalledTimes(2);
  });
  test.each([
    "We must keep the existing lamps unchanged.", "Trzeba zachować dotychczasowe lampy bez zmian.",
    "We must not use the existing lamps.", "Nie musimy użyć istniejących lamp.",
    "If approved we must use the existing lamps.", "Jeśli będzie zgoda trzeba użyć istniejących lamp.",
    '"We must use the existing lamps".', "Someone said we must use the existing lamps.",
    "We must use the existing lamps if the room is available.", "Should we use the existing lamps?",
  ])("keeps omitted qualified, quoted, negated or state-maintaining prose as model decisions: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("a named current action keeps its whole ASR background and descriptive suffix", () => {
  test.each([
    "It did not establish a new visit, assign another person or introduce an additional deadline into the project notes Daniel will contact the guest speaker by Tuesday.",
    "This did not require another purchase in the current notes Nina will send the report before Friday.",
    "Nora will send the updated guest list to my Before Wednesday, the list contains the speaker names and the topics associated with each person we talked about the opening music, and the examples of sound recorded near the river.",
    "Hana will review the updated table before Monday, the table contains the current room numbers.",
  ])("reviews an omitted whole quote without rewriting source recipients or historical scope: %s", async (source) => {
    const checkpoint = checkpointStore();
    model.mockResolvedValueOnce(generated('{"tasks":[]}'));
    model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint })).resolves.toEqual([
      expect.objectContaining({ task: source, quote: source, start: 0, end: source.length, kind: "active" }),
    ]);
    expect(model).toHaveBeenCalledTimes(2);
    expect(sourceOf(model.mock.calls[1][0])).toBe("[1] " + source);
    model.mockClear();
    await collectSourceEvidence(source, "tasks", "en", { checkpoint });
    expect(model).not.toHaveBeenCalled();
  });

  test.each([
    "According to an old report it did not establish another visit Nina will send the report before Friday.",
    "If confirmed this did not establish another visit Nina will send the report before Friday.",
    "This did not establish another visit last year Nina will send the report before Friday.",
    "This did not establish another visit my will send the report before Friday.",
    "This did not establish another visit Will send the report before Friday.",
    "Hana will review the updated table before Monday, if confirmed the table contains the current room numbers.",
    "Hana will review the updated table before Monday, the earlier report says that this is an old example.",
    '"Hana will review the updated table before Monday", the table contains the current room numbers.',
  ])("does not mandate omitted historical, reported, quoted or conditional actions: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[]}'));
    await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  "Ula prześle opis gabloty do Witka przed wtorkiem.",
  "Élodie wyśle aktualną listę do piątku.",
  "Tomasz przygotuje raport przed 2026-12-09 o 14:30.",
  "Hana sprawdzi numer gabloty przed czwartkiem.",
  "Anna przygotuje raport numer35 do piątku.",
  "Anna przygotuje raport numer 35 do piątku.",
  "Zoé dostarczy pakiet zestawów testowych wersja 3 przed środą.",
  "Tomasz zaktualizuje załącznik QA/35 przed 2026-12-09 o 14:30.",
])("reviews an omitted literal Polish future assignment: %s", (source) => {
  test.each(["active", "uncertain"] as const)("keeps the whole source and %s decision on resume", async (kind) => {
    model.mockResolvedValueOnce(generated('{"tasks":[]}'));
    model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: [{ id: 1, kind }] })));
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    const review = jest.fn();
    const expected = kind === "active"
      ? [expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind })]
      : [];
    const execution = { checkpoint, onWarning: warning, onSourceReview: review };
    await expect(collectSourceEvidence(source, "tasks", "pl", execution)).resolves.toEqual(expected);
    expect(model).toHaveBeenCalledTimes(2);
    expect(sourceOf(model.mock.calls[1][0])).toBe("[1] " + source);
    expect(model.mock.calls[1][0]).not.toContain("LITERAL_ACTION_CLAUSES_START");
    expect(warning).toHaveBeenCalledTimes(kind === "uncertain" ? 1 : 0);
    expect(review).toHaveBeenCalledTimes(kind === "uncertain" ? 1 : 0);
    if (kind === "uncertain")
      expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ quote: source, start: 0, end: source.length }));
    model.mockClear(); warning.mockClear(); review.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "pl", execution)).resolves.toEqual(expected);
    expect(model).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(kind === "uncertain" ? 1 : 0);
    expect(review).toHaveBeenCalledTimes(kind === "uncertain" ? 1 : 0);
  });
});

test("recovers the omitted last numbered assignment without reclassifying the other 34 tasks", async () => {
  const quotes = Array.from({ length: 35 }, (_, index) => `Anna przygotuje raport numer${index + 1} do piątku.`);
  const source = ["Notatka o przygotowaniu raportów.", ...quotes].join(" ");
  model.mockResolvedValueOnce(generated(JSON.stringify({ tasks: quotes.slice(0, 34).map((_quote, index) => ({ id: index + 2, kind: "active" })) })));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":36,"kind":"active"}]}'));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual(quotes);
  expect(evidence.every((entry) => source.slice(entry.start, entry.end) === entry.quote)).toBe(true);
  expect(sourceOf(model.mock.calls[1][0])).toBe("[36] Anna przygotuje raport numer35 do piątku.");
  expect(warning).not.toHaveBeenCalled();
  model.mockClear();
  await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning })).resolves.toEqual(evidence);
  expect(model).not.toHaveBeenCalled();
});

test("does not turn a numbered assignment into active evidence when its bounded review remains uncertain", async () => {
  const source = "Anna przygotuje raport numer35 do piątku.";
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
  const warning = jest.fn();
  const review = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "pl", { onWarning: warning, onSourceReview: review })).resolves.toEqual([]);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ start: 0, end: source.length, quote: source }));
});

test("rejects a stale clean checkpoint that omitted a numbered assignment", async () => {
  const source = "Anna przygotuje raport numer35 do piątku.";
  const checkpoint = checkpointStore();
  model.mockResolvedValue(generated('{"tasks":[]}'));
  await collectSourceEvidence(source, "tasks", "pl", { checkpoint });
  const key = "tasks:0:" + source.length;
  const saved = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, evidence: [], warnings: [], unresolved: [] });
  model.mockClear();
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

describe("joined factual amount corrections", () => {
  const facts = [
    "Correction, the final approved production budget is $1450 This final amount replaces the earlier budget of $900.",
    "Update: the current allowance is 2700 pounds this amount replaces the previous allowance of 1300 pounds.",
    "Korekta, budżet końcowy wynosi 1450 złotych Ta kwota zastępuje wcześniejszy budżet 900 złotych.",
  ];
  test.each(facts)("omits the complete factual source without cancelling it: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active","change":true}]}'));
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
    expect(warning).not.toHaveBeenCalled();
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
    expect(model).not.toHaveBeenCalled();
  });
  test.each([
    "Correction, the final approved budget is $1450 Maya will send the invoice by Friday.",
    "Correction, Maya will pay $1450 by Friday.",
    "Correction, the final approved budget is $1450 This amount replaces the earlier budget of $900 and Maya must pay the supplier.",
    "Korekta, Anna zapłaci 1450 złotych do piątku.",
    "Korekta, budżet końcowy wynosi 1450 złotych Ta kwota zastępuje wcześniejszy budżet 900 złotych i musimy zapłacić dostawcy.",
  ])("retains the entire actionable correction and its original amount: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active","change":true}]}'));
    const evidence = await collectSourceEvidence(source, "tasks", "en");
    expect(evidence).toEqual([expect.objectContaining({ task: source, quote: source, start: 0, end: source.length, kind: "active", change: true })]);
  });
});

describe("Polish declarative amount word order", () => {
  test.each([
    "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych",
    "Korekta kwota ostateczna wynosi 3910 złotych zamiast 2480 złotych",
    "Poprawka zatwierdzony budżet wynosi 2300 złotych zamiast 1900 złotych.",
    "Ostateczny koszt wynosi 3910 złotych.",
  ])("omits a complete descriptive amount selected as active and replays the clean result: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning })).resolves.toEqual([]);
    expect(warning).not.toHaveBeenCalled();
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning })).resolves.toEqual([]);
    expect(model).not.toHaveBeenCalled();
  });

  test.each([
    "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych i Anna zapłaci dostawcy do piątku",
    "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych Anna zapłaci dostawcy do piątku",
    "Ostateczny koszt wynosi 3910 złotych więc musimy wysłać nową fakturę.",
    "Poprawka zatwierdzony budżet wynosi 2300 złotych Anna musi zarezerwować salę.",
    "Korekta Anna zapłaci ostateczną kwotę 3910 złotych do piątku.",
  ])("keeps the complete original correction when it assigns a real action: %s", async (source) => {
    model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
    await expect(collectSourceEvidence(source, "tasks", "pl")).resolves.toEqual([
      expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "active" }),
    ]);
  });
});

test("keeps the actual EN30 factual prefix and required replacement studio in the same source ID", async () => {
  const source = "This final amount replaces the earlier budget of $900 the north studio reservation was canceled so we must use the south studio for the recording.";
  model.mockResolvedValue(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  await expect(collectSourceEvidence(source, "tasks", "en")).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "active" }),
  ]);
});

describe.each([
  "Anna przygotuje raport numer35 jeśli otrzyma zgodę do piątku.",
  "Anna przygotuje raport numer35 dopiero po otrzymaniu zgody do piątku.",
  "Anna przygotuje raport numer35 jedynie w symulacji do piątku.",
  "Anna przygotuje raport numer35 jako hipotetyczny przykład do piątku.",
  "Anna nie przygotuje raportu numer35 do piątku.",
  "Według dawnego raportu Anna przygotuje raport numer35 do piątku.",
  "Jeśli otrzyma zgodę Łucja prześle opis gabloty przed wtorkiem.",
  "Łucja prześle opis gabloty jeśli otrzyma zgodę przed wtorkiem.",
  "Łucja prześle opis gabloty pod warunkiem zgody przed wtorkiem.",
  "Łucja prześle opis gabloty w razie zgody przed wtorkiem.",
  "Łucja prześle opis gabloty po zatwierdzeniu planu przed wtorkiem.",
  "Łucja prześle opis gabloty po uzyskaniu zgody przed wtorkiem.",
  "Łucja prześle opis gabloty tylko po otrzymaniu zgody przed wtorkiem.",
  "Łucja prześle opis gabloty zapewne przed wtorkiem.",
  "Łucja prześle opis gabloty wstępnie przed wtorkiem.",
  "Łucja prześle opis gabloty w symulacji przed wtorkiem.",
  "Łucja prześle opis gabloty prawdopodobnie przed wtorkiem.",
  "Łucja prześle opis gabloty podobno przed wtorkiem.",
  "Łucja prześle opis gabloty rzekomo przed wtorkiem.",
  "Łucja prześle opis gabloty ewentualnie przed wtorkiem.",
  "Łucja nie prześle opisu gabloty przed wtorkiem.",
  "Łucja prześle opis gabloty i nie kupi kamery przed wtorkiem.",
  "Łucja i Tomasz prześlą opis gabloty przed wtorkiem.",
  "Łucja Nowak prześle opis gabloty przed wtorkiem.",
  "Łucja prześle opis gabloty oraz Tomasz sprawdzi numer przed wtorkiem.",
  "Powiedziano że Łucja prześle opis gabloty przed wtorkiem.",
  "Raport przewiduje że Łucja prześle opis gabloty przed wtorkiem.",
  "To nieprawda Łucja prześle opis gabloty przed wtorkiem.",
  "Wyobrażamy sobie Łucja prześle opis gabloty przed wtorkiem.",
  "Łucja prześle opis według fikcyjnego scenariusza przed wtorkiem.",
  "Łucja prześle opis jako przykład przed wtorkiem.",
  "„Łucja prześle opis gabloty przed wtorkiem”.",
  "Łucja prześle opis gabloty przed wtorkiem?",
  "Łucja przesłała opis gabloty przed wtorkiem.",
  "Łucja mogłaby przesłać opis gabloty przed wtorkiem.",
  "Łucja będzie mogła przesłać opis gabloty przed wtorkiem.",
  "Łucja prześle opis gabloty.",
  "Opis prześle do piątku.",
  "Moja prześle opis gabloty przed wtorkiem.",
  "Nikt prześle opis gabloty przed wtorkiem.",
  "Łucja prześle opis gabloty przed wtorkiem gdy otrzyma zgodę.",
])("keeps qualified or ambiguous Polish future prose as a model decision: %s", (source) => {
  test.each(["omitted", "uncertain"] as const)("accepts %s and resumes without mandatory review", async (kind) => {
    model.mockResolvedValue(generated(kind === "omitted"
      ? '{"tasks":[]}' : '{"tasks":[{"id":1,"kind":"uncertain"}]}'));
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    const review = jest.fn();
    const execution = { checkpoint, onWarning: warning, onSourceReview: review };
    const expected = kind === "omitted" ? [] : [
      expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "uncertain" }),
    ];
    await expect(collectSourceEvidence(source, "tasks", "pl", execution)).resolves.toEqual(expected);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", "pl", execution)).resolves.toEqual(expected);
    expect(model).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
});

test("repeats only the literal eligible action clause while retaining each whole corrective source ID", async () => {
  const source = "🧪 Archive overview. " + existingDaniel + " " + actualNora + " " + actualMalformedActor;
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"},{"id":3,"kind":"active"},{"id":4,"kind":"uncertain"}]}'));
  await collectSourceEvidence(source, "tasks", "en");
  const prompt = model.mock.calls[1][0];
  expect(sourceOf(prompt)).toBe("[2] " + existingDaniel + "\n[3] " + actualNora + "\n[4] " + actualMalformedActor);
  const clauses = literalActionClauses(prompt);
  expect(clauses).toEqual([{
    id: 3, start: source.indexOf("Nora will"), end: source.indexOf(actualNora) + actualNora.length,
    quote: "Nora will send the updated guest list to Maya before Wednesday.",
  }]);
  expect(source.slice(clauses[0].start, clauses[0].end)).toBe(clauses[0].quote);
  expect(prompt).not.toContain("Embedded source action remains uncertain");
  expect(model.mock.calls[1][2]?.jsonSchema).toMatchObject({
    properties: { tasks: { minItems: 3, maxItems: 3, items: { properties: { id: { enum: [2, 3, 4] } } } } },
  });
});

test("keeps literal action excerpt offsets absolute after splitting a source with a Unicode prefix", async () => {
  const source = "🧪 Préface.  " + actualNora;
  const limit = actualNora.length + 8;
  measurePrompt.mockImplementation(async ({ userPrompt }) =>
    sourceOf(userPrompt).length <= limit ? 100 : 9000);
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const evidence = await collectSourceEvidence(source, "tasks", "en");
  expect(model).toHaveBeenCalledTimes(3);
  const prompt = model.mock.calls[2][0];
  expect(sourceOf(prompt)).toBe("[1] " + actualNora);
  const clauses = literalActionClauses(prompt);
  expect(clauses).toEqual([{
    id: 1, start: source.indexOf("Nora will"), end: source.length,
    quote: "Nora will send the updated guest list to Maya before Wednesday.",
  }]);
  expect(source.slice(clauses[0].start, clauses[0].end)).toBe(clauses[0].quote);
  expect(evidence).toEqual([expect.objectContaining({
    quote: actualNora, start: source.indexOf(actualNora), end: source.length, kind: "active",
  })]);
});

test("rejects a cached clean omission of a reviewed Polish assignment", async () => {
  const source = "Hana sprawdzi numer gabloty przed czwartkiem.";
  const checkpoint = checkpointStore();
  model.mockResolvedValue(generated('{"tasks":[]}'));
  await collectSourceEvidence(source, "tasks", "pl", { checkpoint });
  const key = "tasks:0:" + source.length;
  const saved = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, warnings: [], unresolved: [] });
  model.mockClear();
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "pl", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

describe.each([
  ["en", "Subject to approval Leila will send the list before Friday."],
  ["en", "Pending approval Leila will send the list before Friday."],
  ["en", "It is false Leila will send the list before Friday."],
  ["en", "It is untrue Leila will send the list before Friday."],
  ["en", "We imagined Leila will send the list before Friday."],
  ["en", "We suppose Leila will send the list before Friday."],
  ["en", "We are pretending Leila will send the list before Friday."],
  ["en", "The hypothetical situation Leila will send the list before Friday."],
  ["en", "As long as approved Leila will send the list before Friday."],
  ["en", "In case of approval Leila will send the list before Friday."],
  ["en", "On condition of approval Leila will send the list before Friday."],
  ["en", "We expect Leila will send the list before Friday."],
  ["en", "We anticipate Leila will send the list before Friday."],
  ["en", "This was background discussion in case of approval Leila will send the list before Friday."],
  ["en", "This was background discussion contingent on approval Leila will send the list before Friday."],
  ["en", "This was background discussion depending on approval Leila will send the list before Friday."],
  ["en", "The context concerns conditional plans Leila will send the list before Friday."],
  ["en", "This was background discussion as long as approved Leila will send the list before Friday."],
  ["en", "Background interpretation about the plans Leila will send the list before Friday."],
  ["en", "The statement is incorrect Leila will send the list before Friday."],
  ["en", "The statement is inaccurate Leila will send the list before Friday."],
  ["en", "The statement is wrong Leila will send the list before Friday."],
  ["en", "This was a tentative arrangement Leila will send the list before Friday."],
  ["en", "This was a provisional plan Leila will send the list before Friday."],
  ["pl", "Wyobrażamy sobie Leila will send the list before Friday."],
  ["pl", "To nieprawda Leila will send the list before Friday."],
  ["pl", "Przypuszczamy Leila will send the list before Friday."],
  ["pl", "Zakładamy Leila will send the list before Friday."],
] as const)("keeps explicitly scoped prose as a model decision: %s %s", (language, source) => {
  test.each(["omitted", "uncertain"] as const)("accepts %s without forcing recovery and resumes the same clean classification", async (classification) => {
    const raw = classification === "omitted"
      ? '{"tasks":[]}' : '{"tasks":[{"id":1,"kind":"uncertain"}]}';
    model.mockResolvedValue(generated(raw));
    const checkpoint = checkpointStore();
    const warning = jest.fn();
    const expected = classification === "omitted" ? [] : [
      expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "uncertain" }),
    ];
    await expect(collectSourceEvidence(source, "tasks", language, { checkpoint, onWarning: warning })).resolves.toEqual(expected);
    expect(model).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    model.mockClear();
    await expect(collectSourceEvidence(source, "tasks", language, { checkpoint, onWarning: warning })).resolves.toEqual(expected);
    expect(model).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });
});

test("reviews the omitted physical ASR assignment as its complete ID and retains an already validated task", async () => {
  const source = `🧪 Archive overview.  ${actualNora}\n\n${existingDaniel} ${actualMalformedActor}`;
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":3,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":2,"kind":"active"},{"id":4,"kind":"uncertain"}]}'));
  const warning = jest.fn();
  const evidence = await collectSourceEvidence(source, "tasks", "en", { onWarning: warning });
  expect(evidence.map((entry) => entry.task)).toEqual([actualNora, existingDaniel]);
  for (const entry of evidence) expect(source.slice(entry.start, entry.end)).toBe(entry.quote);
  expect(model).toHaveBeenCalledTimes(2);
  expect(sourceOf(model.mock.calls[1][0])).toBe(`[2] ${actualNora}\n[4] ${actualMalformedActor}`);
  expect(model.mock.calls[1][2]?.jsonSchema).toMatchObject({
    properties: { tasks: { minItems: 2, maxItems: 2, items: { properties: { id: { enum: [2, 4] } } } } },
  });
  expect(warning).toHaveBeenCalledTimes(1);
  expect(evidence.some((entry) => entry.quote.includes("Maya will prepare"))).toBe(false);
});

test.each([
  "The context concerned existing materials rather than a new work order Leila will submit the revised plan before Friday.",
  "This is background information about the collection Élodie will deliver the invoice by December 9 at 14:30.",
  "We discussed the equipment inventory and the room layout Nobuko will check the revised plan before 2026-12-09.",
])("reviews a generic terminal commitment without rewriting its unknown prose prefix: %s", async (source) => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ quote: source, task: source, start: 0, end: source.length, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).not.toHaveBeenCalled();
});

test("keeps an unresolved embedded assignment visible after one uncertain correction and on checkpoint resume", async () => {
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"uncertain"}]}'));
  const checkpoint = checkpointStore();
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualNora, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  model.mockClear(); warning.mockClear();
  await expect(collectSourceEvidence(actualNora, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
});

test("rejects a cached clean omission of the new embedded candidate", async () => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const checkpoint = checkpointStore();
  const key = `tasks:0:${actualNora.length}`;
  await collectSourceEvidence(actualNora, "tasks", "en", { checkpoint });
  const saved = await checkpoint.read(key) as Record<string, unknown>;
  await checkpoint.write(key, { ...saved, warnings: [], unresolved: [] });
  model.mockClear();
  const warning = jest.fn();
  await expect(collectSourceEvidence(actualNora, "tasks", "en", { checkpoint, onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test("does not erase a validated task when the added correction omits its rejected ID", async () => {
  const source = `${existingDaniel} ${actualNora}`;
  model.mockResolvedValueOnce(generated('{"tasks":[{"id":1,"kind":"active"}]}'));
  model.mockResolvedValueOnce(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", "en", { onWarning: warning })).resolves.toEqual([
    expect.objectContaining({ task: existingDaniel, kind: "active" }),
  ]);
  expect(model).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
});

test.each([
  ["en", 'This was background discussion "Leila will send the list before Friday."'],
  ["en", "This was background discussion Leila will send the list before Friday?"],
  ["en", "This was background discussion if approved Leila will send the list before Friday."],
  ["en", "This was background discussion Leila will send the list before Friday unless approved."],
  ["en", "This was background discussion about an example Leila will send the list before Friday."],
  ["en", "This was background discussion about an assumption Leila will send the list before Friday."],
  ["en", "This was background discussion of a possible assignment Leila will send the list before Friday."],
  ["en", "The report stated Leila will send the list before Friday."],
  ["en", "The evidence suggests Leila will send the list before Friday."],
  ["en", "The historical account from last year Leila will send the list before Friday."],
  ["en", "The background from yesterday Leila will send the list before Friday."],
  ["en", "This was background discussion without approval Leila will send the list before Friday."],
  ["en", "There was no obligation Leila will send the list before Friday."],
  ["en", "The discussion did not establish Leila will send the list before Friday."],
  ["en", "This was background discussion Leila will not send the list before Friday."],
  ["en", "This was background discussion Leila will contact nobody before Friday."],
  ["en", "The documents which Leila will send before Friday."],
  ["en", "This was background discussion Alice and Leila will send the list before Friday."],
  ["en", "This was background discussion Ada Lovelace will send the list before Friday."],
  ["en", "This was background discussion and Leila will send the list before Friday."],
  ["en", "This was background discussion Alice will contact the guest and Leila will send the list before Friday."],
  ["en", "This was background discussion Leila will contact the guest and Bob will send the list before Friday."],
  ["en", "This was background discussion my will send the list before Friday if approved."],
  ["en", "This was background discussion Leila will send the list."],
  ["pl", 'To był tylko przykład „Anna wyśle listę do piątku”.'],
  ["pl", "Jeśli klient zatwierdzi plan Anna wyśle listę do piątku."],
  ["pl", "Anna nie wyśle listy do piątku."],
  ["pl", "Anna zapytała czy trzeba wysłać listę przed piątkiem."],
  ["pl", "Anna i Piotr mogą przygotować listę do piątku."],
  ["pl", "Wczoraj Anna wysłała listę przed spotkaniem."],
  ["pl", "Rezerwację odwołano więc nie należy zamawiać innej sali."],
  ["pl", "To była dyskusja o przykładzie Leila will send the list before Friday."],
  ["pl", "To była dyskusja o możliwości Leila will send the list before Friday."],
  ["pl", "Raport przewiduje Leila will send the list before Friday."],
] as const)("does not force bounded recovery for reported, hypothetical, negated or ambiguous prose: %s %s", async (language, source) => {
  model.mockResolvedValue(generated('{"tasks":[]}'));
  const warning = jest.fn();
  await expect(collectSourceEvidence(source, "tasks", language, { onWarning: warning })).resolves.toEqual([]);
  expect(model).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});
