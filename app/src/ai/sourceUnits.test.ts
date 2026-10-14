import { deterministicSourceUnitPlan, projectSourceUnitPlan, sourceUnitsFromPlan, validateSourceUnitPlan } from "./sourceUnits";
import { canSelectSourceSummary, renderSummarySource } from "./summarySelection";

jest.mock("./llm", () => ({}));
jest.mock("./generationMetrics", () => ({ recordGeneration: jest.fn() }));

// Synthetic planning speech preserves source spelling and case, which
// intentionally differ from the punctuation proposal. No private note is embedded.
const actual = "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej kiermasz dotyczy ręcznie robionych ozdób lokalnej ceramiki i obrazów do 14 września mam przygotować trzy Plansze z ofertami wystawców Olga ma do 16 września sprawdzić listę stanowisk zelva ma przygotować plakat informacyjny budżet dekoracji wynosił 680 zł Poprawka aktualny budżet to 430 zł wczoraj wysłałem już zaproszenie do stolarza spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk";
const proposal = "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej. Kiermasz dotyczy ręcznie robionych ozdób, lokalnej ceramiki i obrazów. Do 14 września mam przygotować trzy plansze z ofertami wystawców. Olga ma do 16 września sprawdzić listę stanowisk. Zelva ma przygotować plakat informacyjny. Budżet dekoracji wynosił 680 zł. Poprawka. Aktualny budżet to 430 zł. Wczoraj wysłałem już zaproszenie do stolarza. Spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero. zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk.";

test("projects synthetic speech to original UTF16 units; the preposed deadline, case, names and scalar correction stay literal", () => {
  expect(canSelectSourceSummary(actual, actual)).toBe(false);
  const plan = projectSourceUnitPlan(actual, proposal);
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected original source plan");
  const units = sourceUnitsFromPlan(actual, plan);
  expect(units).toHaveLength(10);
  expect(units[2].text).toBe("do 14 września mam przygotować trzy Plansze z ofertami wystawców");
  expect(units[4].text).toBe("zelva ma przygotować plakat informacyjny");
  expect(units[6].text).toBe("Poprawka aktualny budżet to 430 zł");
  expect(units[8].text).toContain("czternastej trzydzieści zero");
  for (const unit of units) expect(actual.slice(unit.start, unit.end)).toBe(unit.text);
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.ends)).toBe(true);
});

test("an unchanged one-unit proposal cannot unlock a giant mixed action or full-copy summary", () => {
  expect(projectSourceUnitPlan(actual, actual)).toBeNull();
  expect(renderSummarySource(actual, actual)).toBe(`[1] ${actual}`);
});

test("summary selection consumes the same original units instead of restoring every quote to the entire flat parent", () => {
  const plan = projectSourceUnitPlan(actual, proposal);
  if (!plan) throw new Error("Expected original source plan");
  expect(canSelectSourceSummary(actual, actual, plan)).toBe(true);
  expect(renderSummarySource(actual, actual, plan)).toContain("[3] do 14 września mam przygotować");
  const unit = sourceUnitsFromPlan(actual, plan)[6];
  const prepared = `[fact] (source ${unit.start}:${unit.end}; kind fact) ${unit.text}`;
  expect(renderSummarySource(prepared, actual, plan)).toBe(`[1] ${unit.text}`);
});

test.each([
  ["repaired actor", proposal.replace("Zelva", "Zelwa")],
  ["changed verb", proposal.replace("wynosił", "wyniosł")],
  ["changed diacritic", proposal.replace("września", "wrzesnia")],
  ["omitted word", proposal.replace(" trzy ", " ")],
  ["duplicated word", proposal.replace("trzy plansze", "trzy trzy plansze")],
  ["reordered words", proposal.replace("listę stanowisk", "stanowisk listę")],
  ["invented prefix", `Oto tekst: ${proposal}`],
  ["changed currency", proposal.replace("430 zł", "430 EUR")],
])("rejects %s instead of silently using rewritten text", (_label, changed) => {
  expect(projectSourceUnitPlan(actual, changed)).toBeNull();
});

