import { clearSourcePlanCache, readSourcePlanCache, writeSourcePlanCache, type SourcePlanCacheIdentity } from "./sourcePlanCache";
import { projectSourceUnitPlan, type SourceUnitPlan } from "./sourceUnits";

const parts = ["Koszt wynosi sto zł", "Termin spotkania to 12 listopada", "Mapa zawiera aktualne pomiary", "Zachowujemy oryginalny opis"];
const source = parts.join(" ");
const planFor = (prefix = ""): SourceUnitPlan => {
  const text = prefix + source;
  const plan = projectSourceUnitPlan(text, prefix + parts.join(". ") + ".");
  if (!plan) throw new Error("Expected fixture plan");
  return plan;
};
const identityFor = (sourceText = source): SourcePlanCacheIdentity => ({ source: sourceText,
  language: "pl", pipeline: "source-evidence-v22", protocol: "raw-punctuation-v1", modelIdentity: "verified-model-settings" });
beforeEach(clearSourcePlanCache);

test("stores a copied immutable plan and validates a new frozen copy on each hit", () => {
  const plan = planFor();
  const supplied = { ...plan, ends: [...plan.ends] };
  const identity = identityFor();
  writeSourcePlanCache(identity, supplied);
  supplied.ends[0] = supplied.ends[1];
  const first = readSourcePlanCache(identity);
  const second = readSourcePlanCache(identity);
  expect(first).toEqual(plan);
  expect(first).not.toBe(plan);
  expect(first).not.toBe(second);
  expect(first?.ends).not.toBe(second?.ends);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first?.ends)).toBe(true);
});

test.each(["source", "language", "pipeline", "protocol", "modelIdentity"] as const)("does not reuse a different %s identity", (field) => {
  const identity = identityFor();
  writeSourcePlanCache(identity, planFor());
  const different = { ...identity, [field]: field === "language" ? "en" : `${identity[field]} changed` } as SourcePlanCacheIdentity;
  expect(readSourcePlanCache(different)).toBeNull();
  expect(readSourcePlanCache(identity)).not.toBeNull();
});

test("least recently used eviction keeps recently read plans within four entries", () => {
  const fixtures = ["A ", "B ", "C ", "D ", "E "].map((prefix) => ({ identity: identityFor(prefix + source), plan: planFor(prefix) }));
  for (const fixture of fixtures.slice(0, 4)) writeSourcePlanCache(fixture.identity, fixture.plan);
  expect(readSourcePlanCache(fixtures[0].identity)).not.toBeNull();
  writeSourcePlanCache(fixtures[4].identity, fixtures[4].plan);
  expect(readSourcePlanCache(fixtures[1].identity)).toBeNull();
  expect(readSourcePlanCache(fixtures[0].identity)).not.toBeNull();
  expect(readSourcePlanCache(fixtures[4].identity)).not.toBeNull();
});

test("serialized character bound evicts large older entries without retaining an oversized plan", () => {
  const prefix = "Opis ".repeat(2500);
  const first = { identity: identityFor(prefix + source), plan: planFor(prefix) };
  const second = { identity: identityFor(`Nowy ${prefix}${source}`), plan: planFor(`Nowy ${prefix}`) };
  writeSourcePlanCache(first.identity, first.plan);
  expect(readSourcePlanCache(first.identity)).not.toBeNull();
  writeSourcePlanCache(second.identity, second.plan);
  expect(readSourcePlanCache(first.identity)).toBeNull();
  expect(readSourcePlanCache(second.identity)).not.toBeNull();
  const oversized = "Opis ".repeat(15000);
  writeSourcePlanCache(identityFor(oversized + source), planFor(oversized));
  expect(readSourcePlanCache(identityFor(oversized + source))).toBeNull();
  expect(readSourcePlanCache(second.identity)).not.toBeNull();
});

test("owner abort invalidates admission, while aborting an evicted owner cannot remove a newer accepted plan", () => {
  const first = new AbortController();
  const second = new AbortController();
  const identity = identityFor();
  writeSourcePlanCache(identity, planFor(), first.signal);
  writeSourcePlanCache(identity, planFor(), second.signal);
  first.abort();
  expect(readSourcePlanCache(identity)).not.toBeNull();
  second.abort();
  expect(readSourcePlanCache(identity)).toBeNull();
  writeSourcePlanCache(identity, planFor(), second.signal);
  expect(readSourcePlanCache(identity)).toBeNull();
});

test("clearing retained plans also removes their abort subscriptions", () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  writeSourcePlanCache(identityFor(), planFor(), controller.signal);
  clearSourcePlanCache();
  expect(readSourcePlanCache(identityFor())).toBeNull();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("an invalid plan never replaces a previously validated entry", () => {
  const identity = identityFor();
  const plan = planFor();
  writeSourcePlanCache(identity, plan);
  expect(() => writeSourcePlanCache(identity, { ...plan, source: source + " changed" })).toThrow(/identity/iu);
  expect(readSourcePlanCache(identity)).toEqual(plan);
});
