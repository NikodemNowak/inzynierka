import { generate } from "./llm";
import { processNoteWithLlm } from "./noteProcessing";
import { selectSourceSummaryResult } from "./summarySelection";
import type { FinalTaskEvidence } from "./processingContext";
import type { SourceEvidence } from "./sourcePipeline";
import type { SummaryCheckTargets } from "./summaryProtocol";

jest.mock("./llm", () => ({
  generate: jest.fn(), getLoadedModelInfo: () => null,
  measureFormattedPromptTokens: async ({ userPrompt }: { userPrompt: string }) =>
    userPrompt.includes("SOURCE_START\n\nSOURCE_END") ? 100
      : userPrompt.includes("FIELD_TASK_START") ? 2200 : 2000,
  getContextWindowSize: () => 8192,
}));
jest.mock("./modelReady", () => ({ ensureModelReady: jest.fn(async () => undefined) }));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));
const model = jest.mocked(generate);
const generated = (text: string) => ({ text, ttftMs: 1, wallMs: 2,
  tokensPerSecond: 20, promptMs: 1, predictedMs: 1, promptTokens: 100, predictedTokens: 2 });

const topics = [
  { language: "en" as const, title: "Marine biology exhibition",
    subject: "The museum is preparing a marine biology exhibition for local schools.",
    supporting: "A garden description was used as ordinary background for discussing the lighting and atmosphere of the display." },
  { language: "en" as const, title: "Garden description archive",
    subject: "The central object is an archive of garden descriptions collected from local writers.",
    supporting: "A marine biology exhibition was mentioned as an incidental example of reusing those descriptions for a public display." },
  { language: "pl" as const, title: "Wystawa biologii morza",
    subject: "Muzeum przygotowuje wystawę biologii morza dla miejscowych szkół.",
    supporting: "Opis ogrodu służył jako zwykłe tło rozmowy o oświetleniu oraz atmosferze ekspozycji." },
  { language: "pl" as const, title: "Archiwum opisów ogrodów",
    subject: "Głównym przedmiotem pracy jest archiwum opisów ogrodów zebranych od miejscowych autorów.",
    supporting: "Wystawa biologii morza była jedynie przykładem wykorzystania takich opisów podczas prezentacji publicznej." },
];

beforeEach(() => model.mockReset());
test.each(topics)("asks for the explicit central source topic while preserving a truly primary archive ($language, $title)", async ({ language, subject, supporting, title }) => {
  const filler = language === "en"
    ? "The supporting material contains ordinary observations of shape and colour and was discussed without assigning any new work."
    : "Materiały pomocnicze zawierają zwykłe obserwacje kształtu oraz koloru i były omawiane bez przydzielania jakiejkolwiek nowej pracy.";
  const source = [subject, supporting, ...Array.from({ length: 7 }, () => filler)].join(" ");
  model.mockImplementation(async (prompt, _token, options) => {
    const properties = (options?.jsonSchema?.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(options?.jsonSchema?.anyOf)) return generated(JSON.stringify({ format: "bullets", points: [
      { text: subject, sourceIds: [1] }, { text: supporting, sourceIds: [2] },
    ] }));
    if ("units" in properties) {
      const targets = (JSON.parse(prompt) as { checkTargetsData: SummaryCheckTargets }).checkTargetsData;
      return generated(JSON.stringify({ points: targets.pointIds.map(pointId => ({ pointId, status: "supported", issues: [] })),
        units: targets.sourceIds.map(sourceId => ({ sourceId, status: sourceId <= 2 ? "covered" : "context",
          pointIds: sourceId <= 2 ? [sourceId] : [], supersededBy: [] })) }));
    }
    return generated(
    prompt.includes("Give a title") || prompt.includes("Podaj tytuł") ? title
      : "category" in properties ? '{"purposeId":1,"category":"Praca"}'
        : "tasks" in properties ? '{"tasks":[]}' : title);
  });
  const result = await processNoteWithLlm(source, () => undefined, undefined, language);
  expect(result.title).toBe(title);
  expect(result.summary).toContain(subject);
  expect(result.summary).toContain(supporting);
  expect(result.failedFields).toBeUndefined();
  const initial = model.mock.calls[0];
  const request = model.mock.calls.find(([prompt]) => prompt.includes("Give a title") || prompt.includes("Podaj tytuł"))!;
  expect(initial[0]).not.toContain("EXPLICIT_TOPIC_DECLARATION_DATA_JSON");
  expect(request[0]).not.toContain("FIELD_TASK_START");
  expect(request[0]).toContain(subject);
  expect(request[0]).toContain(supporting);
  const instructions = request[0].split("\nSOURCE_END\n")[1];
  expect(instructions).toContain(language === "en"
    ? "main topic of the ENTIRE note" : "główny temat CAŁEJ notatki");
  expect(instructions).toContain(language === "en"
    ? "not its first detail" : "nie pierwszy szczegół");
  expect(instructions).toContain(language === "en"
    ? "topic nouns and adjectives present in the source" : "rzeczowniki i przymiotniki tematu obecne w źródle");
  expect(request[0]).not.toContain("Select source statement IDs containing action items");
  // The universal instructions cannot embed the fixture subject. A later
  // title-only DATA block may repeat an independently validated whole quote.
  expect(instructions.split("EXPLICIT_TOPIC_DECLARATION_DATA_JSON")[0]).not.toContain(subject);
  expect(request[2]?.system).toContain(language === "en" ? "Analyze the complete English note" : "Analizujesz całą polską notatkę");
  expect(request[2]?.nPredict).toBe(40);
});