test.each([
  ["PL conditional", "Jeśli magazyn potwierdzi termin Lena ma wysłać szkic do piątku jutro sprawdzę stan", "Jeśli magazyn potwierdzi termin. Lena ma wysłać szkic do piątku. Jutro sprawdzę stan."],
  ["PL disputed", "Nie jest prawdą że Lena ma wysłać szkic do piątku jutro sprawdzę stan", "Nie jest prawdą. Że Lena ma wysłać szkic do piątku. Jutro sprawdzę stan."],
  ["EN quoted", "The example was 'Lena will send the draft' but this was not assigned tomorrow I will check stock", "The example was 'Lena will send the draft'. But this was not assigned. Tomorrow I will check stock."],
  ["EN reported", "She said Lena would send the draft but no assignment was agreed tomorrow I will check stock", "She said Lena would send the draft. But no assignment was agreed. Tomorrow I will check stock."],
])("abstains on %s parent scope even when words align", (_label, source, changed) => {
  expect(projectSourceUnitPlan(source, changed)).toBeNull();
});

test.each([
  ["clock", "Spotkanie jest 10:30 jutro sprawdzę tabelę", "Spotkanie jest 1030. Jutro sprawdzę tabelę."],
  ["hyphen", "Use the pre-approved form tomorrow I will check stock", "Use the preapproved form. Tomorrow I will check stock."],
  ["apostrophe", "We'll check Alice's draft tomorrow then prepare a chart", "Well check Alices draft tomorrow. Then prepare a chart."],
])("preserves existing %s characters", (_label, source, changed) => {
  expect(projectSourceUnitPlan(source, changed)).toBeNull();
});

test("allows original in-word apostrophes/clock/emoji, and derives repeated quotes by ordered positions", () => {
  const source = "We'll check Alice's draft at 10:30 🙂 then prepare a chart we'll check Alice's draft at 10:30 🙂";
  const plan = projectSourceUnitPlan(source, "We'll check Alice's draft at 10:30 🙂. Then prepare a chart. We'll check Alice's draft at 10:30 🙂.");
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected literal source plan");
  const units = sourceUnitsFromPlan(source, plan);
  expect(units).toHaveLength(3);
  expect(units[2].start).toBe(source.lastIndexOf("we'll"));
  for (const unit of units) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
  expect(() => sourceUnitsFromPlan(`${source} changed`, plan)).toThrow(/source|plan/iu);
  expect(() => sourceUnitsFromPlan(source, { ...plan, ends: [1, source.length] })).toThrow(/plan|identity/iu);
});

test.each([
  ["PL", "Agata ma przygotować opis do 20 listopada Marek ma sprawdzić tabelę do 21 listopada Ewa ma wysłać wykres", "Agata ma przygotować opis do 20 listopada. Marek ma sprawdzić tabelę do 21 listopada. Ewa ma wysłać wykres."],
  ["EN", "Alice will send the report by Friday Ben will check the chart by Monday I will review the table", "Alice will send the report by Friday. Ben will check the chart by Monday. I will review the table."],
])("preserves complete %s postposed deadlines instead of rejecting a safe next-owner boundary", (_label, source, output) => {
  const plan = projectSourceUnitPlan(source, output);
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected original source plan");
  expect(sourceUnitsFromPlan(source, plan)).toHaveLength(3);
});

test("preserves source leading/trailing whitespace without an empty final unit", () => {
  const source = "  Jutro sprawdzę tabelę   koszt to 180 zł  \n";
  const plan = projectSourceUnitPlan(source, "Jutro sprawdzę tabelę. Koszt to 180 zł.");
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Expected original source plan");
  expect(sourceUnitsFromPlan(source, plan).map((unit) => unit.text)).toEqual(["Jutro sprawdzę tabelę", "koszt to 180 zł"]);
});

