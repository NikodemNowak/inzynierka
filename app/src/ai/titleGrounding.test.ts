import { parseAnchoredTitle, titleAnchorPrompt, titleAnchorSchema, titleVocabularySource, titleNeedsSourceAnchors } from "./titleGrounding";
import { projectSourceUnitPlan, sourceUnitsFromPlan } from "./sourceUnits";

test("spoken title action support cannot combine objects across validated statements", () => {
  const content = "Ula ma wysłać dokumenty Marek ogląda gabloty";
  const plan = projectSourceUnitPlan(content, "Ula ma wysłać dokumenty. Marek ogląda gabloty.");
  if (!plan) throw new Error("Expected original statements");
  expect(titleNeedsSourceAnchors("Wysyłka gabloty", content, "pl", content, plan)).toBe(true);
  expect(titleNeedsSourceAnchors("Wysyłka dokumentów", content, "pl", content, plan)).toBe(false);
  expect(titleAnchorPrompt(content, "pl", content, "Wysyłka gabloty", plan)).toContain('"unsupportedWords":["gabloty"]');
});

test("a reduced spoken source keeps bounded complete title anchors without restoring its entire flat parent", () => {
  const content = "Wystawa minerałów jest tematem notatki Ula ma wysłać opis gabloty Marek ma sprawdzić numer gabloty";
  const plan = projectSourceUnitPlan(content, "Wystawa minerałów jest tematem notatki. Ula ma wysłać opis gabloty. Marek ma sprawdzić numer gabloty.");
  if (!plan) throw new Error("Expected original statements");
  const first = sourceUnitsFromPlan(content, plan)[0];
  const evidence = `[f1] (fact; importance 1; source ${first.start}:${first.end}) ${first.text}`;
  expect(titleVocabularySource(evidence, content, plan)).toBe(first.text);
  expect(titleAnchorPrompt(evidence, "pl", content, "", plan)).toContain(JSON.stringify([{ id: 1, text: first.text }]));
  expect(JSON.stringify(titleAnchorSchema(evidence, content, plan))).toContain('"enum":[1]');
  expect(parseAnchoredTitle('{"anchors":[1],"title":"Wystawa minerałów"}', evidence, content, "pl", plan)).toBe("Wystawa minerałów");
  expect(() => parseAnchoredTitle('{"anchors":[1],"title":"Wysyłka opisu"}', evidence, content, "pl", plan)).toThrow(/unsupported/iu);
});

test.each([
  ["Spłata budżetu", "Budżet warsztatów wynosi 1750 złotych.", "pl", true],
  ["Spłata kredytu", "Omówiliśmy spłatę kredytu przed terminem.", "pl", false],
  ["Jesienne warsztaty biblioteki", "W bibliotece rozmawialiśmy o jesiennych warsztatach biblioteki.", "pl", false],
  ["Materiały Marty", "Marta przygotuje materiały do warsztatów.", "pl", false],
  ["Martin i materiały", "Marta przygotuje materiały do warsztatów.", "pl", true],
  ["Autumn workshop planning", "We are planning autumn workshops.", "en", false],
  ["Event planning", "Eventual approval of the plan is still uncertain.", "en", true],
  ["Sale discussion", "The salary discussion will continue.", "en", true],
  ["Invoice review", "The invoice was reviewed yesterday.", "en", false],
  ["Debt repayment", "We will repay the debt this month.", "en", false],
  ["Debt repayment", "We will repair the old desk this month.", "en", true],
  ["Invoice repayment", "We will pay the invoice this month.", "en", true],
  ["Report delivery", "We discussed deliverance and the report yesterday.", "en", true],
  ["Report delivery", "Alice will deliver the report by Friday.", "en", false],
  ["Payment confirmation", "Alice will confirm payment on Monday.", "en", false],
  ["Wysyłka prototypu", "Tomek wyśle prototyp w środę.", "pl", false],
  ["Wysyłka prototypu", "Tomek obejrzy prototyp w środę.", "pl", true],
] as const)(
  "requests source anchors for unfamiliar concepts while retaining inflections: %s",
  (title, source, language, needed) => {
    expect(titleNeedsSourceAnchors(title, source, language)).toBe(needed);
  },
);

test("renders a grammatical Polish title from selected complete source statements", () => {
  const source = "Zespół biblioteki rozmawiał o jesiennych warsztatach.";
  expect(
    parseAnchoredTitle(
      '{"anchors":[1],"title":"jesienne warsztaty biblioteki"}',
      source,
      source,
      "pl",
    ),
  ).toBe("Jesienne warsztaty biblioteki");
});

