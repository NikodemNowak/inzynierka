import { prepareSpokenSource } from "./spokenSource";
import { collectSourceEvidence, prepareGlobalSource } from "./sourcePipeline";
import { projectSourceUnitPlan, sourceUnitsFromPlan } from "./sourceUnits";
import { generate } from "./llm";
import type { ProcessingCheckpointStore } from "./processingContext";

jest.mock("./llm", () => ({
  generate: jest.fn(), getLoadedModelInfo: jest.fn(() => null), getContextWindowSize: jest.fn(() => 8192),
  measureFormattedPromptTokens: jest.fn(async ({ userPrompt }: { userPrompt: string }) => Math.ceil(userPrompt.length / 3)),
}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));
const model = jest.mocked(generate);
const generated = (text: string) => ({ text, ttftMs: 1, tokensPerSecond: 20, wallMs: 20, promptMs: 1, predictedMs: 19, promptTokens: 200, predictedTokens: 80 });
const sentences = Array.from({ length: 390 }, (_, i) => `Materiał numer ${i + 1} opisuje powierzchnię mapy oraz kolory ścian przy wejściu`);
const source = sentences.join(" ");
const punctuation = (text: string): string => text.replace(/przy wejściu(?=\s|$)/gu, "przy wejściu.");
const store = (): ProcessingCheckpointStore => { const values = new Map<string, unknown>(); return { read: jest.fn(async key => values.get(key) ?? null), write: jest.fn(async (key, value) => { values.set(key, value); }) }; };
beforeEach(() => { jest.clearAllMocks(); model.mockReset(); });

test("long speech retains every original statement without a whole-source output ceiling", async () => {
  const checkpoint = store();
  model.mockImplementation(async prompt => {
    const text = prompt.slice(prompt.indexOf("\n\n") + 2);
    expect(text.length).toBeLessThan(source.length);
    return generated(punctuation(text));
  });
  const plan = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected literal long plan");
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual(sentences);
  expect(model.mock.calls.length).toBeGreaterThan(1);
  for (const unit of sourceUnitsFromPlan(source, plan)) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
  model.mockClear();
  expect(await prepareSpokenSource(source, "pl", { checkpoint })).toEqual(plan);
  expect(model).not.toHaveBeenCalled();
});

test("seventeen aligned statements remain valid original evidence", () => {
  const content = sentences.slice(0, 17).join(" ");
  expect(projectSourceUnitPlan(content, punctuation(content))?.ends).toHaveLength(17);
});

test("planned evidence splits at original statement ends and replays without inference", async () => {
  const plan = projectSourceUnitPlan(source, punctuation(source));
  if (!plan) throw new Error("Expected source plan");
  const checkpoint = store();
  model.mockImplementation(async prompt => {
    const block = prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];
    expect(block.split("\n").every(line => sentences.some(sentence => line.endsWith(sentence)))).toBe(true);
    expect(prompt.length).toBeLessThan(source.length * 2);
    return generated('{"facts":[1]}');
  });
  const first = await collectSourceEvidence(source, "facts", "pl", { checkpoint, sourceUnitPlan: plan });
  expect(first.length).toBeGreaterThan(1);
  for (const item of first) expect(source.slice(item.start, item.end)).toBe(item.quote);
  model.mockClear();
  expect(await collectSourceEvidence(source, "facts", "pl", { checkpoint, sourceUnitPlan: plan })).toEqual(first);
  expect(model).not.toHaveBeenCalled();
});

test("a changed window cannot publish a complete source plan", async () => {
  const checkpoint = store();
  model.mockImplementationOnce(async prompt => generated(punctuation(prompt.slice(prompt.indexOf("\n\n") + 2))))
    .mockImplementation(async prompt => generated(punctuation(prompt.slice(prompt.indexOf("\n\n") + 2)).replace("mapy", "dachu")));
  expect(await prepareSpokenSource(source, "pl", { checkpoint })).toBeNull();
  expect(jest.mocked(checkpoint.write).mock.calls.some(([key]) => key === `source_structure:0:${source.length}`)).toBe(false);
});