test.each([
  ["PL when", "Gdy klient potwierdzi zgodę Lena ma wysłać szkic do piątku", "Gdy klient potwierdzi zgodę. Lena ma wysłać szkic do piątku."],
  ["PL in case", "W razie akceptacji kosztorysu Lena ma wysłać szkic do piątku", "W razie akceptacji kosztorysu. Lena ma wysłać szkic do piątku."],
  ["PL question", "Czy Lena ma wysłać szkic do piątku", "Czy. Lena ma wysłać szkic do piątku."],
  ["EN provided", "Provided the client approves Lena will send the draft by Friday", "Provided the client approves. Lena will send the draft by Friday."],
  ["EN attribution", "According to an earlier example Lena will send the draft by Friday", "According to an earlier example. Lena will send the draft by Friday."],
])("holds %s even with exact word alignment", (_label, source, output) => {
  expect(projectSourceUnitPlan(source, output)).toBeNull();
});

test("a recomputed public identity cannot bypass the correction-cue invariant", () => {
  const source = "Koszt wynosił 240 zł Poprawka koszt wynosi 180 zł";
  const ends = [source.indexOf(" Poprawka"), source.indexOf(" koszt", source.indexOf("Poprawka")), source.length];
  expect(() => validateSourceUnitPlan(source, { version: 1, source, ends, identity: JSON.stringify([1, source, ends]) })).toThrow(/scope/iu);
});

test("coalesces a preposed deadline with its finite first-person action", () => {
  const source = "Plan omawia aktualne wyniki do 8 października sprawdzę tabelę koszt wynosi 180 zł";
  const plan = projectSourceUnitPlan(source, "Plan omawia aktualne wyniki do 8 października. Sprawdzę tabelę. Koszt wynosi 180 zł.");
  if (!plan) throw new Error("Expected coalesced original source plan");
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual([
    "Plan omawia aktualne wyniki do 8 października sprawdzę tabelę", "koszt wynosi 180 zł",
  ]);
});

test("coalesces the synthetic source's detached preposed deadline without changing other statements", () => {
  const plan = projectSourceUnitPlan(actual, proposal.replace("Do 14 września mam", "Do 14 września. Mam"));
  if (!plan) throw new Error("Expected coalesced original source plan");
  expect(sourceUnitsFromPlan(actual, plan).map(unit => unit.text)).toEqual([
    "To jest notatka o przygotowaniu kiermaszu lokalnej grupy rzemieślniczej",
    "kiermasz dotyczy ręcznie robionych ozdób lokalnej ceramiki i obrazów",
    "do 14 września mam przygotować trzy Plansze z ofertami wystawców",
    "Olga ma do 16 września sprawdzić listę stanowisk",
    "zelva ma przygotować plakat informacyjny",
    "budżet dekoracji wynosił 680 zł",
    "Poprawka aktualny budżet to 430 zł",
    "wczoraj wysłałem już zaproszenie do stolarza",
    "spotkanie z koordynatorem jest 19 września o godzinie czternastej trzydzieści zero",
    "zależy mi na estetycznym kiermaszu i pokazaniu kolorowych wyrobów razem z oznaczeniami stoisk",
  ]);
});

