import { generate, measureFormattedPromptTokens } from "./llm";
import { processNoteWithLlm } from "./noteProcessing";
import { selectSourceSummaryResult } from "./summarySelection";
import type { FinalTaskEvidence } from "./processingContext";
import type { SourceEvidence } from "./sourcePipeline";
import type { SummaryCheckTargets, SummaryDraft } from "./summaryProtocol";

jest.mock("./llm", () => ({
  generate: jest.fn(), getLoadedModelInfo: () => null,
  measureFormattedPromptTokens: jest.fn(), getContextWindowSize: () => 8192,
}));
jest.mock("./modelReady", () => ({ ensureModelReady: jest.fn(async () => undefined) }));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);
const measure = jest.mocked(measureFormattedPromptTokens);
const generated = (text: string) => ({
  text, ttftMs: 1, wallMs: 2, tokensPerSecond: 20, promptMs: 1,
  predictedMs: 1, promptTokens: 100, predictedTokens: 2,
});
const source = "Community workshop planning covers library equipment and invitations. Alice will send the workshop report by Friday. The final budget is 1200 pounds. We discussed unrelated music and historical photographs without assigning more work. The venue for the workshop is the community library. Everyone shared background examples about the previous workshop.";
const install = (title: string, anchor = '{"anchors":[1],"title":"Community workshop"}'): void => {
  model.mockImplementation(async (prompt, _onToken, options) => {
    const properties = options?.jsonSchema?.properties as Record<string, unknown> | undefined;
    if (Array.isArray(options?.jsonSchema?.anyOf) || properties && "units" in properties) {
      const payload = JSON.parse(prompt) as { sourceCatalogData: string; draftData?: SummaryDraft; checkTargetsData?: SummaryCheckTargets };
      const units = [...payload.sourceCatalogData.matchAll(/^\[(\d+)\] (.+)$/gmu)].map(match => ({ id: Number(match[1]), text: match[2] }));
      // The action, final amount and venue are distinct facts; only the two
      // explicitly incidental/background statements are context.
      const draft: SummaryDraft = { format: "bullets", points: units.filter(unit => [1, 2, 3, 5].includes(unit.id))
        .map(unit => ({ text: unit.text, sourceIds: [unit.id] })) };
      if (!payload.draftData) return generated(JSON.stringify(draft));
      const targets = payload.checkTargetsData!;
      return generated(JSON.stringify({ points: targets.pointIds.map(pointId => ({ pointId, status: "supported", issues: [] })),
        units: units.filter(unit => targets.sourceIds.includes(unit.id)).map(unit => {
          const pointIds = draft.points.flatMap((point, index) => point.sourceIds.includes(unit.id) ? [index + 1] : []);
          return { sourceId: unit.id, status: pointIds.length ? "covered" : "context", pointIds, supersededBy: [] };
        }) }));
    }
    return generated(properties && "purposeId" in properties ? '{"purposeId":1,"category":"Praca"}'
      : properties && "anchors" in properties ? anchor
      : prompt.includes("Give a title") ? title
        : prompt.includes("Summarize the following note") ? '{"sentences":[1,2,3]}'
          : prompt.includes("Select source statement IDs containing action items") ? '{"tasks":[{"id":2,"kind":"active"}]}'
            : "Praca");
  });
};
const installCosts = (sourceTokens: number, summaryExtra = 300, titleExtra = 300): void => {
  measure.mockImplementation(async ({ userPrompt }) => {
    const prefix = userPrompt.includes("SOURCE_START") ? 500 : 100;
    const literal = userPrompt.includes("SOURCE_START\n\nSOURCE_END") ? 0 : sourceTokens;
    const extra = userPrompt.includes("FIELD_TASK_START")
      ? userPrompt.includes("Give a title") ? titleExtra : summaryExtra : 0;
    return prefix + literal + extra;
  });
};
beforeEach(() => { model.mockReset(); measure.mockReset(); installCosts(2000); });