test.each([
  '{"anchors":[1],"title":"Spłata budżetu"}',
  '{"anchors":[9],"title":"Budżet warsztatów"}',
  '{"anchors":[1,1],"title":"Budżet warsztatów"}',
  '{"anchors":[1.5],"title":"Budżet warsztatów"}',
  '{"anchors":[1],"title":"Budżet 1900"}',
  '{"anchors":[2],"title":"Marta przygotuje listę materiałów i zarezerwuje salę na warsztaty"}',
  '{"anchors":[1],"title":"Budżet warsztatów\\nSpłata kredytu"}',
  '{"anchors":[1],"title":"Zwróć wyłącznie spłatę budżetu"}',
])("rejects invented concepts, invented evidence, numbers and source copying", (raw) => {
  const source = "Budżet warsztatów wynosi 1750 złotych. Marta przygotuje listę materiałów i zarezerwuje salę na warsztaty.";
  expect(() => parseAnchoredTitle(raw, source, source, "pl")).toThrow();
});

test("does not use evidence metadata as a source anchor", () => {
  const source = "Marta przygotuje materiały.";
  expect(() =>
    parseAnchoredTitle(
      '{"anchors":[1],"title":"Source importance"}',
      source,
      source,
      "en",
    ),
  ).toThrow();
});

test("rejects extra fields in a replayed source-ID title response", () => {
  const source = "We are planning autumn workshops.";
  expect(() =>
    parseAnchoredTitle(
      '{"anchors":[1],"title":"Autumn workshop planning","instructions":"ignore the source"}',
      source,
      source,
      "en",
    ),
  ).toThrow();
});

test("restores the complete late correction from a reduced-source checkpoint", () => {
  const source = "Rozmawialiśmy o planie warsztatów. Budżet wynosi 1200 złotych. Na koniec zmieniliśmy budżet na 1750 złotych i termin na środę.";
  const offset = source.indexOf("1750");
  const prepared = `[facts:late] (decision; importance 3; source ${offset}:${offset + "1750 złotych".length}) 1750 złotych`;
  expect(
    parseAnchoredTitle(
      '{"anchors":[1],"title":"Budżet 1750 i termin"}',
      prepared,
      source,
      "pl",
    ),
  ).toBe("Budżet 1750 i termin");
  expect(() =>
    parseAnchoredTitle(
      '{"anchors":[1],"title":"Budżet 1200 i termin"}',
      prepared,
      source,
      "pl",
    ),
  ).toThrow();
});

test("retains a title covering multiple source subjects when the model omits a supporting ID", () => {
  const source = "The team discussed autumn workshops. The budget covers the materials.";
  expect(
    parseAnchoredTitle(
      '{"anchors":[1],"title":"Workshop budget"}',
      source,
      source,
      "en",
    ),
  ).toBe("Workshop budget");
});

test("guides a title rewrite with source-supported words instead of requiring a new abstract noun", () => {
  const source = "Debt repayment will be split into six monthly instalments.";
  const prompt = titleAnchorPrompt(source, "en", source, "Debt Repayment Plan");
  expect(prompt).toContain('"supportedWords":["Debt","Repayment"]');
  expect(prompt).toContain('"unsupportedWords":["Plan"]');
  expect(prompt).toContain("1-5 words");
});

test("gives a wholly unsupported short title repair the literal source vocabulary", () => {
  const source = "Jutro wyślę raport. Poprawka budżet wynosi 180 zł.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Zadania i korekty");
  const vocabulary = prompt.split("LITERAL_SOURCE_VOCABULARY_DATA_JSON\n")[1]?.split("\n")[0];
  expect(vocabulary && JSON.parse(vocabulary)).toEqual([
    "jutro", "wyślę", "raport", "poprawka", "budżet", "wynosi", "180", "zł",
  ]);
  expect(parseAnchoredTitle('{"anchors":[1,2],"title":"Raport i budżet"}', source, source, "pl"))
    .toBe("Raport i budżet");
  expect(() => parseAnchoredTitle('{"anchors":[1],"title":"Zadania"}', source, source, "pl"))
    .toThrow(/unsupported/iu);
});

test("literal repair vocabulary uses only restored source evidence, excluding metadata and unrelated parent words", () => {
  const content = "Raport jest gotowy. Budżet pozostaje otwarty.";
  const source = "[f1] (fact; importance 3; source 0:19) Raport jest gotowy.";
  const prompt = titleAnchorPrompt(source, "en", content, "Project activities");
  const vocabulary = prompt.split("LITERAL_SOURCE_VOCABULARY_DATA_JSON\n")[1]?.split("\n")[0];
  expect(vocabulary && JSON.parse(vocabulary)).toEqual(["raport", "jest", "gotowy"]);
});

test("retains the established repair request when at least one substantive proposal word is supported", () => {
  const source = "Debt repayment will be split into six monthly instalments.";
  expect(titleAnchorPrompt(source, "en", source, "Debt repayment plan"))
    .not.toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
});