test.each([
  ["negation", "Jutro nie kupujemy nowych filtrów potem sprawdzę stare", "Jutro nie. Kupujemy nowych filtrów. Potem sprawdzę stare.", ["Jutro nie kupujemy nowych filtrów", "potem sprawdzę stare"]],
  ["Polish qualifier", "Lena ma przygotować wykres porównawczy koszt wynosi 180 zł", "Lena ma przygotować wykres. Porównawczy. Koszt wynosi 180 zł.", ["Lena ma przygotować wykres porównawczy", "koszt wynosi 180 zł"]],
  ["complement", "Mam przygotować trzy opisy z wynikami pomiarów koszt wynosi 180 zł", "Mam przygotować trzy opisy. Z wynikami pomiarów. Koszt wynosi 180 zł.", ["Mam przygotować trzy opisy z wynikami pomiarów", "koszt wynosi 180 zł"]],
  ["actor modal negation chain", "Alice will not send the draft by Friday the budget is 180 dollars", "Alice. Will. Not. Send the draft by Friday. The budget is 180 dollars.", ["Alice will not send the draft by Friday", "the budget is 180 dollars"]],
  ["Polish actor modal", "Daniel ma sprawdzić tabelę do piątku koszt wynosi 180 zł", "Daniel. Ma. Sprawdzić tabelę do piątku. Koszt wynosi 180 zł.", ["Daniel ma sprawdzić tabelę do piątku", "koszt wynosi 180 zł"]],
  ["recipient", "Aisha will send the description to Theo before Tuesday the budget is 180 dollars", "Aisha will send the description. To Theo before Tuesday. The budget is 180 dollars.", ["Aisha will send the description to Theo before Tuesday", "the budget is 180 dollars"]],
  ["postposed deadline", "Alice will send the report by Friday the budget is 180 dollars", "Alice will send the report. By Friday. The budget is 180 dollars.", ["Alice will send the report by Friday", "the budget is 180 dollars"]],
  ["number currency complement chain", "Koszt wynosi 180 zł z aktualnymi podatkami spotkanie jest w piątek", "Koszt wynosi 180. Zł. Z aktualnymi podatkami. Spotkanie jest w piątek.", ["Koszt wynosi 180 zł z aktualnymi podatkami", "spotkanie jest w piątek"]],
  ["day month action chain", "Do 8 października mam przygotować tabelę koszt wynosi 180 zł", "Do 8. Października. Mam przygotować tabelę. Koszt wynosi 180 zł.", ["Do 8 października mam przygotować tabelę", "koszt wynosi 180 zł"]],
  ["correction cue forward", "Koszt wynosił 240 zł Poprawka aktualny koszt wynosi 180 zł spotkanie jest w piątek", "Koszt wynosił 240 zł. Poprawka. Aktualny koszt wynosi 180. Zł. Spotkanie jest w piątek.", ["Koszt wynosił 240 zł", "Poprawka aktualny koszt wynosi 180 zł", "spotkanie jest w piątek"]],
])("coalesces proposed %s cuts while preserving complete original quotations", (_label, source, changed, expected) => {
  const plan = projectSourceUnitPlan(source, changed);
  if (!plan) throw new Error("Expected coalesced original source plan");
  const units = sourceUnitsFromPlan(source, plan);
  expect(units.map(unit => unit.text)).toEqual(expected);
  for (const unit of units) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
  expect(plan.ends.at(-1)).toBe(source.length);
});

test.each([
  ["qualifier", "Lena ma przygotować wykres porównawczy koszt wynosi 180 zł", "Lena ma przygotować wykres. Porównawczy koszt wynosi 180 zł."],
  ["complement", "Mam przygotować trzy opisy z wynikami pomiarów", "Mam przygotować trzy opisy. Z wynikami pomiarów."],
  ["actor modal", "Alice will send the draft by Friday", "Alice. Will. Send the draft by Friday."],
])("a coalesced %s with no remaining proposed boundary stays one-unit review", (_label, source, changed) => {
  expect(projectSourceUnitPlan(source, changed)).toBeNull();
});