test.each([
  ['{"anchors":[1],"title":"Community workshop"}', "Community workshop"],
  ['{"anchors":[1],"title":"Community work\\u0073hop"}', "Community workshop"],
  ['{"anchors":[1],"title":"<think>\\n\\n</think>\\nCommunity workshop"}', "Community workshop"],
  ['{"anchors":[1],"title":"\\\"Community workshop\\\""}', "Community workshop"],
])("accepts a strict anchored JSON title object and preserves existing cleanup: %s", async (wire, expected) => {
  install("Note topic", wire);
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.title).toBe(expected);
  expect(result.failedFields).toBeUndefined();
  const call = model.mock.calls.find(([, , options]) => options?.nPredict === 160)!;
  expect(call[2]?.jsonSchema).toMatchObject({ type: "object", additionalProperties: false,
    required: ["anchors", "title"], properties: { title: { type: "string" } } });
  expect(model.mock.calls.filter(([, , options]) => options?.nPredict === 160)).toHaveLength(1);
  const initialTitle = model.mock.calls.find(([prompt]) => prompt.includes("Give a title"))!;
  expect(initialTitle[2]?.nPredict).toBe(40);
  expect(initialTitle[2]?.jsonSchema).toBeUndefined();
  expect(initialTitle[0]).toContain(source.split(". ")[0]);
});

test.each([
  '"{\\\"title\\\":\\\"Community workshop\\\"}"',
  '{"anchors":[1],"title":"{\\\"title\\\":\\\"Community workshop\\\"}"}',
  '{"anchors":[1],"title":"[{\\\"op\\\":\\\"replace\\\",\\\"path\\\":\\\"/title\\\",\\\"value\\\":\\\"Community workshop\\\"}]"}',
  '{"anchors":[1],"title":"Community workshop","tasks":[]}', '{"anchors":[1],"title":null}', 'null',
])("rejects nested JSON, JSON Patch and unexpected title fields: %s", async (wire) => {
  install("Note topic", wire);
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.failedFields).toEqual(["title"]);
  expect(result.title).not.toMatch(/[{}[\]\\]/u);
  expect(model.mock.calls.filter(([, , options]) => options?.nPredict === 160)).toHaveLength(1);
  expect(result.summary).toContain("Alice will send the workshop report by Friday.");
});

test("uses at most one source-anchored rewrite with no generic proposal bias", async () => {
  install('Note topic');
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.title).toBe("Community workshop");
  const rewrites = model.mock.calls.filter(([, , options]) => options?.nPredict === 160);
  expect(rewrites).toHaveLength(1);
  expect(rewrites[0][0]).toContain('"proposal":"","supportedWords":[],"unsupportedWords":[]');
});

test("rejects an empty generic label from the bounded title rewrite", async () => {
  install('Note topic', '{"anchors":[1],"title":"note"}');
  const result = await processNoteWithLlm(source + " This is a note about the community.", () => undefined, undefined, "en");
  expect(result.failedFields).toEqual(["title"]);
  expect(result.title).not.toBe("note");
  expect(model.mock.calls.filter(([, , options]) => options?.nPredict === 160)).toHaveLength(1);
});

test.each([1199, 1200, 1201])("keeps independent grounded summary and source title across the former two-suffix boundary: %s", async (sourceTokens) => {
  installCosts(sourceTokens);
  install("Community workshop");
  const result = await processNoteWithLlm(source, () => undefined, undefined, "en");
  expect(result.title).toBe("Community workshop");
  const calls = model.mock.calls.filter(([prompt]) => prompt.includes("Give a title"));
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).not.toContain("FIELD_TASK_START");
  expect(calls[0][2]?.jsonSchema).toBeUndefined();
  expect(calls[0][2]?.system).toContain("Analyze the complete English note");
  expect(model.mock.calls.some(([, , options]) => Array.isArray(options?.jsonSchema?.anyOf))).toBe(true);
  expect(result.summary).toContain("Alice will send the workshop report by Friday.");
  expect(result.summary).toContain("1200 pounds");
  expect(result.failedFields).toBeUndefined();
});