test("windows cannot bypass an unpunctuated conditional governing the parent", async () => {
  expect(await prepareSpokenSource(`Jeśli klient potwierdzi zgodę ${source} Lena ma wysłać plan do piątku`, "pl")).toBeNull();
  expect(model).not.toHaveBeenCalled();
});

test("global planned evidence retains the guarded whole topic even when the model omits its ID", async () => {
  const topic = "Notatki dotyczą wystawy minerałów";
  const content = `${topic} ${source}`;
  const plan = projectSourceUnitPlan(content, `${topic}. ${punctuation(source)}`);
  if (!plan) throw new Error("Expected complete statements");
  const checkpoint = store();
  model.mockImplementation(async prompt => {
    const block = prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];
    const ids = [...block.matchAll(/^\[(\d+)\]/gmu)].map(match => Number(match[1]));
    return generated(JSON.stringify({ facts: [ids.at(-1)] }));
  });
  const requests = [{ system: "title", prompt: (text: string) => text, nPredict: 40 }];
  const prepared = await prepareGlobalSource(content, requests, "pl", { checkpoint, sourceUnitPlan: plan });
  expect(prepared).toContain(`[topic:0:${topic.length}] (fact; importance 3; source 0:${topic.length}) ${topic}`);
  expect(prepared.length).toBeLessThan(content.length);
  model.mockClear();
  expect(await prepareGlobalSource(content, requests, "pl", { checkpoint, sourceUnitPlan: plan })).toBe(prepared);
  expect(model).not.toHaveBeenCalled();
});

test("an unchanged prefix owns fewer words when the generated lookahead is rewritten", async () => {
  const checkpoint = store();
  model.mockImplementation(async prompt => {
    const text = prompt.slice(prompt.indexOf("\n\n") + 2);
    const words = text.split(/\s+/u);
    const proposal = punctuation(words.slice(0, 100).join(" "));
    return generated(proposal);
  });
  const plan = await prepareSpokenSource(source, "pl", { checkpoint });
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected original prefix ownership");
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual(sentences);
  expect(model.mock.calls.length).toBeLessThanOrEqual(75);
  model.mockClear();
  expect(await prepareSpokenSource(source, "pl", { checkpoint })).toEqual(plan);
  expect(model).not.toHaveBeenCalled();
});

test("punctuation joining two clock digits preserves their exact original source words", async () => {
  const text = `${sentences.slice(0, 16).join(" ")} Spotkanie jest 23 listopada o 15 45 Lena ma sprawdzić tabelę do piątku`;
  model.mockImplementation(async prompt => generated(punctuation(prompt.slice(prompt.indexOf("\n\n") + 2))
    .replace("15 45", "15:45.").replace("do piątku", "do piątku.")));
  const plan = await prepareSpokenSource(text, "pl");
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected literal digit units");
  expect(sourceUnitsFromPlan(text, plan).some(unit => unit.text.includes("15 45"))).toBe(true);
  expect(plan.source).toBe(text);
});

test("an incomplete planned response retries smaller complete original units and replays every split", async () => {
  const content = sentences.slice(0, 12).join(" ");
  const plan = projectSourceUnitPlan(content, punctuation(content));
  if (!plan) throw new Error("Expected original plan");
  const checkpoint = store();
  model.mockImplementation(async prompt => {
    const block = prompt.split("SOURCE_START\n")[1].split("\nSOURCE_END")[0];
    const ids = [...block.matchAll(/^\[(\d+)\]/gmu)].map(match => Number(match[1]));
    if (ids.length > 4) return { ...generated('{"facts":[1]}'), completion: { status: "stopped_limit", truncated: true, stoppedLimit: true, stoppedEos: false, interrupted: false, contextFull: false, stoppingWord: "" } };
    return generated(JSON.stringify({ facts: ids }));
  });
  const result = await collectSourceEvidence(content, "facts", "pl", { checkpoint, sourceUnitPlan: plan });
  expect(result.map(item => item.quote)).toEqual(sentences.slice(0, 12));
  model.mockClear();
  expect(await collectSourceEvidence(content, "facts", "pl", { checkpoint, sourceUnitPlan: plan })).toEqual(result);
  expect(model).not.toHaveBeenCalled();
});