test.each([
  ["actor modal", "Alice will send the draft by Friday budget is 180 dollars", " will"],
  ["modal action", "Alice will send the draft by Friday budget is 180 dollars", " send"],
  ["recipient", "Aisha will send the description to Theo before Tuesday budget is 180 dollars", " to Theo"],
  ["postposed deadline", "Alice will send the report by Friday", " by Friday"],
  ["day month", "Do 8 października mam przygotować tabelę koszt wynosi 180 zł", " października"],
])("a recomputed public identity cannot admit an unsafe %s cut", (_label, source, cut) => {
  const ends = [source.indexOf(cut), source.length];
  expect(() => validateSourceUnitPlan(source, { version: 1, source, ends,
    identity: JSON.stringify([1, source, ends]) })).toThrow(/scope/iu);
});

test("never removes the source final end to repair a final orphan correction cue", () => {
  const source = "Koszt wynosi 180 zł Poprawka";
  expect(projectSourceUnitPlan(source, "Koszt wynosi 180 zł. Poprawka.")).toBeNull();
});

test.each([
  ["actual Ula", "Notatki dotyczą wystawy minerałów Ula", "prześle opis gabloty do Witka przed wtorkiem"],
  ["unfamiliar actor", "Notatki dotyczą wystawy minerałów Yxora", "wyśle opis gabloty do Witka przed wtorkiem"],
  ["lowercase actor", "Notatki dotyczą wystawy minerałów qelira", "sprawdzi opis gabloty do Witka przed wtorkiem"],
  ["plural actors", "Opis obejmuje dawną ekspozycję Yxora i Qelira", "sprawdzą tabelę przed wtorkiem"],
  ["ongoing sending", "Opis obejmuje dawną ekspozycję Yxora", "przesyła zestawienie do Witka"],
  ["ongoing checking", "Opis obejmuje dawną ekspozycję Qelira", "sprawdza tabelę"],
  ["preparation", "Opis obejmuje dawną ekspozycję Yxora", "przygotuje opis gabloty"],
  ["English finite send", "The note concerns mineral samples Xyrene", "sends the description to Arven by Tuesday"],
  ["English finite check", "The note concerns mineral samples qelira", "checks the table before Tuesday"],
])("coalesces %s with its orphan finite predicate without classifying an actor", (_label, head, predicate) => {
  const tail = "Archiwum zawiera wcześniejsze fotografie";
  const source = `${head} ${predicate} ${tail}`;
  const plan = projectSourceUnitPlan(source, `${head}. ${predicate}. ${tail}.`);
  if (!plan) throw new Error("Expected intact actor and predicate");
  const units = sourceUnitsFromPlan(source, plan);
  expect(units.map(unit => unit.text)).toEqual([`${head} ${predicate}`, tail]);
  for (const unit of units) expect(source.slice(unit.start, unit.end)).toBe(unit.text);
  const ends = [head.length, source.length];
  expect(() => validateSourceUnitPlan(source, { version: 1, source, ends,
    identity: JSON.stringify([1, source, ends]) })).toThrow(/scope/iu);
});

test("keeps ordinary complete finite grammar and explicit next actors as separate proposed units", () => {
  const source = "Ula prześle opis gabloty Qelira sprawdzi tabelę sprawdzę fotografie Archiwum zawiera wcześniejsze opisy";
  const plan = projectSourceUnitPlan(source, "Ula prześle opis gabloty. Qelira sprawdzi tabelę. Sprawdzę fotografie. Archiwum zawiera wcześniejsze opisy.");
  if (!plan) throw new Error("Expected complete source statements");
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual([
    "Ula prześle opis gabloty", "Qelira sprawdzi tabelę", "sprawdzę fotografie", "Archiwum zawiera wcześniejsze opisy",
  ]);
});

test("keeps an original hard sentence boundary before a third-person finite predicate", () => {
  const source = "Notatki dotyczą wystawy minerałów Ula. prześle opis gabloty Archiwum zawiera wcześniejsze opisy";
  const ends = [source.indexOf(" prześle"), source.indexOf(" Archiwum"), source.length];
  const plan = validateSourceUnitPlan(source, { version: 1, source, ends,
    identity: JSON.stringify([1, source, ends]) });
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual([
    "Notatki dotyczą wystawy minerałów Ula.", "prześle opis gabloty", "Archiwum zawiera wcześniejsze opisy",
  ]);
});