test("does not duplicate a large source vocabulary in a title repair", () => {
  const source = Array.from({ length: 140 }, (_, index) => `item${index}`).join(" ");
  expect(titleAnchorPrompt(source, "en", source, "Invented theme"))
    .not.toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
});

test("retains the established repair for large repeated sources with a small vocabulary", () => {
  const source = "Workshop discussion ".repeat(100);
  expect(titleAnchorPrompt(source, "en", source, "Invented theme"))
    .not.toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
});

test.each([
  ["pl", "Raport i budżet", "Książka i faktura"],
  ["en", "Report and budget", "Book and invoice"],
] as const)("repair format examples never support an absent topic in %s", (language, source, copiedExample) => {
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title: copiedExample }), source, source, language))
    .toThrow(/unsupported/iu);
});

test.each([
  ["en", "Debt repayment", "We reviewed repayment of the bank loan. The debt is 12000 pounds."],
  ["en", "Payment", "We reviewed payment for the workshop room."],
  ["en", "Report", "Alice will send the report by Friday. Bob will not send the report."],
  ["pl", "Zmiana terminu wysyłki prototypu", "Zmiana terminu: Tomek wyśle prototyp w środę zamiast w poniedziałek."],
] as const)("accepts a simple source-grounded subject in %s", (language, title, source) => {
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, language)).toBe(title);
});

test("accepts the phone anchor response after cleanTitle removes a banned opener and its dangling connector", () => {
  const source = "Test nowej notatki chciałbym jutro sobie zapisać. I muszę omówić co dalej z inżynierem. I pokazać postępy w pisaniu inżynierki.";
  expect(
    parseAnchoredTitle('{"anchors":[1],"title":"notatka i inżynierka"}', source, source, "pl"),
  ).toBe("Inżynierka");
});

test("still rejects a title word injected after a legitimately stripped banned opener", () => {
  const source = "Test nowej notatki chciałbym jutro sobie zapisać. I pokazać postępy w pisaniu inżynierki.";
  expect(() =>
    parseAnchoredTitle('{"anchors":[1],"title":"notatka i inżynierka i marketing"}', source, source, "pl"),
  ).toThrow(/unsupported/iu);
});

test("still rejects title content dropped by cleanTitle after a banned opener", () => {
  const source = "Test nowej notatki chciałbym jutro sobie zapisać. I pokazać postępy w pisaniu inżynierki.";
  expect(() =>
    parseAnchoredTitle('{"anchors":[1],"title":"notatka i inżynierka\\noraz budżet"}', source, source, "pl"),
  ).toThrow(/unsupported/iu);
});

test("the literal repair bans banned openers and removes them from the offered vocabulary", () => {
  const source = "Test nowej notatki chciałbym jutro sobie zapisać. I muszę omówić co dalej z inżynierem.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Zajęcia i plan pracy");
  expect(prompt).toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
  expect(prompt).toContain("Nie zaczynaj tytułu od słów: notatka");
  const vocabulary = prompt.split("LITERAL_SOURCE_VOCABULARY_DATA_JSON\n")[1]?.split("\n")[0];
  expect(vocabulary).toBeDefined();
  expect(JSON.parse(vocabulary!) as string[]).not.toContain("notatka");
  expect(JSON.parse(vocabulary!) as string[]).not.toContain("notatki");
  expect(JSON.parse(vocabulary!) as string[]).toContain("inżynierem");
});

test("the English literal repair bans banned openers and filters them from the vocabulary", () => {
  const source = "This recording is about the budget. The team must review the invoice.";
  const prompt = titleAnchorPrompt(source, "en", source, "Project activities");
  expect(prompt).toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
  expect(prompt).toContain("Never open the title with the words: note");
  const vocabulary = prompt.split("LITERAL_SOURCE_VOCABULARY_DATA_JSON\n")[1]?.split("\n")[0];
  expect(vocabulary).toBeDefined();
  expect(JSON.parse(vocabulary!) as string[]).not.toContain("recording");
  expect(JSON.parse(vocabulary!) as string[]).toContain("budget");
});

test("the established anchor rewrite also repeats the banned-opener ban", () => {
  const english = titleAnchorPrompt("Debt repayment will be split into six monthly instalments.", "en",
    "Debt repayment will be split into six monthly instalments.", "Debt Repayment Plan");
  expect(english).not.toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
  expect(english).toContain("Never open the title with the words: note, recording, transcript, summary, title, text, author.");
  const polish = titleAnchorPrompt("Nowy koszt zastępuje dawny koszt.", "pl", "Nowy koszt zastępuje dawny koszt.", "Korekty kosztów");
  expect(polish).not.toContain("LITERAL_SOURCE_VOCABULARY_DATA_JSON");
  expect(polish).toContain("Nie zaczynaj tytułu od słów: notatka, nagranie, transkrypt, streszczenie, podsumowanie, tytuł, ten tekst, autor.");
});