const evidence = (source: string, quote: string, kind: SourceEvidence["kind"] = "active"): SourceEvidence => ({
  id: `task:${source.indexOf(quote)}`, start: source.indexOf(quote), end: source.indexOf(quote) + quote.length,
  quote, task: quote, kind, importance: 2, change: false,
});
const filler = Array.from({ length: 12 }, (_, index) => `Background item ${index + 1} contains ordinary descriptions of colours, shapes and familiar objects with extensive explanatory context about previous public presentations.`);

test("appends a missing literal commitment without lexical expansion or displacement of already selected corrections and restrictions", () => {
  const commitment = "It did not establish another deadline in the project notes Leah will contact the guest speaker by Tuesday.";
  const incidental = "The conversation concerned editorial background rather than a final sequence of questions for the guest speaker.";
  const required = [
    "We discussed the existing material at the previous meeting.",
    "The archive contains descriptions of earlier presentations.",
    "The studio reservation was cancelled so we must use the south studio.",
    "The outline and the updated list are the topics for the review.",
  ];
  const unknown = "The neighbourhood programme my will prepare the outline by Thursday.";
  const budget = "Correction, the final approved production budget is $2370 This final amount replaces the earlier budget of $840.";
  const policy = "We will use the microphone that we already have and we must not buy any new cameras.";
  const source = [commitment, incidental, ...required, unknown, budget, policy, ...filler].join(" ");
  const proof: FinalTaskEvidence = {
    tasks: required, evidence: required.map((quote) => evidence(source, quote)), superseded: [], warnings: ["Unknown source actor"],
    reviewSpans: [{ start: source.indexOf(unknown), end: source.indexOf(unknown) + unknown.length, quote: unknown, reason: "Unresolved source actor" }],
  };
  const raw = '{"sentences":[3,4,8,9]}';
  const before = JSON.stringify(proof);
  const legacy = selectSourceSummaryResult(raw, source, source, proof);
  const appended = selectSourceSummaryResult(raw, source, source, proof, { preserveLiteralCommitments: true });
  expect(legacy.summary).toContain(budget);
  expect(legacy.summary).toContain(policy);
  for (const quote of [...required, unknown, budget, policy, commitment]) expect(appended.summary).toContain(quote);
  expect(appended.summary).not.toContain(incidental);
  expect(appended.summary.split(/(?<=[.!?])\s+/u)).toHaveLength(8);
  expect(appended.summary.replace(commitment + " ", "")).toBe(legacy.summary);
  expect(JSON.stringify(proof)).toBe(before);
});

test("adds at most two literal source quotes and warns when another remains missing", () => {
  const commitments = ["Leah will contact the guest speaker by Tuesday.", "Noah will prepare the workshop report by Friday.", "Ida will send the invoice before Monday."];
  const source = [...commitments, ...filler].join(" ");
  const proof: FinalTaskEvidence = { tasks: [], evidence: [], superseded: [], warnings: [] };
  const raw = '{"sentences":[4,5,6,7]}';
  const legacy = selectSourceSummaryResult(raw, source, source, proof);
  const appended = selectSourceSummaryResult(raw, source, source, proof, { preserveLiteralCommitments: true });
  expect(appended.summary).toContain(commitments[0]);
  expect(appended.summary).toContain(commitments[1]);
  expect(appended.summary).not.toContain(commitments[2]);
  expect(appended.summary.endsWith(legacy.summary)).toBe(true);
  expect(appended.incomplete).toBe(true);
  expect(proof.tasks).toEqual([]);
});

test("keeps the original summary and warns when an extra quote would exceed the compression bound", () => {
  const commitment = `Leah will prepare ${Array.from({ length: 400 }, () => "the report").join(" ")} by Friday.`;
  const source = [commitment, ...filler.slice(0, 5)].join(" ");
  const proof: FinalTaskEvidence = { tasks: [], evidence: [], superseded: [], warnings: [] };
  const raw = '{"sentences":[2,3,4]}';
  const legacy = selectSourceSummaryResult(raw, source, source, proof);
  const appended = selectSourceSummaryResult(raw, source, source, proof, { preserveLiteralCommitments: true });
  expect(appended.summary).toBe(legacy.summary);
  expect(appended.incomplete).toBe(true);
});