test.each([
  "Jeśli urząd zatwierdzi opis Ula prześle opis gabloty Archiwum zawiera fotografie",
  "Powiedziano że Ula prześle opis gabloty Archiwum zawiera fotografie",
  "Opis cytuje 'Ula prześle opis gabloty' Archiwum zawiera fotografie",
])("finite predicate protection cannot unlock a governed or quoted parent: %s", source => {
  const output = source.replace("Ula prześle", "Ula. Prześle").replace(" Archiwum", ". Archiwum") + ".";
  expect(projectSourceUnitPlan(source, output)).toBeNull();
});

test("coalesces the finite predicate with a detached correction cue without dropping the source tail", () => {
  const source = "Ula przesyła opis gabloty Poprawka Ula sprawdzi tabelę Archiwum zawiera fotografie";
  const plan = projectSourceUnitPlan(source, "Ula. Przesyła opis gabloty. Poprawka. Ula. Sprawdzi tabelę. Archiwum zawiera fotografie.");
  if (!plan) throw new Error("Expected literal correction and source tail");
  expect(sourceUnitsFromPlan(source, plan).map(unit => unit.text)).toEqual([
    "Ula przesyła opis gabloty", "Poprawka Ula sprawdzi tabelę", "Archiwum zawiera fotografie",
  ]);
  expect(plan.ends.at(-1)).toBe(source.length);
});

describe("deterministic split of unpunctuated speech", () => {
  const speech = "no więc zbieram myśli po pierwsze przegląd auta mam do końca miesiąca więc muszę się umówić na stacji diagnostycznej najlepiej na jakiś poranek bo po południu są kolejki po drugie faktura dla pana Kowalskiego wysłać ją do jutra bo obiecałem a propos weterynarza szczepienie jest w grudniu mama pytała czy przyjadę na obiad w niedzielę i powiedziałem że tak aha i jeszcze bilet miesięczny doładować w poniedziałek dobra to by było na tyle";

  test("cuts at discourse markers, keeps exact spans and a source that mentions 'czy'", () => {
    const plan = deterministicSourceUnitPlan(speech);
    expect(plan).not.toBeNull();
    const units = sourceUnitsFromPlan(speech, plan!);
    expect(units.length).toBeGreaterThanOrEqual(6);
    for (const unit of units) {
      expect(speech.slice(unit.start, unit.end)).toBe(unit.text);
      expect(unit.text.split(" ").length).toBeLessThanOrEqual(30);
    }
    expect(units.some(unit => unit.text.startsWith("po drugie"))).toBe(true);
    expect(units.some(unit => unit.text.startsWith("a propos"))).toBe(true);
    expect(units.some(unit => unit.text.startsWith("dobra"))).toBe(true);
  });

  test("limits unit length on word boundaries without markers", () => {
    const flat = Array.from({ length: 100 }, (_, i) => `słowo${i}`).join(" ");
    const units = sourceUnitsFromPlan(flat, deterministicSourceUnitPlan(flat)!);
    expect(units.length).toBeGreaterThanOrEqual(3);
    expect(units.every(unit => unit.text.split(" ").length <= 30)).toBe(true);
  });

  test("ignores punctuated or short text and rejects foreign plans of ambiguous sources", () => {
    expect(deterministicSourceUnitPlan("Kupić mleko. Zadzwonić do mamy.")).toBeNull();
    expect(deterministicSourceUnitPlan("kupić mleko")).toBeNull();
    const plan = deterministicSourceUnitPlan(speech)!;
    const forged = { ...plan, ends: [plan.ends[0], speech.length], identity: JSON.stringify([1, speech, [plan.ends[0], speech.length]]) };
    expect(() => validateSourceUnitPlan(speech, forged)).toThrow();
  });
});