const evidence = (content: string, quote: string, kind: SourceEvidence["kind"] = "active"): SourceEvidence => ({
  id: `task:${content.indexOf(quote)}`, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length,
  quote, task: quote, kind, importance: 2, change: false,
});
const proofFor = (entries: SourceEvidence[] = []): FinalTaskEvidence => ({
  tasks: entries.map((entry) => entry.task!), evidence: entries, superseded: [], warnings: [],
});
const background = Array.from({ length: 10 }, (_, index) => `Background item ${index + 1} concerns ordinary photographs of landscapes and old buildings with extensive descriptive context about their visual details.`);
const select = (quote: string, options = { preserveLiteralCommitments: true }, proof = proofFor()) => {
  const content = [quote, ...background].join(" ");
  return selectSourceSummaryResult('{"sentences":[2,3,4,5]}', content, content, proof, options);
};

test.each([
  "Daniel will contact the guest speaker by Tuesday.",
  "Leah will prepare the workshop report before Friday.",
  // Actual ASR10 quote: preserve the full literal statement without deciding
  // how its descriptive negation scopes over the following assignment.
  "It did not establish a new visit, assign another person or introduce an additional deadline into the project notes Daniel will contact the guest speaker by Tuesday.",
])("preserves a complete literal deadline commitment omitted by both model selections: %s", (quote) => {
  const proof = proofFor();
  const before = JSON.stringify(proof);
  expect(select(quote, { preserveLiteralCommitments: true }, proof).summary).toContain(quote);
  expect(proof.tasks).toEqual([]);
  expect(JSON.stringify(proof)).toBe(before);
  expect(select(quote, { preserveLiteralCommitments: false }).summary).not.toContain(quote);
});

test.each([
  "Daniel will not contact the guest speaker by Tuesday.",
  "Daniel will never contact the guest speaker by Tuesday.",
  "If we confirm the venue Daniel will contact the guest speaker by Tuesday.",
  "The archive said Daniel will contact the guest speaker by Tuesday.",
  "Last year Daniel will contact the guest speaker by Tuesday.",
  'The example is "Daniel will contact the guest speaker by Tuesday."',
  "The example described Daniel will contact the guest speaker by Tuesday.",
  "The reservation was cancelled Daniel will contact the guest speaker by Tuesday.",
  "The team mentioned that Daniel will contact the guest speaker by Tuesday.",
  "The proposed plan has Daniel will contact the guest speaker by Tuesday.",
  "Daniel and Leah will contact the guest speaker by Tuesday.",
  "The project notes my will prepare the outline by Thursday.",
  "Daniel will contact the guest speaker by Tuesday if the library agrees.",
])("does not discover summary priorities from a qualified, negated or ambiguous action: %s", (quote) => {
  expect(select(quote).summary).not.toContain(quote);
});

test("keeps the validated final replacement and never resurrects a cancelled literal commitment", () => {
  const previous = "Daniel will contact the guest speaker by Tuesday.";
  const cancelled = "Daniel will not contact the guest speaker by Tuesday.";
  const replacement = "Leah will contact the guest speaker by Friday.";
  const content = [previous, cancelled, replacement, ...background].join(" ");
  const proof: FinalTaskEvidence = { ...proofFor([evidence(content, replacement)]),
    superseded: [{ earlier: evidence(content, previous), later: evidence(content, cancelled, "cancelled") }],
  };
  const before = JSON.stringify(proof);
  const result = selectSourceSummaryResult('{"sentences":[4,5,6,7]}', content, content, proof,
    { preserveLiteralCommitments: true });
  expect(result.summary).toContain(cancelled);
  expect(result.summary).toContain(replacement);
  expect(result.summary).not.toContain(previous);
  expect(JSON.stringify(proof)).toBe(before);
});
