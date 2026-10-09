import { renderSummarySource, selectSourceSummary, selectSourceSummaryResult, summarySelectionMaximum, summarySelectionSchema } from "./summarySelection";
import type { FinalTaskEvidence, SourceReviewSpan } from "./processingContext";
import type { SourceEvidence } from "./sourcePipeline";
import { ENGLISH_AUDIO_FIXTURE_DATA } from "./benchmarkAudioFixturesData";
import { projectSourceUnitPlan } from "./sourceUnits";

describe("dense short-note summary coverage", () => {
  const parts = [
    "Planujemy jesienny kiermasz grupy",
    "do piątku mam wysłać listę stoisk koordynatorom",
    "Olga ma do soboty sprawdzić plan sali",
    "Zelva ma do niedzieli przygotować wzór plakatu",
    "budżet wynosił 680 zł",
    "Poprawka aktualny budżet to 430 zł",
    "nie kupujemy dodatkowego reflektora",
    "przygotowałem dekoracje sali wczoraj"
  ];

  it("retains the three duties, corrected amount and negative purchase decision from physical Polish speech", () => {
    const source = parts.join(" ");
    const plan = projectSourceUnitPlan(source, parts.join(". ") + ".");
    if (!plan) throw new Error("Expected literal source plan");
    const proof = taskProof(parts.slice(1, 4).map(quote => taskQuote(source, quote)));
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(2, 6), source, source, proof, { sourceUnitPlan: plan });

    expect(result).toEqual({
      summary: [parts[1], parts[2], parts[3], parts[5], parts[6]].join("\n"),
      incomplete: false,
    });
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
    expect(JSON.stringify(proof)).toBe(before);
  });

  it("retains five confirmed English facts while omitting introductory, obsolete and completed material", () => {
    const sentences = [
      "This note records the application review.",
      "I will send the measurements by Friday.",
      "Noah will check the timing table by Thursday.",
      "Ella will prepare the comparison chart by Monday.",
      "The initial budget was 120 dollars.",
      "Correction the final budget is 180 dollars.",
      "We must not buy a new microphone.",
      "I completed the file backup yesterday.",
    ];
    const source = sentences.join(" ");
    const proof = taskProof(sentences.slice(1, 4).map(quote => taskQuote(source, quote)));
    const result = selectSourceSummaryResult(selection(2, 6), source, source, proof);

    expect(result).toEqual({
      summary: [sentences[1], sentences[2], sentences[3], sentences[5], sentences[6]].join(" "),
      incomplete: false,
    });
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });

  it("still reports exact omitted facts when a whole duty quote prevents meaningful compression", () => {
    const compound = [parts.slice(0, 2).join(" "), ...parts.slice(2)];
    const source = compound.join(" ");
    const plan = projectSourceUnitPlan(source, compound.join(". ") + ".");
    if (!plan) throw new Error("Expected literal source plan");
    const proof = taskProof(compound.slice(0, 3).map(quote => taskQuote(source, quote)));
    const result = selectSourceSummaryResult(selection(1, 5), source, source, proof, { sourceUnitPlan: plan });

    expect(result.summary).toBe([compound[0], compound[1], compound[2], compound[4]].join("\n"));
    expect(result.incomplete).toBe(true);
    expect(result.omittedImportantFacts).toEqual([{
      start: source.indexOf(parts[6]), end: source.indexOf(parts[6]) + parts[6].length,
      quote: parts[6], reason: "Important source fact exceeds summary capacity",
    }]);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });
});

describe("selected Polish correction visibility with protected coverage", () => {
  const duties = ["Paweł ma opisać próbki do piątku", "Zofia ma sprawdzić tabelę do poniedziałku", "Roman ma zamówić materiały do wtorku", "Daria ma przygotować wykres do środy"];
  const first = "budżet transportu wynosił 240 zł";
  const background = "sala ma dwa wejścia a odbiór materiałów odbędzie się po zakończeniu przygotowań";
  const evaluate = (correction: string) => {
    const parts = [...duties, first, correction, background];
    const source = parts.join(" ");
    const plan = projectSourceUnitPlan(source, parts.join(". ") + ".");
    if (!plan) throw new Error("Expected literal source plan");
    const proof = taskProof(duties.map((quote) => taskQuote(source, quote)));
    return { source, result: selectSourceSummaryResult(selection(2, 6), source, source, proof, {sourceUnitPlan: plan}) };
  };
  it("retains the selected current correction after four validated obligations when compression permits", () => {
    const correction = "poprawka aktualny budżet transportu wynosi 180 zł";
    const {source, result} = evaluate(correction);
    expect(result.summary.split("\n")).toEqual([...duties, correction]);
    expect(summarySelectionMaximum(source, source, projectSourceUnitPlan(source, [...duties,first,correction,background].join(". ") + ".")!)).toBe(4);
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });
  it.each(["poprawka aktualny budżet transportu wynosił 180 zł", "poprawka aktualny budżet transportu nie wynosi 180 zł"])("does not label a past or negated scalar a current correction: %s", correction => {
    const {result} = evaluate(correction);
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
  });
  it.each([
    '"poprawka aktualny budżet transportu wynosi 180 zł"',
    "poprawka jeśli budżet transportu wynosi 180 zł",
    "Alicja powiedziała że poprawka aktualny budżet transportu wynosi 180 zł",
    "poprawka poprzedni budżet transportu wynosi 180 zł",
    "poprawka aktualny budżet transportu wynosi 180 zł?",
  ])("does not promote a quoted, conditional, reported, historical or questioned correction: %s", correction => {
    const source = [...duties,first,correction,background].map(quote => /[?]$/u.test(quote) ? quote : quote + ".").join(" ");
    const proof = taskProof(duties.map(quote => taskQuote(source,quote+".")));
    const result = selectSourceSummaryResult(selection(2,6),source,source,proof);
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
  });
});

describe("validated task priority does not infer unrelated lexical changes", () => {
  const unknown = "The session concerns current arrangements my will prepare the first outline by Thursday.";
  const assigned = "Clara will contact the guest speaker by Tuesday.";
  const descriptive = "The discussion concerned background rather than a final sequence of questions for the guest speaker.";
  const other = "Walter will send the revised attendance list by Wednesday.";
  const replacement = "The first room reservation was canceled so we must use the second room.";
  const policy = "We must not buy any additional equipment.";
  const amount = "Correction, the final approved budget is 1450 dollars.";
  const event = "The next planning review is on November 8 at 14:00.";
  const nominal = "The schedule the participants and the updated attendance list.";
  const background = "The remaining material describes previous examples and observations without assigning additional work or establishing another current decision.";
  const source = [unknown, assigned, descriptive, other, replacement, policy, amount, event, nominal,
    ...Array.from({ length: 10 }, () => background)].join(" ");

  it("preserves seven literal current commitments, unknown-owner review, restriction, corrected amount and calendar without a lexical background slot", () => {
    const proof: FinalTaskEvidence = { ...taskProof([assigned, other, replacement].map((quote) => taskQuote(source, quote))),
      reviewSpans: [{ start: 0, end: unknown.length, quote: unknown, reason: "Source action has an unresolved subject (ID 1)" }] };
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(5, 7, 8, 9), source, source, proof, { preserveLiteralCommitments: true });
    expect(result.summary).toBe([unknown, assigned, other, replacement, policy, amount, event].join(" "));
    expect(result.summary).not.toContain(descriptive);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(result.incomplete).toBe(true); // The unknown actor remains a review.
    expect(renderSummarySource(result.summary, result.summary).split("\n")).toHaveLength(7);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
    expect(JSON.stringify(proof)).toBe(before);
  });

  it("keeps an unrelated descriptive sentence when the model explicitly selected it and capacity permits", () => {
    const proof = taskProof([taskQuote(source, assigned)]);
    const result = selectSourceSummaryResult(selection(2, 3, 7, 8), source, source, proof);
    expect(result.summary).toContain(descriptive);
    expect(result.summary).toContain(assigned);
    expect(result.summary).toContain(amount);
    expect(result.summary).toContain(event);
  });

  it("retains already validated terminal cancellation quotes for a surviving action in a compound source sentence", () => {
    const compound = "Clara will send the report by Tuesday and Walter will check the list by Friday.";
    const cancelled = "Clara will not send the report by Tuesday.";
    const content = [compound, cancelled, amount, event, ...Array.from({ length: 10 }, () => background)].join(" ");
    const earlier = { ...taskQuote(content, compound), task: "Clara will send the report by Tuesday" };
    const later = { ...taskQuote(content, cancelled), kind: "cancelled" as const };
    const current = { ...taskQuote(content, compound), task: "Walter will check the list by Friday" };
    const proof: FinalTaskEvidence = { ...taskProof([current]), superseded: [{ earlier, later }] };
    const result = selectSourceSummaryResult(selection(3, 4, 5, 6), content, content, proof);
    expect(result.summary).toContain(compound);
    expect(result.summary).toContain(cancelled);
    expect(result.summary).toContain(amount);
    expect(result.summary).toContain(event);
  });
});

describe("current Polish negative purchase policies stay visible without exchanging selected facts", () => {
  const action = "Sprawdzę dostępność sali przed wysłaniem zaproszeń.";
  const calendar = "Następne spotkanie jest 9 listopada o godzinie 15.";
  const background = "Pozostała część notatki opisuje dawne fotografie, historyczne przykłady, rozmaite miejsca i materiały pomocnicze bez żadnych aktualnych ustaleń ani nowych działań.";
  const withPolicy = (policy: string): string => [action, policy, calendar, background].join(" ");

  it("reports the exact omitted policy from the genuine first-person PL raw selection [3,5] without dropping the current cost or date", () => {
    const sentences = [
      "Zakończyłem porządkowanie starych załączników wczoraj.",
      "Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.",
      "Nowy koszt wynosi 1800 złotych i zastępuje dawne 1200 złotych.",
      "Na spotkanie nie kupujemy nowego projektora.",
      calendar,
    ];
    const source = sentences.join(" ");
    const proof = taskProof([taskQuote(source, sentences[1])]);
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(3, 5), source, source, proof);
    expect(result.summary).toBe([sentences[1], sentences[2], sentences[4]].join(" "));
    expect(result.incomplete).toBe(true);
    expect(result.omittedImportantFacts).toEqual([{ start: source.indexOf(sentences[3]), end: source.indexOf(sentences[3]) + sentences[3].length, quote: sentences[3], reason: "Important source fact exceeds summary capacity" }]);
    expect(JSON.stringify(proof)).toBe(before);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });

  it.each([
    "Nie kupujemy nowych materiałów.",
    "Nie zamawiamy dodatkowego wyposażenia.",
    "Nie dokupujemy nowych teczek.",
    "Na wydarzenie nie kupujemy nowych materiałów.",
    "Dla zespołu nie zamawiamy dodatkowego wyposażenia.",
    "Do pracowni nie dokupujemy nowych teczek.",
    "W ramach przygotowań nie kupujemy dodatkowych akcesoriów.",
    "Podczas zebrania nie zamawiamy kolejnych materiałów.",
    "My nie kupimy dodatkowego wyposażenia.",
    "Na wydarzenie nie zamówimy nowych materiałów.",
    "Dla zespołu nie dokupimy kolejnych teczek.",
    "Do pracowni nie będziemy kupować nowych materiałów.",
    "Obecnie nie będziemy zamawiać dodatkowego wyposażenia.",
    "Teraz nie będziemy dokupować kolejnych teczek.",
  ])("appends the complete unselected current policy when unchanged capacity permits: %s", (policy) => {
    const source = withPolicy(policy);
    const proof = taskProof([]);
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(1, 3), source, source, proof);
    expect(result.summary).toBe([action, policy, calendar].join(" "));
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(JSON.stringify(proof)).toBe(before);
  });

  it.each([
    "Na wydarzenie nie kupiliśmy nowych materiałów.",
    "Dla zespołu nie zamawialiśmy dodatkowego wyposażenia.",
    "Do pracowni nie dokupiliśmy kolejnych teczek.",
    "Na poprzednie spotkanie nie kupujemy nowych materiałów.",
    "W ramach zeszłorocznych przygotowań nie zamawiamy wyposażenia.",
    "Podczas ubiegłego zebrania nie dokupujemy teczek.",
    "Jeśli koszt wzrośnie, na wydarzenie nie kupujemy nowych materiałów.",
    "Na wydarzenie nie kupujemy nowych materiałów, jeśli koszt wzrośnie.",
    "Na wydarzenie nie kupimy nowych materiałów pod warunkiem zgody.",
    "Na wydarzenie nie będziemy kupować materiałów dopóki koszt nie spadnie.",
    "Na wydarzenie nie kupujemy materiałów chyba że zmienimy plan.",
    "Na wydarzenie nie kupujemy materiałów o ile plan pozostanie aktualny.",
    '„Na wydarzenie nie kupujemy nowych materiałów”.',
    "‘Na wydarzenie nie zamawiamy nowych materiałów’.",
    "'Na wydarzenie nie zamawiamy nowych materiałów'.",
    "Powiedzieliśmy, że na wydarzenie nie kupujemy nowych materiałów.",
    "Według starego protokołu na wydarzenie nie zamawiamy materiałów.",
    "Na wydarzenie nie kupujemy materiałów było wcześniejszym ustaleniem.",
    "Na wydarzenie nie zamawiamy materiałów powiedział klient.",
    "Na wydarzenie nie kupujemy nowych materiałów?",
    "Czy na wydarzenie nie zamówimy nowych materiałów?",
    "Może na wydarzenie nie kupimy nowych materiałów.",
    "Na wydarzenie nie będzie kupione nowe wyposażenie.",
    "Na wydarzenie nie mamy materiałów.",
  ])("does not add unsupported past/quoted/reported/conditional scope as current policy: %s", (policy) => {
    const source = withPolicy(policy);
    expect(selectSourceSummaryResult(selection(1, 3), source, source, taskProof([]))).toEqual({ summary: [action, calendar].join(" "), incomplete: false });
  });

  it("reports exact UTF16 omission with seven genuine commitments instead of raising the seven-sentence cap", () => {
    const commitments = Array.from({ length: 7 }, (_, index) => `Osoba ${index + 1} sprawdzi przydzielony dokument przed piątkiem.`);
    const policy = "Na wydarzenie nie zamówimy dodatkowego wyposażenia.";
    const source = [...commitments, "🧪 Zwykły opis pomocniczy.", policy, background, background, background].join(" ");
    const proof = taskProof(commitments.map((quote) => taskQuote(source, quote)));
    const result = selectSourceSummaryResult(selection(1, 2, 3, 4), source, source, proof);
    expect(result.summary).toBe(commitments.join(" "));
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
    expect(result.incomplete).toBe(true);
    const omitted = result.omittedImportantFacts;
    expect(omitted).toEqual([{ start: source.indexOf(policy), end: source.indexOf(policy) + policy.length, quote: policy, reason: "Important source fact exceeds summary capacity" }]);
    for (const span of omitted ?? []) expect(source.slice(span.start, span.end)).toBe(span.quote);
  });

  it("does not resurrect a whole policy removed by validated later source evidence", () => {
    const policy = "Na wydarzenie nie kupimy dodatkowego wyposażenia.";
    const later = "Klient zamówi dodatkowe wyposażenie przed piątkiem.";
    const source = [action, policy, later, calendar, background, background].join(" ");
    const earlierEvidence = taskQuote(source, policy);
    const laterEvidence = taskQuote(source, later);
    const result = selectSourceSummaryResult(selection(1, 3, 4), source, source, taskProof([laterEvidence], [{ earlier: earlierEvidence, later: laterEvidence }]));
    expect(result.summary).not.toContain(policy);
    expect(result.summary).toContain(later);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(result.incomplete).toBe(false);
  });
});

const taskQuote = (source: string, quote: string, task = quote): SourceEvidence => ({
  id: `task-${source.indexOf(quote)}`, start: source.indexOf(quote), end: source.indexOf(quote) + quote.length,
  quote, task, kind: "active", importance: 2, change: false,
});
const taskProof = (evidence: SourceEvidence[], superseded: FinalTaskEvidence["superseded"] = []): FinalTaskEvidence => ({
  tasks: evidence.map((entry) => entry.task ?? entry.quote), evidence, superseded, warnings: [],
});

describe("one direct current calendar fact stays visible without creating a task", () => {
  const context = "The rest of the source concerns ordinary descriptive archive material, older photographs, familiar routes, earlier examples, and the background to the project without any new assignment.";
  test("reports exact true-capacity loss of a selected monetary estimate instead of silently exchanging it for a date", () => {
    const action = "Eliza has not completed the table and must send the revised version by Friday.";
    const history = "Bruno completed the archive task yesterday.";
    const correction = "The final estimate is 1800 dollars and replaces the previous 1200 dollars.";
    const calendar = "The current review is on November 9 at three in the afternoon.";
    const source = [action, history, correction, calendar].join(" ");
    const result = selectSourceSummaryResult(selection(1, 3), source, source, taskProof([taskQuote(source, action)]));
    expect(result.summary).toContain(correction);
    expect(result.incomplete).toBe(true);
    expect(result.omittedImportantFacts).toEqual([expect.objectContaining({ quote: calendar, start: source.indexOf(calendar), end: source.length })]);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });
  test.each([
    "The current review is on November 9 at three in the afternoon.",
    "The current team meeting is on January 14 at 09:30.",
  ])("restores a missing complete singleton schedule: %s", (calendar) => {
    const action = "Eliza has not completed the table and must send the revised version by Friday.";
    const source = [action, "Bruno completed the archive task yesterday.", "The final estimate is 1800 dollars and replaces the previous 1200 dollars.", calendar, context].join(" ");
    const result = selectSourceSummaryResult(selection(1, 3), source, source, taskProof([taskQuote(source, action)]));
    expect(result.summary).toContain(calendar);
    expect(result.summary).toContain(action);
    expect(result.incomplete).toBe(false);
  });
  test.each([
    "If confirmed, the current review is on November 9 at three in the afternoon.",
    'The memo says "the current review is on November 9 at three in the afternoon".',
    "The current review is on November 9 at three in the afternoon if the room is available.",
    "The current review is on November 9 at three in the afternoon. That review was cancelled.",
    "The current review is on November 9 at three in the afternoon. The team meeting is on November 10 at 10:30.",
  ])("leaves qualified, reported, revoked or competing calendar prose to the model: %s", (calendar) => {
    const action = "Eliza will send the table by Friday.";
    const background = "The archive contains older photographs of familiar places.";
    const source = [action, background, calendar, context].join(" ");
    expect(selectSourceSummaryResult(selection(1, 2), source, source, taskProof([taskQuote(source, action)])).summary).toBe(action + " " + background);
  });
});

const selection = (...sentences: number[]): string =>
  JSON.stringify({ sentences });

describe("direct closed current monetary correction coverage", () => {
  const background = Array.from({ length: 12 }, (_, index) => `Background item ${index + 1} describes ordinary archive photographs and familiar places with explanatory historical context about their shapes and colours.`);
  const correction = "Correction the final amount is 3910 pounds instead of 2480 pounds.";

  it.each([
    correction,
    "The current approved budget is $720 instead of $510.",
    "Update: the final cost is £3,910 rather than £2,480.",
    "Correction the final amount is three hundred pounds instead of two hundred pounds.",
    "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych.",
    "Poprawka aktualny budżet wynosi 720 złotych zamiast 510 złotych.",
    "Kwota końcowa wynosi 3910 złotych i zastępuje 2480 złotych.",
  ])("adds only the exact unselected current quote without modifying task proof: %s", quote => {
    const source = [quote, ...background].join(" ");
    const proof = taskProof([]);
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(2, 3, 4, 5), source, source, proof);
    expect(result.summary).toContain(quote);
    expect(result.summary).toContain(background[0]);
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(JSON.stringify(proof)).toBe(before);
    expect(proof.tasks).toEqual([]);
  });

  it("gives the current correction a slot before optional context within the unchanged four-statement budget", () => {
    const source = [correction, ...background.slice(0, 7)].join(" ");
    expect(summarySelectionMaximum(source, source)).toBe(4);
    const result = selectSourceSummaryResult(selection(2, 3, 4, 5), source, source, taskProof([]));
    expect(result.summary).toBe([correction, ...background.slice(0, 3)].join(" "));
    expect(result.summary.split(/(?<=[.!?])\s+/u)).toHaveLength(4);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });

  it("does not delete a model-selected old amount when the new quote names its old value", () => {
    const previous = "The amount is 2480 pounds.";
    const source = [previous, correction, ...background].join(" ");
    const result = selectSourceSummaryResult(selection(1, 3, 4, 5), source, source, taskProof([]));
    expect(result.summary).toContain(previous);
    expect(result.summary).toContain(correction);
  });

  it("retains the exact unselected correction after four duties without adding optional context", () => {
    const duties = ["Anna will send the report by Friday.", "Bora will check the display by Tuesday.", "Clara will book the room by Wednesday.", "Dario will prepare the list by Thursday."];
    const source = [...duties, correction, ...background.slice(0, 3)].join(" ");
    const proof = taskProof(duties.map(quote => taskQuote(source, quote)));
    const result = selectSourceSummaryResult(selection(1, 2, 3, 4), source, source, proof);
    expect(result.summary).toBe([...duties, correction].join(" "));
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
  });

  it("reports the whole monetary quote when adding it would reach the eighty-percent word boundary", () => {
    const quote = correction;
    const source = [quote, "Context.", "Other."].join(" ");
    const result = selectSourceSummaryResult(selection(2, 3), source, source, taskProof([]));
    expect(result.summary).toBe("Context. Other.");
    expect(result.incomplete).toBe(true);
    expect(result.omittedImportantFacts).toEqual([expect.objectContaining({ start: 0, end: quote.length, quote })]);
  });

  it("uses the full validated source plan even when prepared evidence omits the monetary statement", () => {
    const quote = "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych";
    const parts = ["🧪 Material about archive photographs", quote, ...background.slice(0, 7).map(text => text.slice(0, -1))];
    const source = parts.join(" ");
    const plan = projectSourceUnitPlan(source, parts.join(". ") + ".");
    if (!plan) throw new Error("Expected complete original source plan");
    const prepared = parts.slice(2, 8).map((text, index) => `[facts:${index}] (fact; importance 2; source ${source.indexOf(text)}:${source.indexOf(text) + text.length}) ${text}`).join("\n");
    const proof = taskProof([]);
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(1, 2, 3), prepared, source, proof, { sourceUnitPlan: plan });
    expect(result.summary.split("\n")).toContain(quote);
    expect(source.slice(source.indexOf(quote), source.indexOf(quote) + quote.length)).toBe(quote);
    expect(result.incomplete).toBe(false);
    expect(JSON.stringify(proof)).toBe(before);
    expect(() => selectSourceSummaryResult(selection(1, 2, 3), prepared, source, proof,
      { sourceUnitPlan: { ...plan, identity: plan.identity + "forged" } })).toThrow("identity");
  });

  it.each([
    '"Correction the final amount is 3910 pounds instead of 2480 pounds."',
    "The report said Correction the final amount is 3910 pounds instead of 2480 pounds.",
    "According to the team the final amount is 3910 pounds instead of 2480 pounds.",
    "If approved the final amount is 3910 pounds instead of 2480 pounds.",
    "Correction the final amount is 3910 pounds instead of 2480 pounds if approved.",
    "Correction the final amount was 3910 pounds instead of 2480 pounds.",
    "Correction the previous amount is 3910 pounds instead of 2480 pounds.",
    "Correction the final amount is not 3910 pounds instead of 2480 pounds.",
    "Correction the tentative final amount is 3910 pounds instead of 2480 pounds.",
    "Correction the final amount might be 3910 pounds instead of 2480 pounds.",
    "Correction the final amount is 3910 pounds instead of 2480 pounds?",
    "Correction the final amount is 3910 instead of 2480.",
    "Correction the final amount is 3910 pounds instead of 2480 euros.",
    "Correction the amount is 3910 pounds instead of 2480 pounds.",
    "Correction the final amount is 3910 pounds instead of 2480 pounds and Maya will pay the supplier.",
    "Korekta jeśli ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych.",
    "Według Anny ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych.",
    "Korekta ostateczna kwota wynosiła 3910 złotych zamiast 2480 złotych.",
    "Korekta wstępna kwota wynosi 3910 złotych zamiast 2480 złotych.",
    "Korekta ostateczna kwota nie wynosi 3910 złotych zamiast 2480 złotych.",
    "Korekta ostateczna kwota wynosi 3910 złotych zamiast 2480 złotych i musimy zapłacić dostawcy.",
  ])("leaves unselected unsafe, incomplete or action-bearing monetary prose to the model: %s", quote => {
    const source = [quote, ...background].join(" ");
    const result = selectSourceSummaryResult(selection(2, 3, 4, 5), source, source, taskProof([]));
    expect(result.summary).not.toContain(quote);
    expect(result.incomplete).toBe(false);
    expect(result.omittedImportantFacts).toBeUndefined();
  });
});

describe("completed-action review cannot displace current important facts", () => {
  const uncertain = "The project concerns local places my will prepare the outline by Thursday.";
  const historical = "The volunteers resolved the ambiguity by consulting an older map This was useful because the group understood the previous example.";
  const active = ["Elena will contact the supplier by Tuesday.", "Sam will send the updated list before Wednesday.", "The north room was cancelled so we must use the south room."];
  const facts = ["Correction the final budget is $1450.", "We must not buy any new cameras.", "The next editorial review is on November 8 at two in the afternoon."];
  const source = [...active, uncertain, historical, ...facts,
    ...Array.from({ length: 6 }, (_, index) => `The descriptive archive example ${index + 1} concerns ordinary familiar places and older photographs with additional background material.`),
  ].join(" ");
  const span = (quote: string, reason: string): SourceReviewSpan => ({ start: source.indexOf(quote), end: source.indexOf(quote) + quote.length, quote, reason });
  const proof: FinalTaskEvidence = { ...taskProof(active.map((quote) => taskQuote(source, quote))), warnings: ["Review source"],
    reviewSpans: [span(historical, "Completed source action needs whole-statement review (ID 5)"), span(uncertain, "Source action has an unresolved subject (ID 4)")],
  };
  it("preserves current actor uncertainty and all already selected important facts before a completed-only review", () => {
    const result = selectSourceSummaryResult(selection(6, 7, 8, 9), source, source, proof);
    for (const quote of [...active, uncertain, ...facts]) expect(result.summary).toContain(quote);
    expect(result.summary).not.toContain(historical);
    expect(result.incomplete).toBe(true);
  });
  it("does not downgrade an actual unresolved future action using a forged completed-review reason", () => {
    const changed = { ...proof, reviewSpans: [span(uncertain, "Completed source action needs whole-statement review (ID 4)")] };
    expect(selectSourceSummaryResult(selection(6, 7, 8, 9), source, source, changed).summary).toContain(uncertain);
  });
  it.each([
    "The volunteers completed the first table yesterday it needs repair.",
    "Anna zakończyła opis i nie wyśle raportu jutro.",
    "Alice completed the first draft but must not send the unapproved copy.",
  ])("does not demote current required/negated action scope within a completed review: %s", (current) => {
    const changedSource = source.replace(historical, current);
    const currentSpan = { start: changedSource.indexOf(current), end: changedSource.indexOf(current) + current.length,
      quote: current, reason: "Completed source action needs whole-statement review (ID 5)" };
    const ownerReview = { start: changedSource.indexOf(uncertain), end: changedSource.indexOf(uncertain) + uncertain.length,
      quote: uncertain, reason: "Source action has an unresolved subject (ID 4)" };
    const changedProof = { ...taskProof(active.map((quote) => taskQuote(changedSource, quote))), reviewSpans: [currentSpan, ownerReview] };
    const result = selectSourceSummaryResult(selection(6, 7, 8, 9), changedSource, changedSource, changedProof);
    expect(result.summary).toContain(current);
    expect(result.summary).toContain(uncertain);
    for (const fact of facts.slice(0, 2)) expect(result.summary).toContain(fact);
    expect(result.omittedImportantFacts).toEqual(expect.arrayContaining([expect.objectContaining({ quote: facts[2] })]));
    expect(result.incomplete).toBe(true);
  });
  it("returns exact omitted important source spans when genuine commitments exhaust the unchanged limit", () => {
    const more = [...active, "Lee will check the equipment by Thursday.", "Noah will book the room by Friday.", "Iris will update the schedule by Saturday.", "Finn will prepare the handout by Sunday."];
    const crowded = [...more, ...facts, ...Array.from({ length: 5 }, () => "The ordinary archive example provided descriptive material about previous events and familiar places.")].join(" ");
    const result = selectSourceSummaryResult(selection(8, 9, 10, 11), crowded, crowded, taskProof(more.map((quote) => taskQuote(crowded, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.omittedImportantFacts).toEqual(expect.arrayContaining([expect.objectContaining({ start: crowded.indexOf(facts[2]), end: crowded.indexOf(facts[2]) + facts[2].length, quote: facts[2] })]));
    for (const omitted of result.omittedImportantFacts ?? []) expect(crowded.slice(omitted.start, omitted.end)).toBe(omitted.quote);
  });
});

describe("unresolved source visibility in summaries", () => {
  const uncertain = "The workshop concerns local history my will prepare the outline by Thursday.";
  const active = "Leah will contact the speaker before Tuesday.";
  const source = [
    "The community workshop is about local history.", uncertain, active,
    ...Array.from({ length: 7 }, (_, index) => `The background example ${index + 1} described archived pictures, sounds and memories from earlier events with additional ordinary descriptive context.`),
  ].join(" ");
  const proof: FinalTaskEvidence = {
    ...taskProof([taskQuote(source, active)]), warnings: ["The source actor needs review"],
    reviewSpans: [{ start: source.indexOf(uncertain), end: source.indexOf(uncertain) + uncertain.length, quote: uncertain, reason: "Unresolved source actor" }],
  };

  it("preserves a literal uncertain assignment without inventing an actor or active task", () => {
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(1, 4, 5, 6), source, source, proof);
    expect(result.summary).toContain(uncertain);
    expect(result.summary).toContain(active);
    expect(result.summary).not.toContain("Maya will");
    expect(result.incomplete).toBe(true);
    expect(JSON.stringify(proof)).toBe(before);
  });

  it.each([
    { start: -1 }, { end: source.length + 1 }, { quote: "Maya will prepare the outline by Thursday." }, { reason: "" },
  ])("rejects fabricated review source metadata: %j", (changes) => {
    const changed = { ...proof, reviewSpans: [{ ...proof.reviewSpans![0], ...changes }] };
    expect(() => selectSourceSummaryResult(selection(1, 4, 5, 6), source, source, changed)).toThrow("Review");
  });

  it("keeps review quotes literal and gives them capacity before model-selected background", () => {
    const nora = "This was background discussion about the workshop Nora will send the guest list before Wednesday.";
    const budget = "Correction the final budget is $1450.";
    const studio = "The north studio was canceled so we must use the south studio.";
    const policy = "We must not buy new cameras.";
    const date = "The next editorial review is on November 8 at two in the afternoon.";
    const archive = "A correction was interpreted together with the history of the workshop.";
    const critical = [uncertain, nora, active, budget, studio, policy, date];
    const content = [...critical, archive, ...Array.from({ length: 5 }, () => "The old photograph supplied ordinary examples of landscapes, streets, buildings and memories with additional context about previous events.")].join(" ");
    const reviewProof: FinalTaskEvidence = {
      ...taskProof([active, studio].map((quote) => taskQuote(content, quote))), warnings: ["Source actions need review"],
      reviewSpans: [uncertain, nora].map((quote) => ({ start: content.indexOf(quote), end: content.indexOf(quote) + quote.length, quote, reason: "Unresolved source action" })),
    };
    const result = selectSourceSummaryResult(selection(4, 5, 6, 7), content, content, reviewProof);
    expect(result.summary).toBe(critical.join(" "));
    expect(result.summary).not.toContain(archive);
    expect(result.incomplete).toBe(true);
  });

  it.each(["interpreted", "discussed", "described", "explained", "reported", "quoted", "illustrated"])("does not attach a correction merely %s as historical context to a proven action", (verb) => {
    const nora = "This was background discussion about the workshop Nora will send the guest list before Wednesday.";
    const budget = "Correction the final budget is $1450.";
    const studio = "The north studio was canceled so we must use the south studio.";
    const policy = "We must not buy new cameras.";
    const date = "The next editorial review is on November 8 at two in the afternoon.";
    const archive = `A correction was ${verb} together with the background discussion of the workshop.`;
    const critical = [uncertain, nora, active, budget, studio, policy, date];
    const content = [...critical, archive, ...Array.from({ length: 5 }, () => "The old photograph supplied ordinary examples of landscapes, streets, buildings and memories with additional context about previous events.")].join(" ");
    const activeProof: FinalTaskEvidence = {
      ...taskProof([nora, active, studio].map((quote) => taskQuote(content, quote))), warnings: ["Source actor needs review"],
      reviewSpans: [{ start: content.indexOf(uncertain), end: content.indexOf(uncertain) + uncertain.length, quote: uncertain, reason: "Unresolved source actor" }],
    };
    const result = selectSourceSummaryResult(selection(4, 5, 6, 7), content, content, activeProof);
    expect(result.summary).toBe(critical.join(" "));
    expect(result.incomplete).toBe(true);
  });

  it.each(["A correction was described in the workshop background.", "A correction was described in the workshop background Nora will send the revised list before Friday."])("retains an explicitly selected description or joined commitment: %s", (description) => {
    const content = [active, description, ...Array.from({ length: 6 }, () => "The old photograph supplied ordinary examples of landscapes, streets, buildings and memories with additional context about previous events.")].join(" ");
    expect(selectSourceSummaryResult(selection(1, 2, 3, 4), content, content, taskProof([taskQuote(content, active)])).summary).toContain(description);
  });

  it.each([
    ["The red room booking is confirmed for Friday.", "A cancellation was reported: the red room booking was cancelled."],
    ["The red room booking is confirmed for Friday.", "A cancellation was reported the red room booking was cancelled."],
    ["The red room booking is confirmed for Friday.", "A cancellation was reported in the archive the red room booking was canceled."],
    ["Delivery is scheduled for Friday.", "A correction was reported: delivery moved from Friday to Monday."],
    ["Delivery is scheduled for Friday.", "A correction was reported delivery moved from Friday to Monday."],
    ["Delivery is scheduled for Friday.", "A correction was reported in the background delivery moved from Friday to Monday."],
  ])("retains a reported current change with or without ASR punctuation: %s / %s", (earlier, later) => {
    const content = [earlier, later, active, ...Array.from({ length: 7 }, (_, index) => `The descriptive example ${index + 1} concerned familiar places and ordinary photographs from earlier events with additional context about books and landscapes.`)].join(" ");
    expect(selectSourceSummaryResult(selection(1, 3, 4, 5), content, content).summary).toContain(later);
  });
});

describe("literal high-priority context in joined audio sentences", () => {
  it.each([
    ["Correction, the final approved production budget is $1450 This final amount replaces the earlier budget of $900.", true],
    ["Correction the final cost is 250 euros This final amount replaces the previous cost of 100 euros.", true],
    ["Correction the final budget is one thousand seven hundred dollars This final amount replaces the original budget of nine hundred dollars.", true],
    ["Correction if approved the production budget is $1450 This final amount replaces the earlier budget of $900.", false],
    ["Correction the hypothetical budget is $1450 This final amount replaces the earlier budget of $900.", false],
    ["Correction the historical budget is $1450 This final amount replaces the earlier budget of $900.", false],
    ["Correction the budget is not $1450 This final amount replaces the earlier budget of $900.", false],
    ["Correction the budget is $1450 This final amount replaces the earlier cost of $900.", false],
    ["Correction the budget is $1450 This final amount replaces the earlier budget of 900 euros.", false],
    ["Correction the budget is $1450 This final amount replaces the earlier budget of $1450.", false],
    ["Correction the budget is $1450 This final amount replaces the earlier budget of $900?", false],
  ])("prioritizes only a selected closed joined current amount under capacity pressure: %s", (budget, priority) => {
    const required = [
      "The archived interview described photographs of the bridge and the people walking along the river.",
      "The group discussed the purposes of notes and recorded interviews for listeners.",
      "The north studio reservation was canceled so we must use the south studio.",
      "The episode outline the speaker and the updated guest list.",
    ];
    const review = "The project concerns local places my will prepare the outline by Thursday.";
    const policy = "We must not buy any new cameras.";
    const date = "The next editorial review is on November 8 at two in the afternoon.";
    const content = [...required, review, policy, budget, date, ...Array.from({ length: 8 }, (_, index) => `The background example ${index + 1} described pictures and landscapes from earlier events with additional ordinary descriptive context about books, streets and local memories.`)].join(" ");
    const proof: FinalTaskEvidence = {
      ...taskProof(required.map((quote) => taskQuote(content, quote))), warnings: ["Source needs review"],
      reviewSpans: [{ start: content.indexOf(review), end: content.indexOf(review) + review.length, quote: review, reason: "Unresolved actor" }],
    };
    const result = selectSourceSummaryResult(selection(1, 7, 3, 8), content, content, proof);
    if (priority) expect(result.summary).toContain(budget);
    else expect(result.summary).not.toContain(budget);
    expect(result.summary).toContain(review);
    expect(result.summary).toContain(policy);
    expect(result.incomplete).toBe(true);
    if (priority) expect(result.summary).not.toContain(date);
    else expect(result.summary).toContain(date);
  });
  const budget = "Correction the final approved production budget is $1450.";
  const studio = "This final amount replaces the earlier budget of $900 the north studio reservation was canceled so we must use the south studio for the recording.";
  const meeting = "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review.";
  const sentences = [
    "These are the planning notes for the community podcast.",
    "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "The original production budget was $900.", budget, studio,
    "We will use the microphones that we already have and we must not buy any new cameras.", meeting,
    ...Array.from({ length: 4 }, (_, index) => `The archived illustration ${index + 1} described the park, the bridge, the changing seasons, the sound of passing buses and the memories of people who walked along the river without establishing any new decisions or commitments for the current project.`),
  ];
  const source = sentences.join(" ");
  const proof = taskProof([sentences[1], sentences[2], studio].map((quote) => taskQuote(source, quote)));

  it("preserves the final amount supporting a selected joined replacement clause", () => {
    const result = selectSourceSummaryResult(selection(1, 2, 6, 7), source, source, proof);
    expect(result.summary).toContain(budget);
    expect(result.summary).toContain(studio);
    expect(result.summary).not.toContain(sentences[3]);
  });

  it("preserves a unique next review with a spoken clock and an attached topic list", () => {
    const result = selectSourceSummaryResult(selection(1, 2, 6, 7), source, source, proof);
    expect(result.summary).toContain(meeting);
    expect(result.summary).toContain(sentences[1]);
    expect(result.summary).toContain(sentences[2]);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    "If approved, the next editorial review is on November 8 at two in the afternoon the episode outline is the topic for that review.",
    'Alice said "The next editorial review is on November 8 at two in the afternoon the episode outline is the topic for that review".',
    "The next editorial review is not on November 8 at two in the afternoon the episode outline is the topic for that review.",
    "The next editorial review is on November 8 at two in the afternoon unless the room is unavailable.",
    "The next editorial review is on November 8 at two in the afternoon or on November 9 at three in the afternoon.",
    "The next editorial review is on November 8 at two in the afternoon the speaker might approve a new budget instead of the existing one.",
    "The next editorial review is on November 8 at two in the afternoon the date pending approval is the topic for that review.",
    "The next editorial review is on November 8 at two in the afternoon the tentative date is the topic for that review.",
    "The next editorial review is on November 8 at two in the afternoon the date subject to approval is the topic for that review.",
    "The next editorial review is on November 8 at two in the afternoon the provisional date is the topic for that review.",
    "The next editorial review is on November 8 at two in the afternoon the imagined date is the topic for that review.",
  ])("does not restore an unselected uncertain or attributed meeting: %s", (candidate) => {
    const changed = source.replace(meeting, candidate);
    const changedProof = taskProof([sentences[1], sentences[2], studio].map((quote) => taskQuote(changed, quote)));
    expect(selectSourceSummaryResult(selection(1, 2, 6, 7), changed, changed, changedProof).summary).not.toContain(candidate);
  });

  it.each([
    "Correction if approved the final production budget is $1450.",
    'Correction the final production budget is "$1450".',
    "Correction the final production budget was $1450.",
    "Correction the previous production budget is $1450.",
  ])("does not attach an unselected ambiguous correction: %s", (candidate) => {
    const changed = source.replace(budget, candidate);
    const changedProof = taskProof([sentences[1], sentences[2], studio].map((quote) => taskQuote(changed, quote)));
    expect(selectSourceSummaryResult(selection(1, 2, 6, 7), changed, changed, changedProof).summary).not.toContain(candidate);
  });

  it.each([
    ["currency", budget.replace("$1450", "1450 euros"), studio],
    ["scalar head", budget.replace("budget", "cost"), studio],
    ["mixed currencies", budget, studio.replace("$900", "$900 euros")],
    ["unsupported mixed scale", budget, studio.replace("$900", "$900 million")],
    ["reported dependency", budget, `Alice said ${studio}`],
    ["conditional dependency", budget, `If approved ${studio}`],
  ])("keeps a joined quote without resolving its ambiguous %s", (_reason, changedBudget, changedStudio) => {
    const changed = source.replace(budget, changedBudget).replace(studio, changedStudio);
    const changedProof = taskProof([sentences[1], sentences[2], changedStudio].map((quote) => taskQuote(changed, quote)));
    const result = selectSourceSummaryResult(selection(1, 2, 6, 7), changed, changed, changedProof);
    expect(result.summary).toContain(changedStudio);
    expect(result.summary).not.toContain(changedBudget);
  });

  it.each(["one", "seven", "twelve", "10", "12"])("preserves a closed spoken/numeric clock %s without normalizing it", (clock) => {
    const candidate = meeting.replace("two", clock);
    const changed = source.replace(meeting, candidate);
    const changedProof = taskProof([sentences[1], sentences[2], studio].map((quote) => taskQuote(changed, quote)));
    expect(selectSourceSummaryResult(selection(1, 2, 6, 7), changed, changed, changedProof).summary).toContain(candidate);
  });

  it.each(["twenty", "twofold", "129", "25:91"])("does not recognize a valid prefix of invalid clock %s", (clock) => {
    const candidate = meeting.replace("two", clock);
    const changed = source.replace(meeting, candidate);
    const changedProof = taskProof([sentences[1], sentences[2], studio].map((quote) => taskQuote(changed, quote)));
    expect(selectSourceSummaryResult(selection(1, 2, 6, 7), changed, changed, changedProof).summary).not.toContain(candidate);
  });
});

describe("punctuation-independent corrective amounts in actual iPhone ASR", () => {
  // Literal source from run-mupwx9mw-sktcmyja. The lost Maya owner remains lost.
  const source = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts. Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running. Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review";
  const current = "Correction the final approved production budget is $1450.";
  const reference = "This final amount replaces the earlier budget of $900.";
  const tasks = ["Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person.",
    "The north studio reservation was canceled so we must use the south studio for the recording.",
    "We will use the microphones that we already have and we must not buy any new cameras."];
  const date = "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review";
  const candidates = (content: string): string => [tasks[0], reference, date].map((quote, index) => {
    const start = content.indexOf(quote);
    return `[fact:${index}] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`;
  }).join("\n");

  it("replays actual raw [6,24,26,28] without spending a slot on the adjacent old amount reference", () => {
    const result = selectSourceSummaryResult(selection(6, 24, 26, 28), source, source,
      taskProof(tasks.map((quote) => taskQuote(source, quote))));
    expect(result).toEqual({ summary: [tasks[0], tasks[1], current, tasks[2], tasks[3], date].join(" "), incomplete: false });
    expect(result.summary).not.toContain(reference);
    expect(result.summary).not.toContain("Maya will prepare the first episode outline by Thursday.");
    expect(summarySelectionSchema(source, source)).toMatchObject({ properties: { sentences: { minItems: 4, maxItems: 7, items: { maximum: 28 } } } });
  });

  it("closes a selected pure old-amount reference and restores the literal next review", () => {
    const result = selectSourceSummaryResult(selection(1, 2), candidates(source), source,
      taskProof(tasks.map((quote) => taskQuote(source, quote))));
    expect(result).toEqual({ summary: [tasks[0], tasks[1], current, tasks[2], tasks[3], date].join(" "), incomplete: false });
  });

  it.each([
    ["correction as subject", "The correction budget is $1450."],
    ["reported correction", "Correction Maya said the final approved production budget is $1450."],
    ["explicit report", "Correction the production budget according to the report is $1450."],
    ["explicit last-year history", "Correction the production budget from last year is $1450."],
    ["conditional correction", "Correction if approved the final production budget is $1450."],
    ["quoted correction", '"Correction the final approved production budget is $1450."'],
    ["past correction", "Correction the final approved production budget was $1450."],
    ["future correction", "Correction the final approved production budget will be $1450."],
    ["question correction", "Correction the final approved production budget is $1450?"],
    ["negated correction", "Correction the final approved production budget is not $1450."],
    ["compound action", "Correction the final approved production budget is $1450 and Oliver will send the invoice."],
    ["subject number", "Correction the final approved 2020 production budget is $1450."],
    ["second scalar head", "Correction the final approved production budget cost is $1450."],
    ["different currency", "Correction the final approved production budget is 1450 euros."],
    ["different head", "Correction the final approved production cost is $1450."],
  ])("keeps the selected reference when %s is not a closed affirmative present correction", (_name, replacement) => {
    const content = source.replace(current, replacement);
    const result = selectSourceSummaryResult(selection(1, 2), candidates(content), content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).toContain(reference);
    if (_name === "quoted correction") expect(result.summary).toContain(replacement);
    else expect(result.summary).not.toContain(current);
  });

  it.each([
    "The equipment budget is $900.",
    "The equipment budget is $900 and Oliver will send the invoice.",
  ])("keeps the pure reference when another literal old-value budget makes identity ambiguous: %s", (independent) => {
    const content = source.replace("The original production budget was $900.", `The original production budget was $900. ${independent}`);
    const result = selectSourceSummaryResult(selection(1, 2), candidates(content), content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).toContain(reference);
    expect(result.summary).not.toContain(current);
  });
});

describe("actual bundled audio model selections with a pure scalar dependency", () => {
  const tasks = ["Maya will prepare the first episode outline by Thursday.", "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "The north studio reservation was canceled so we must use the south studio for the recording."];
  const old = "The original production budget was 900 dollars.";
  const current = "Correction, the final approved production budget is 1450 dollars.";
  const reference = "This final amount replaces the earlier budget of 900 dollars.";
  const policy = "We will use the microphones that we already have and we must not buy any new cameras.";
  const date = "The next editorial review is on November 8 at 2 in the afternoon.";
  const prepared = (source: string, quotes: readonly string[]): string => quotes.map((quote, index) => {
    const start = source.indexOf(quote);
    return `[fact:${index}] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`;
  }).join("\n");

  it("closes the actual ten-minute raw selection [3,110,111,113] to its existing adjacent final amount", () => {
    const source = ENGLISH_AUDIO_FIXTURE_DATA["en-audio-10min-v1"].referenceTranscript;
    const result = selectSourceSummaryResult(selection(3, 110, 111, 113), source, source,
      taskProof(tasks.map((quote) => taskQuote(source, quote))));
    expect(result).toEqual({ summary: [tasks[0], tasks[1], tasks[2], current, tasks[3], policy, date].join(" "), incomplete: false });
  });

  it("keeps the actual thirty-minute selected date when current amount and its pure dependency both have IDs", () => {
    const source = ENGLISH_AUDIO_FIXTURE_DATA["en-audio-30min-v1"].referenceTranscript;
    const quotes = [tasks[0], tasks[1], old,
      "The programme is intended for residents with different levels of historical knowledge.",
      "The discussion returned to the importance of a clear subject in each passage.",
      "The discussion of local history distinguished a personal recollection from a claim supported by a document.",
      "The group discussed how a listener can lose track of a conversation when too many unfamiliar names arrive together.",
      "The discussion of interview questions concerned clarity rather than the quantity of questions.",
      "The group compared the beginning and ending of an earlier community programme.", current, reference, tasks[3], policy, date,
      "The episode outline, the speaker reply, and the updated guest list are the topics for that review."];
    const candidates = prepared(source, quotes);
    const result = selectSourceSummaryResult(selection(1, 10, 11, 14), candidates, source,
      taskProof([...tasks, policy].map((quote) => taskQuote(source, quote))));
    expect(summarySelectionSchema(candidates, source)).toMatchObject({ properties: { sentences: { minItems: 4, maxItems: 7, items: { maximum: 15 } } } });
    expect(result).toEqual({ summary: [tasks[0], tasks[1], tasks[2], current, tasks[3], policy, date].join(" "), incomplete: false });
  });

  it.each([
    ["missing old fact", old, "The earlier plan was discussed without assigning another budget."],
    ["another same-value budget", old, `${old} The equipment budget is 900 dollars.`],
    ["compound same-value budget", old, `${old} The equipment budget is 900 dollars and Oliver will send the invoice.`],
    ["only compound old fact", old, "The original production budget was 900 dollars and Oliver will send the invoice."],
    ["different old currency", old, "The original production budget was 900 euros."],
    ["different current currency", current, "Correction, the final approved production budget is 1450 euros."],
    ["different current head", current, "Correction, the final approved production cost is 1450 dollars."],
    ["equal values", current, "Correction, the final approved production budget is 900 dollars."],
    ["past correction", current, "Correction, the final approved production budget was 1450 dollars."],
    ["reported correction", current, "Correction, Maya said the final approved production budget is 1450 dollars."],
    ["conditional correction", current, "Correction, if approved the final production budget is 1450 dollars."],
    ["historical correction", current, "Correction, the historical production budget is 1450 dollars."],
    ["quoted correction", current, '"Correction, the final approved production budget is 1450 dollars."'],
    ["another subject number", current, "Correction, the final approved 2020 production budget is 1450 dollars."],
    ["nonadjacent current", reference, `The recording includes a second background discussion. ${reference}`],
    ["additional reference action", reference, "This final amount replaces the earlier budget of 900 dollars and Oliver will send the invoice."],
    ["additional reference date", reference, "This final amount replaces the earlier budget of 900 dollars on November 9."],
    ["additional reference amount", reference, "This final amount replaces the earlier budget of 900 dollars and includes 50 dollars for travel."],
    ["negated reference", reference, "This final amount does not replace the earlier budget of 900 dollars."],
    ["question reference", reference, "Does this final amount replace the earlier budget of 900 dollars?"],
  ])("preserves a selected dependency when %s prevents exact source closure", (_name, original, replacement) => {
    const source = ENGLISH_AUDIO_FIXTURE_DATA["en-audio-3min-v1"].referenceTranscript.replace(original, replacement);
    const chosenReference = original === reference && replacement !== `The recording includes a second background discussion. ${reference}` ? replacement : reference;
    const candidates = prepared(source, [tasks[0], chosenReference, date]);
    const result = selectSourceSummaryResult(selection(1, 2), candidates, source,
      taskProof(tasks.map((quote) => taskQuote(source, quote))));
    expect(result.summary).toContain(chosenReference);
    if (_name === "quoted correction") expect(result.summary).toContain(replacement);
    else expect(result.summary).not.toContain(current);
  });
});

describe("self-contained corrected amount under the whole-source sentence budget", () => {
  const riverside = [
    "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places, everyday experiences, and the people who live in the neighbourhood. Maya will prepare the first episode outline by Thursday. The opening episode is about the riverside park and the old railway bridge. We discussed the atmosphere of the programme and the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts.",
    "Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking routes near the river, and the names of the older streets. Those topics were examples of possible conversation subjects, rather than a final running order. The programme is intended for residents with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates.",
    "The original production budget was 900 dollars. This amount appeared in the early draft of the project plan. The old draft also contained a description of a larger camera setup, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound and a conversation that listeners can follow easily.",
    "Nora will send the updated guest list to Maya before Wednesday. The list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were already available in the archive. The discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed, and its results were included in the background documents.",
    "Correction, the final approved production budget is 1450 dollars. This final amount replaces the earlier budget of 900 dollars. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at 2 in the afternoon. The episode outline, the speaker reply, and the updated guest list are the topics for that review.",
  ].join("\n\n");
  const tasks = ["Maya will prepare the first episode outline by Thursday.", "Daniel will contact the guest speaker by Tuesday.",
    "Nora will send the updated guest list to Maya before Wednesday.",
    "The north studio reservation was canceled so we must use the south studio for the recording."];
  const final = "Correction, the final approved production budget is 1450 dollars.";
  const reference = "This final amount replaces the earlier budget of 900 dollars.";
  const policy = "We will use the microphones that we already have and we must not buy any new cameras.";
  const event = "The next editorial review is on November 8 at 2 in the afternoon.";

  it("preserves the actual selected final amount alongside every final task, policy and date", () => {
    const result = selectSourceSummaryResult(selection(3, 7, 27, 31), riverside, riverside,
      taskProof(tasks.map((quote) => taskQuote(riverside, quote))));
    expect(result).toEqual({ summary: [tasks[0], tasks[1], tasks[2], final, tasks[3], policy, event].join(" "), incomplete: false });
    expect(result.summary).not.toContain(reference);
    expect(result.summary).not.toContain("The original production budget was 900 dollars.");
  });

  it("restores the singleton next review omitted from twelve valid prepared candidates", () => {
    const content = `${riverside} ${Array.from({ length: 30 }, () => "The archive contained photographs and stories about familiar places without any further decisions or additional assignments.").join(" ")}`;
    const candidates = [tasks[0], "The opening episode is about the riverside park and the old railway bridge.",
      "The contact details were checked during the previous meeting.", "The programme is intended for residents with different levels of historical knowledge.",
      "The earlier equipment comparison was also completed, and its results were included in the background documents.", tasks[1], tasks[2], final, tasks[3], policy, event,
      "The episode outline, the speaker reply, and the updated guest list are the topics for that review."];
    const prepared = candidates.map((quote, index) => {
      const start = content.indexOf(quote);
      return `[fact:${index}] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`;
    }).join("\n");
    const result = selectSourceSummaryResult(selection(1, 6, 7, 8), prepared, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result).toEqual({ summary: [tasks[0], tasks[1], tasks[2], final, tasks[3], policy, event].join(" "), incomplete: false });
    expect(summarySelectionSchema(prepared, content)).toMatchObject({ properties: { sentences: { minItems: 4, maxItems: 7, items: { maximum: 12 } } } });
  });

  it.each([
    "The next team meeting is on March 4 at 10 in the morning.",
    "The next appointment is on 2026-12-09 at 14:30.",
    "The next project review is on May 17 at 2 pm.",
    "The next weekly team meeting is on Monday.",
  ])("restores only a literal closed singleton next calendar fact: %s", (calendar) => {
    const content = riverside.replace(event, calendar);
    const result = selectSourceSummaryResult(selection(3, 7, 27, 5), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).toContain(calendar);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    'Maya said "The next editorial review is on November 8 at 2 in the afternoon."',
    '"The next editorial review is on November 8 at 2 in the afternoon."',
    "If the budget is approved, the next editorial review is on November 8 at 2 in the afternoon.",
    "The next editorial review is on November 8 at 2 in the afternoon if Maya agrees.",
    "Is the next editorial review on November 8 at 2 in the afternoon?",
    "The next editorial review is not on November 8 at 2 in the afternoon.",
    "The previous editorial review was on November 8 at 2 in the afternoon.",
    "The next canceled meeting is on November 8.",
    "The next hypothetical review is on November 8.",
    "The next provisional review is on November 8.",
    "The next possible appointment is on November 8.",
    "The next editorial review is on November 8, and Maya will bring the report.",
  ])("leaves nonclosed, historical, hypothetical or action-containing calendar text to model selection: %s", (calendar) => {
    const content = riverside.replace(event, calendar);
    const result = selectSourceSummaryResult(selection(3, 7, 27, 5), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).not.toContain(calendar);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    "The next planning meeting is on November 9 at 10 in the morning.",
    "The editorial review is on November 9 at 3 pm.",
    "That review was canceled.",
    "The review date has changed to November 9.",
    "It was postponed.",
    "It is now on November 9 at 3 pm.",
    "The time is now 3 pm.",
    "We will not attend that review.",
    "The review has been called off.",
    "It has been called off.",
    "There will be no review.",
    "No review will take place.",
    "The date is incorrect.",
    "It has already taken place.",
  ])("does not automatically restore a next calendar fact across another schedule or later relevant change: %s", (later) => {
    const content = `${riverside} ${later}`;
    const result = selectSourceSummaryResult(selection(3, 7, 27, 5), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).not.toContain(event);
    expect(result.summary).not.toContain(later);
  });

  it("leaves two direct calendar schedules to the model even when the earlier modifier is outside the retention grammar", () => {
    const earlier = "The next annual appointment is on November 9.";
    const content = `${earlier} ${riverside}`;
    const result = selectSourceSummaryResult(selection(4, 8, 28, 6), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).not.toContain(event);
    expect(result.summary).not.toContain(earlier);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    "The earlier review was called off.",
    "The equipment demonstration has been called off.",
  ])("retains the current singleton after an earlier cancellation or an unrelated later cancellation: %s", (cancelled) => {
    const content = cancelled.startsWith("The earlier") ? `${cancelled} ${riverside}` : `${riverside} ${cancelled}`;
    const result = selectSourceSummaryResult(selection(content.startsWith(cancelled) ? 4 : 3,
      content.startsWith(cancelled) ? 8 : 7, content.startsWith(cancelled) ? 28 : 27, content.startsWith(cancelled) ? 6 : 5), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.summary).toContain(event);
    expect(result.incomplete).toBe(false);
  });

  it("warns when a required singleton calendar fact genuinely exceeds seven whole-quote slots", () => {
    const extra = "Oliver will check the recording script by Monday.";
    const content = `${extra} ${riverside}`;
    const result = selectSourceSummaryResult(selection(4, 8, 28, 6), content, content,
      taskProof([extra, ...tasks].map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary).toContain(final);
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
    expect(result.summary).not.toContain(event);
  });

  it("closes an explicitly selected pure reference only through the unique source-proven old scalar", () => {
    const result = selectSourceSummaryResult(selection(3, 7, 27, 28, 31), riverside, riverside,
      taskProof(tasks.map((quote) => taskQuote(riverside, quote))));
    expect(result.summary).toContain(final);
    expect(result.summary).not.toContain(reference);
    expect(result.summary).toContain(event);
    expect(result.incomplete).toBe(false);
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
  });

  it("warns instead of silently dropping a selected comma-prefixed final amount during real overflow", () => {
    const extra = "Oliver will check the recording script by Monday.";
    const content = `${extra} ${riverside}`;
    const result = selectSourceSummaryResult(selection(4, 8, 28, 32), content, content,
      taskProof([extra, ...tasks].map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
    expect(result.summary).toContain(final);
  });

  it.each([
    "This final amount replaces the earlier budget of 900 dollars and Oliver will send the invoice.",
    "This final amount replaces the earlier budget of 900 dollars on November 9.",
    "This final amount replaces the earlier production cost of 900 dollars.",
    "This final amount replaces the earlier budget of 900 euros.",
  ])("does not discard an automatically linked statement containing another fact: %s", (change) => {
    const content = riverside.replace(reference, change);
    const result = selectSourceSummaryResult(selection(3, 7, 27, 31), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary).toContain(final);
    expect(result.summary).toContain(change);
  });

  it("does not skip a separate later change across an intervening factual statement", () => {
    const content = riverside.replace(reference, `The cost includes 50 dollars for travel. ${reference}`);
    const result = selectSourceSummaryResult(selection(3, 7, 27, 32), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
  });

  it("keeps selected independent pure and compound old budgets despite a comma correction", () => {
    const original = "The workshop budget is 900 dollars.";
    const compound = "The equipment budget is 900 dollars, and Alice will send the supplier list by Friday.";
    const finalBudget = "Correction, the final budget is 1450 dollars.";
    const content = [original, compound, finalBudget, reference, tasks[0],
      ...Array.from({ length: 5 }, () => "We discussed the podcast format, historical archive and community stories without assigning additional work or confirming further decisions.")].join(" ");
    const result = selectSourceSummaryResult(selection(1, 2, 3, 5), content, content);
    expect(result.summary).toContain(original);
    expect(result.summary).toContain(compound);
    expect(result.summary).toContain(finalBudget);
  });
});

describe("original-source summary capacity after evidence preparation", () => {
  const commitments = [
    "Alice will prepare the workshop report by Friday.",
    "Bob will contact the workshop supplier by Tuesday.",
    "Clara will test the workshop microphone on Wednesday.",
    "David will print the workshop invitations by Thursday.",
    "Emma will confirm the workshop venue by Monday.",
    "Felix will check the workshop projector on Saturday.",
    "Grace will send the workshop agenda by Sunday.",
    "Hannah will check the workshop registration by Wednesday.",
  ];
  const context = (index: number): string =>
    `The workshop discussion covered background item ${index} about books, weather, travel and holidays without any further decision or assignment.`;
  const reduced = (content: string, quotes: readonly string[]): string => quotes.map((quote, index) => {
    const start = content.indexOf(quote);
    return `[fact:${index}] (fact; importance 2; source ${start}:${start + quote.length}) ${quote}`;
  }).join("\n");

  it.each([5, 7])("retains %s final task quotes when the prepared source contains six candidates", (count) => {
    const tasks = commitments.slice(0, count);
    const background = Array.from({ length: 20 }, (_, index) => context(index));
    const content = [...tasks, ...background].join(" ");
    const prepared = reduced(content, background.slice(0, 6));
    const proof = taskProof(tasks.map((quote) => taskQuote(content, quote)));
    const result = selectSourceSummaryResult(selection(1, 2, 3), prepared, content, proof);
    tasks.forEach((quote) => expect(result.summary).toContain(quote));
    expect(result.incomplete).toBe(false);
    expect(result.summary.match(/[.!?]/gu)?.length).toBeLessThanOrEqual(7);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
    expect(summarySelectionMaximum(prepared, content)).toBe(3);
    expect(summarySelectionSchema(prepared, content)).toMatchObject({
      properties: { sentences: { minItems: 3, maxItems: 3, items: { maximum: 6 } } },
    });
    expect(() => selectSourceSummaryResult(selection(1, 2, 3, 4), prepared, content, proof)).toThrow("invalid sentences");
    expect(() => selectSourceSummaryResult(selection(1, 2, 99), prepared, content, proof)).toThrow("invalid sentences");
  });

  it("retains complete later cancellation quotes without task proof under the original long-source cap", () => {
    const earlier = [
      "Alice will send the report by Friday, and Bob will test the microphone on Tuesday.",
      "Clara will print the agenda by Thursday, and David will book the room on Monday.",
      "Emma will check the projector by Sunday, and Felix will send the invitations on Saturday.",
    ];
    const later = ["Alice will not send the report.", "Clara will not print the agenda.", "Emma will not check the projector."];
    const background = Array.from({ length: 10 }, (_, index) => context(index));
    const content = [...earlier, ...later, ...background].join(" ");
    const prepared = reduced(content, [...earlier, ...background.slice(0, 3)]);
    const result = selectSourceSummaryResult(selection(1, 2, 3), prepared, content);
    expect(result).toEqual({ summary: [...earlier, ...later].join(" "), incomplete: false });
  });

  it("keeps five final commitments in a short source while excluding optional context", () => {
    const tasks = commitments.slice(0, 5);
    const content = [...tasks, ...Array.from({ length: 3 }, (_, index) => context(index))].join(" ");
    const result = selectSourceSummaryResult(selection(1, 2, 3, 4), content, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBe(tasks.join(" "));
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  });

  it("warns about genuine overflow when eight required quotes compete for seven long-source slots", () => {
    const background = Array.from({ length: 20 }, (_, index) => context(index));
    const content = [...commitments, ...background].join(" ");
    const prepared = reduced(content, background.slice(0, 6));
    const result = selectSourceSummaryResult(selection(1, 2, 3), prepared, content,
      taskProof(commitments.map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
    expect(result.summary).not.toContain(commitments[7]);
  });

  it("does not exceed the word compression guard when seven original slots are available", () => {
    const tasks = commitments.slice(0, 7);
    const background = ["Other discussion.", "More discussion.", "Further discussion."];
    const content = [...tasks, ...background].join(" ");
    const prepared = reduced(content, [...tasks.slice(0, 3), ...background]);
    const result = selectSourceSummaryResult(selection(1, 2, 3), prepared, content,
      taskProof(tasks.map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  });
});

describe("source sentence summary selection", () => {
  const source =
    "Rozmawialiśmy długo o salach i pogodzie po drodze. Marta przygotuje listę do piątku. Budżet wynosi 1200 złotych. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych. Resztę spotkania zajęły luźne rozmowy o książkach i planach na wakacje.";

  it("renders exact selected source sentences in source order without invented links", () => {
    expect(selectSourceSummary(selection(5, 4, 2), source, source)).toBe(
      "Marta przygotuje listę do piątku. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.",
    );
  });

  it("retains the explicit later correction when an obsolete amount is selected", () => {
    expect(selectSourceSummary(selection(2, 3), source, source)).toBe(
      "Marta przygotuje listę do piątku. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.",
    );
  });

  it("retains an English cancellation of a selected earlier booking", () => {
    const english =
      "We talked about the workshop and the weather for a while. The red room is booked for Friday. Alice will prepare the report by Thursday. Later the red room booking was cancelled; use the green room instead. We also spent a long time discussing unrelated books and travel plans.";
    expect(selectSourceSummary(selection(2, 3), english, english)).toBe(
      "The red room is booked for Friday. Alice will prepare the report by Thursday. Later the red room booking was cancelled; use the green room instead.",
    );
  });

  it("does not infer a link between an unchanged budget and a different replacement with the same number", () => {
    const unrelated =
      "The group discussed several options and talked about the week. The budget is 1200 euros. Alice will send the report by Friday. Room 1200 has been replaced by room 1300. Everyone then discussed unrelated travel and books for quite a long time.";
    expect(selectSourceSummary(selection(2, 3), unrelated, unrelated)).toBe(
      "The budget is 1200 euros. Alice will send the report by Friday.",
    );
  });

  it("preserves both owners, the deadline and negation of an entire selected sentence", () => {
    const english =
      "We spent the morning discussing many possible ways to proceed. Alice must not send the report to Bob before Thursday. The budget is unchanged. The rest of the meeting was about lunch, books and the weather outside.";
    expect(selectSourceSummary(selection(2, 3), english, english)).toBe(
      "Alice must not send the report to Bob before Thursday. The budget is unchanged.",
    );
  });

  it("expands reduced fact quotations to their whole original sentence", () => {
    const content =
      "We discussed the weather and books for a long time. Alice will not send the report to Bob before Thursday. The review meeting is on October 12. Other informal discussion continued for another hour without any decision.";
    const prepared =
      "[f:55:110] (decision; importance 3) send the report to Bob\n[f:111:150] (fact; importance 2) The review meeting is on October 12.";
    expect(renderSummarySource(prepared, content)).toBe(
      "[1] Alice will not send the report to Bob before Thursday.\n[2] The review meeting is on October 12.",
    );
    expect(selectSourceSummary(selection(2, 1), prepared, content)).toBe(
      "Alice will not send the report to Bob before Thursday. The review meeting is on October 12.",
    );
  });

  it.each([
    ["free prose", "The red room replaces the budget."],
    ["an invented ID", selection(2, 99)],
    ["a single sentence", selection(2)],
    ["duplicate IDs", selection(2, 2)],
    ["an uncompressed copy", selection(1, 2, 3, 4)],
  ])(
    "rejects %s instead of treating generation success as summary success",
    (_, raw) => {
      const dense = "Alice writes. Bob calls. The budget stays. No changes.";
      expect(() => selectSourceSummary(raw, dense, dense)).toThrow();
    },
  );

  it("rejects unsupported reduced evidence instead of matching a similar sentence", () => {
    expect(() =>
      renderSummarySource(
        "[f:0:20] (fact; importance 2) Alice sends it on Friday.",
        source,
      ),
    ).toThrow();
  });

  it("uses the exact evidence offset when the same quote occurs with different negation", () => {
    const content =
      "Alice will send it. Bob will not send it. The review is on Friday. Other informal discussion continued for another hour with no decisions.";
    const prepared =
      "[facts:0:150:0] (decision; importance 3; source 33:40) send it\n[facts:0:150:1] (fact; importance 2; source 42:66) The review is on Friday.";
    expect(renderSummarySource(prepared, content)).toBe(
      "[1] Bob will not send it.\n[2] The review is on Friday.",
    );
  });

  it("rejects forged evidence offsets even when the quotation appears somewhere in the note", () => {
    expect(() =>
      renderSummarySource(
        "[facts:0:200:0] (decision; importance 3; source 0:5) Marta",
        source,
      ),
    ).toThrow();
  });

  it("requires broader coverage for a note with many available source sentences", () => {
    const longer =
      "We discussed several options and reviewed the events of the week at length. Alice will send the report by Friday. Bob will test the microphone on Monday. The review meeting is on October 12. The final budget is 1750 euros, replacing the earlier budget of 1200 euros. We will not buy a new camera because the existing one still works correctly. Clara will confirm the workshop venue before sending invitations. We then talked for a long time about various books, holidays and music without making any further decisions for the team.";
    expect(() =>
      selectSourceSummary(selection(2, 5), longer, longer),
    ).toThrow();
  });

  it("retains a later explicitly corrected value that does not repeat the obsolete number", () => {
    const english =
      "The group discussed several options and talked about the week. The budget is 1200. Alice will send the report by Friday. Correction: the budget is 1750. Everyone then discussed unrelated travel and books for quite a long time.";
    expect(selectSourceSummary(selection(2, 3), english, english)).toBe(
      "Alice will send the report by Friday. Correction: the budget is 1750.",
    );
  });

  it("retains a later ordinary negation of the same literal actor and action", () => {
    const english =
      "Alice will send the report by Friday. Alice will not send the report. Bob will test the microphone on Tuesday. The meeting will take place on Wednesday. We do not need new headphones.";
    expect(selectSourceSummary(selection(1, 3), english, english)).toBe(
      "Alice will not send the report. Bob will test the microphone on Tuesday.",
    );
  });

  it("does not merge a different actor's negation into a selected commitment", () => {
    const english =
      "Alice will send the report by Friday. Bob will not send the report. Clara will book the small room on Thursday. The large room is not available. We discussed the colors of the presentation yesterday.";
    expect(selectSourceSummary(selection(1, 3), english, english)).toBe(
      "Alice will send the report by Friday. Clara will book the small room on Thursday.",
    );
  });

  it("limits a five-sentence source to three complementary points even if four short excerpts fit", () => {
    const five =
      "Alice will send the report. Bob will test the microphone. Clara will book the room. The budget is unchanged. We talked for a long time about books, music, travel, lunch and the weather without reaching further decisions, then continued the discussion until everyone left for home.";
    expect(() =>
      selectSourceSummary(selection(1, 2, 3, 4), five, five),
    ).toThrow();
    expect(selectSourceSummary(selection(1, 2, 3), five, five)).toBe(
      "Alice will send the report. Bob will test the microphone. Clara will book the room.",
    );
  });

  it("keeps a separate action inside an earlier compound sentence when only its first action is negated", () => {
    const compound =
      "Alice will send the report by Friday, and Bob will test the microphone on Tuesday. Alice will not send the report. Clara will book the workshop room on Thursday. We reviewed several alternatives without reaching any further decisions. The rest of the morning was spent discussing books, travel, weather and plans for lunch.";
    expect(selectSourceSummary(selection(1, 3), compound, compound)).toBe(
      "Alice will send the report by Friday, and Bob will test the microphone on Tuesday. Alice will not send the report. Clara will book the workshop room on Thursday.",
    );
  });

  it("does not treat a bare amount object as a removable deadline", () => {
    const amount =
      "Alice will send 500. Alice will not send. Bob will test the microphone on Tuesday. We reviewed several alternatives without reaching any further decisions. The rest of the morning was spent discussing books, travel, weather and plans for lunch.";
    expect(selectSourceSummary(selection(1, 3), amount, amount)).toBe(
      "Alice will send 500. Alice will not send. Bob will test the microphone on Tuesday.",
    );
  });

  it("keeps a wrapped deadline within the same complete source sentence", () => {
    const wrapped =
      "Alice will send the report\nby Friday. Bob will test the microphone on Tuesday. We discussed several alternatives for the morning and then talked about books and weather without making any further decisions.";
    expect(renderSummarySource(wrapped, wrapped)).toBe(
      "[1] Alice will send the report\nby Friday.\n[2] Bob will test the microphone on Tuesday.\n[3] We discussed several alternatives for the morning and then talked about books and weather without making any further decisions.",
    );
    expect(selectSourceSummary(selection(1, 2), wrapped, wrapped)).toBe(
      "Alice will send the report\nby Friday. Bob will test the microphone on Tuesday.",
    );
  });

  it("reads multiline evidence using authoritative offsets without treating a continuation as a record", () => {
    const content =
      "Alice will send the report\nby Friday. Bob will test the microphone on Tuesday. Other informal discussion continued for another hour with no decisions.";
    const prepared =
      "[facts:0:150:0] (decision; importance 3; source 0:37) Alice will send the report\nby Friday.\n[facts:0:150:1] (decision; importance 3; source 38:78) Bob will test the microphone on Tuesday.";
    expect(renderSummarySource(prepared, content)).toBe(
      "[1] Alice will send the report\nby Friday.\n[2] Bob will test the microphone on Tuesday.",
    );
    expect(selectSourceSummary(selection(1, 2), prepared, content)).toBe(
      "Alice will send the report\nby Friday. Bob will test the microphone on Tuesday.",
    );
  });

  const phoneSource =
    "Notatka ze spotkania zespołu biblioteki. Rozmawialiśmy o jesiennych warsztatach, rezerwacji sal i poprawie informacji dla czytelników. Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek. Budżet pierwszych warsztatów wynosi 1200 złotych. Nie zamówimy nowych laptopów, ponieważ obecny sprzęt wystarczy. Spotkanie podsumowujące odbędzie się 12 października o godzinie 10:00. Nie ustaliliśmy jeszcze liczby uczestników. Sprawdzę dostępność większej sali przed wysłaniem zaproszeń. Na zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.";

  it.each([selection(3, 4, 11, 9), selection(3, 4, 10, 11)])(
    "removes only the obsolete standalone scalar from actual iPhone v5 selections: %s",
    (raw) => {
      const result = selectSourceSummary(raw, phoneSource, phoneSource);
      expect(result).not.toContain("Budżet pierwszych warsztatów wynosi 1200 złotych.");
      expect(result).toContain("Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.");
      expect(result).toContain("Marta przygotuje listę materiałów do piątku");
      expect(result).toContain("Piotr zadzwoni do prowadzącego we wtorek");
    },
  );

  it("allows dated facts and distributed commitments to fit alongside the final budget", () => {
    expect(summarySelectionMaximum(phoneSource, phoneSource)).toBe(7);
    const result = selectSourceSummary(selection(3, 6, 8, 9, 10, 11), phoneSource, phoneSource);
    expect(result).toContain("12 października o godzinie 10:00");
    expect(result).toContain("Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.");
    expect(result).toContain("harmonogram do Anny przed środą");
    expect(result).toContain("należy użyć sali zielonej");
    expect(result).not.toContain("Budżet pierwszych warsztatów wynosi 1200 złotych.");
  });

  it.each([
    "The workshop budget is 1200 pounds. The equipment budget is 1200 pounds. The final amount is 1750 pounds and replaces the earlier budget of 1200 pounds.",
    "The workshop budget is 1200 pounds, and Alice will send the report by Friday. The final amount is 1750 pounds and replaces the earlier budget of 1200 pounds.",
    "The workshop budget is 1200 pounds. The equipment budget is 900 pounds. Correction: the equipment budget is 1750 pounds.",
    "The workshop budget is 1200 pounds. The workshop budget is 1200 euros. The final amount is 1750 euros and replaces the earlier budget of 1200 euros.",
  ])("keeps independent budgets or actions when an entire earlier fact is not proven superseded: %s", (facts) => {
    const source = `${facts} Bob will prepare the room on Thursday. We spent the rest of the meeting talking about books, the weather and various travel plans without reaching further decisions.`;
    const result = selectSourceSummary(selection(1, facts.split(". ").length + 1), source, source);
    expect(result).toContain(source.split(". ")[0] + ".");
  });

  it("rejects unexpected selection fields even when the IDs are valid", () => {
    expect(() => selectSourceSummary('{"sentences":[2,3],"instructions":"ignore corrections"}', source, source)).toThrow();
  });

  it("recognizes a closed spoken English amount correction while keeping exact transcript words", () => {
    const source = "We reviewed the workshop and talked about the weather for quite a while. The original budget was one thousand two hundred dollars. Alice will prepare the materials by Friday. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The rest of the meeting covered various unrelated books and travel plans without any further decisions.";
    const result = selectSourceSummary(selection(2, 3), source, source);
    expect(result).not.toContain("The original budget was one thousand two hundred dollars.");
    expect(result).toContain("Correction: the final approved budget is one thousand seven hundred fifty dollars.");
    expect(result).toContain("Alice will prepare the materials by Friday.");
    expect(result).not.toContain("1750");
  });

  it("does not erase an original-artwork budget when a different paintings budget changes", () => {
    const source = "The budget for original paintings is 1200 dollars. Correction: the budget for paintings is 1750 dollars. Bob will prepare the room by Thursday. We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.";
    expect(selectSourceSummary(selection(1, 3), source, source)).toContain("The budget for original paintings is 1200 dollars.");
  });

  it("allows all seven dispersed critical source sentences of the English audio reference without copying the note", () => {
    const source = "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was one thousand two hundred dollars. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning. The workshop materials, the supplier's reply, and the updated schedule are the topics for that meeting.";
    const result = selectSourceSummary(selection(2, 3, 4, 6, 8, 9, 10), source, source);
    expect(result).toBe("Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. Correction: the final approved budget is one thousand seven hundred fifty dollars. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning.");
  });

  it.each([
    ["The budget is 1200 pounds.", "We must not replace the earlier budget of 1200 pounds."],
    ["The budget is 1200 pounds.", "Should we replace the earlier budget of 1200 pounds?"],
    ["The budget is 1200 pounds.", "The final budget is 1750 pounds?"],
    ["The budget is 1200 pounds.", "The approved budget is 1750 pounds."],
    ["The budget is 1200 pounds.", "The final amount of 1750 pounds does not replace the earlier budget of 1200 pounds."],
    ["The budget for final exams is 1200 pounds.", "The budget for final exams is 1750 pounds."],
    ["The budget for Room 101 is 1200 pounds.", "Correction: the budget for Room 102 is 1750 pounds."],
    ["The original paintings budget is 1200 pounds.", "Correction: the paintings budget is 1750 pounds."],
  ])("keeps a scalar without an affirmative same-subject correction: %s / %s", (earlier, later) => {
    const source = `${earlier} ${later} Bob will prepare the room by Thursday. We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.`;
    expect(selectSourceSummary(selection(1, 3), source, source)).toContain(earlier);
  });

  it("considers the independent budget in a compound sentence when a replacement reference is ambiguous", () => {
    const source = "The workshop budget is 1200 pounds. The equipment budget is 1200 pounds, and Alice will send the report by Friday. The final amount is 1750 pounds and replaces the earlier budget of 1200 pounds. Bob will book the room by Thursday. We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.";
    expect(selectSourceSummary(selection(1, 4), source, source)).toContain("The workshop budget is 1200 pounds.");
  });
});

describe("final task evidence in summary selection", () => {
  const source = "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was one thousand two hundred dollars. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning. The workshop materials, the supplier's reply, and the updated schedule are the topics for that meeting.";
  const sentences = source.match(/[^.!?]+[.!?]/gu)!.map((sentence) => sentence.trim());
  const proof = taskProof([2, 3, 4, 8, 9].map((id) => taskQuote(source, sentences[id - 1])));

  it("combines the actual four-ID model selection with all final English commitments under the seven-sentence budget", () => {
    const result = selectSourceSummaryResult(selection(2, 6, 8, 10), source, source, proof);
    expect(result).toEqual({ summary: [2, 3, 4, 6, 8, 9, 10].map((id) => sentences[id - 1]).join(" "), incomplete: false });
  });

  it("retains an already model-selected dated event and final amount before an introduction or repeated topic sentence", () => {
    const result = selectSourceSummaryResult(selection(1, 2, 3, 6, 7, 10), source, source, proof);
    expect(result).toEqual({ summary: [2, 3, 4, 6, 8, 9, 10].map((id) => sentences[id - 1]).join(" "), incomplete: false });
  });

  it("rejects an empty result when every selected correction bundle exceeds the compression limit", () => {
    const content = "The budget is 1200 pounds. The other budget is 900 pounds. Correction: the final budget is 1750 pounds, which replaces the earlier budget of 1200 pounds and reflects all the many additional equipment, training, transport, safety, catering and accommodation costs that were carefully reviewed during the very long planning meeting.";
    expect(() => selectSourceSummaryResult(selection(1, 2), content, content, taskProof([]))).toThrow();
  });

  it.each([selection(2, 6, 8, 99), selection(2, 2, 8, 10), '{"sentences":[2,6,8,10],"extra":true}'])("validates every model ID and field before task-priority merge: %s", (raw) => {
    expect(() => selectSourceSummaryResult(raw, source, source, proof)).toThrow();
  });

  it("rejects task proof whose quote does not match authoritative offsets", () => {
    const entry = { ...proof.evidence[0], start: 0 };
    expect(() => selectSourceSummaryResult(selection(2, 6, 8, 10), source, source, taskProof([entry]))).toThrow();
  });

  it("reports a dropped required commitment rather than returning all source text", () => {
    const result = selectSourceSummaryResult(selection(2, 6, 8, 10), source, source, taskProof(sentences.map((quote) => taskQuote(source, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(source.split(/\s+/u).length * 0.8);
    expect(result.summary.match(/[.!?]/gu)!.length).toBeLessThanOrEqual(7);
  });

  it("does not resurrect either obsolete deadline in a validated replacement chain", () => {
    const earlier = "Alice will send the report by Friday.";
    const middle = "Deadline change: Alice will send the report by Thursday.";
    const later = "Deadline change: Alice will send the report by Monday.";
    const event = "The review meeting is on Tuesday at 10:00.";
    const content = `${earlier} ${middle} ${later} ${event} We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.`;
    const [old, interim, current] = [earlier, middle, later].map((quote) => taskQuote(content, quote));
    const result = selectSourceSummaryResult(selection(1, 4), content, content, taskProof([current], [{ earlier: old, later: interim }, { earlier: interim, later: current }]));
    expect(result.summary).toBe(`${later} ${event}`);
    expect(result.incomplete).toBe(false);
  });

  it("retains the terminal cancellation when the model selects a task from an earlier deadline in the proof chain", () => {
    const earlier = "Alice will send the report by Friday.";
    const middle = "Deadline change: Alice will send the report by Thursday.";
    const later = "Alice will not send the report by Monday.";
    const event = "The review meeting is on Tuesday at 10:00.";
    const content = `${earlier} ${middle} ${later} ${event} We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.`;
    const [old, interim, current] = [earlier, middle, later].map((quote) => taskQuote(content, quote));
    current.kind = "cancelled";
    const result = selectSourceSummaryResult(selection(1, 4), content, content, taskProof([], [{ earlier: old, later: interim }, { earlier: interim, later: current }]));
    expect(result).toEqual({ summary: `${later} ${event}`, incomplete: false });
  });

  it("keeps another actor's whole original sentence when only a task clause was superseded", () => {
    const compound = "Alice will send the report by Friday, and Bob will test the microphone by Tuesday.";
    const cancellation = "Alice will not send the report.";
    const event = "The review meeting is on Thursday at 10:00.";
    const content = `${compound} ${cancellation} ${event} We spent the remainder of the meeting discussing various unrelated books, travel destinations, the weather and plans for the holidays without reaching any further decisions.`;
    const old = taskQuote(content, compound, "Alice will send the report by Friday");
    const active = taskQuote(content, compound, "Bob will test the microphone by Tuesday");
    const cancelled = { ...taskQuote(content, cancellation), kind: "cancelled" as const };
    const result = selectSourceSummaryResult(selection(1, 3), content, content, taskProof([active], [{ earlier: old, later: cancelled }]));
    expect(result.summary).toContain(compound);
    expect(result.summary).toContain(cancellation);
    expect(result.incomplete).toBe(false);
  });
});

describe("literal source restrictions in summary selection", () => {
  const phoneSentences = [
    "These are the final notes for the October workshop.",
    "Alice will prepare the workshop materials by Friday.",
    "Bob will contact the supplier by Tuesday.",
    "Emma will send the updated schedule to Alice before Wednesday.",
    "The original budget was $1200.",
    "Correction, the final approved budget is $1750.",
    "This final amount replaces the earlier budget.",
    "The red room reservation was canceled so we must use the green room for the workshop.",
    "We will use the equipment that we already have and we must not buy any new hardware.",
    "The next planning meeting is on October 12 the 10 in the morning.",
    "The workshop materials, the suppliers reply, and the updated schedule are the topics for that meeting",
  ];
  const phoneSource = phoneSentences.join(" ");
  const context = "We spent the rest of the morning discussing various unrelated books, travel destinations, the weather, music, holidays and plans for lunch without making further decisions for the workshop team.";
  const sourceWith = (policy: string, later = ""): string =>
    `The team reviewed the options and the events of the week. Alice will send the report by Friday. ${policy} ${later} The planning meeting is on October 12. ${context}`;

  it.each([{ activeIds: [2, 3, 4] }, { activeIds: [2, 3, 4, 8] }])("retains the actual iPhone policy independently of the final task IDs $activeIds", ({ activeIds }) => {
    const proof = taskProof(activeIds.map((id) => taskQuote(phoneSource, phoneSentences[id - 1])));
    const before = JSON.stringify(proof);
    const result = selectSourceSummaryResult(selection(2, 6, 8, 10), phoneSource, phoneSource, proof);
    expect(phoneSource.split(/\s+/u)).toHaveLength(115);
    expect(result).toEqual({ summary: [2, 3, 4, 6, 8, 9, 10].map((id) => phoneSentences[id - 1]).join(" "), incomplete: false });
    expect(result.summary.split(/\s+/u)).toHaveLength(78);
    expect(JSON.stringify(proof)).toBe(before);
  });

  it.each([
    "We must not buy new hardware.",
    "We must never buy new hardware.",
    "Never buy new hardware.",
    "Do not buy new hardware.",
    "We are not allowed to buy new hardware.",
    "We use existing equipment and we must not buy new hardware.",
    "The red room is closed; we must not buy new hardware.",
    "Nie wolno kupować nowego sprzętu.",
    "Zabrania się kupowania nowego sprzętu.",
  ])("retains an unselected direct prohibition as its whole source sentence: %s", (policy) => {
    const content = sourceWith(policy);
    const result = selectSourceSummaryResult(selection(2, 4), content, content, taskProof([]));
    expect(result.summary).toContain(policy);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    "We did not buy new hardware.",
    "We will not buy new hardware.",
    "We no longer have to avoid buying new hardware.",
    "We must not buy new hardware?",
    "Should we not buy new hardware?",
    "If the budget falls, we must not buy new hardware.",
    "We must not buy new hardware unless the budget increases.",
    "When the policy changes, we must not buy new hardware.",
    "Alice said that we must not buy new hardware.",
    'Alice proposed "we must not buy new hardware".',
    "‘We will use existing equipment and we must not buy new hardware’.",
    "The previous policy was to use existing equipment and we must not buy new hardware.",
    "Last year we used existing equipment and we must not buy new hardware.",
    "We used existing equipment and we must not buy new hardware.",
    "The archived handbook says to use existing equipment and we must not buy new hardware.",
    "Never did we buy new hardware.",
    "Never have we bought new hardware.",
    "We must not have bought new hardware.",
    "The old rule was that we must not buy new hardware.",
    "We will discuss whether we must not buy new hardware.",
    "We used to say do not buy new hardware.",
    "Czy nie wolno kupować nowego sprzętu?",
    "Jeśli zabraknie pieniędzy, nie wolno kupować nowego sprzętu.",
    "Dawniej nie wolno kupować nowego sprzętu.",
  ])("does not turn a historical, conditional, quoted or questioned statement into mandatory policy: %s", (policy) => {
    const content = sourceWith(policy);
    expect(selectSourceSummaryResult(selection(2, 4), content, content, taskProof([]))).toEqual({
      summary: "Alice will send the report by Friday. The planning meeting is on October 12.", incomplete: false,
    });
  });

  it.each([
    "We may buy new hardware now.",
    "That restriction no longer applies; buying new hardware is allowed.",
  ])("keeps a later explicit lifting together with the original compound policy: %s", (lifting) => {
    const policy = "We will use existing equipment and we must not buy new hardware.";
    const content = sourceWith(policy, lifting);
    const result = selectSourceSummaryResult(selection(1, 2, 5), content, content, taskProof([]));
    expect(result.summary).toContain(policy);
    expect(result.summary).toContain(lifting);
    expect(result.incomplete).toBe(false);
  });

  it.each([
    "Bob may buy new hardware now.",
    "We may buy new books now.",
    "If the budget increases, we may buy new hardware now.",
    'Alice said "that restriction no longer applies".',
    "Does that restriction no longer apply?",
  ])("does not infer a lifting from unrelated, conditional or quoted permission: %s", (lifting) => {
    const policy = "We must not buy new hardware.";
    const content = sourceWith(policy, lifting);
    const result = selectSourceSummaryResult(selection(1, 2, 5), content, content, taskProof([]));
    expect(result.summary).toContain(policy);
    expect(result.summary).not.toContain(lifting);
  });

  it("preserves a validated whole-sentence removal instead of resurrecting the prohibition", () => {
    const policy = "We must not buy new hardware.";
    const lifting = "We may buy new hardware now.";
    const content = sourceWith(policy, lifting);
    const earlier = taskQuote(content, policy);
    const later = taskQuote(content, lifting);
    const result = selectSourceSummaryResult(selection(1, 2, 5), content, content, taskProof([later], [{ earlier, later }]));
    expect(result.summary).not.toContain(policy);
    expect(result.summary).toContain(lifting);
    expect(result.incomplete).toBe(false);
  });

  it("reports missing restriction coverage when the remaining sentence budget cannot contain it", () => {
    const sentences = [
      "Alice will prepare the workshop materials by Friday.", "Bob will contact the supplier by Tuesday.",
      "Emma will send the updated schedule to Alice before Wednesday.", "Clara will check the workshop room before Monday.",
      "David will print the invitations before Thursday.", "Fred will test the existing microphone before Saturday.",
      "Grace will prepare the welcome presentation before Sunday.", "We must not buy any new hardware.",
      "The planning meeting is on October 12.", context,
    ];
    const content = sentences.join(" ");
    const result = selectSourceSummaryResult(selection(1, 2, 3, 4), content, content,
      taskProof(sentences.slice(0, 7).map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(true);
    expect(result.summary).not.toContain(sentences[7]);
    expect(result.summary.match(/[.!?]/gu)).toHaveLength(7);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  });

  it("keeps the lifting atomic even when the original policy was also classified as an active task", () => {
    const policy = "We must not buy new hardware.";
    const lifting = "We may buy new hardware now.";
    const sentences = ["Alice will send the report by Friday.", "Bob will call the supplier by Tuesday.",
      "Clara will check the room by Monday.", policy, lifting, "The planning meeting is on October 12.", context];
    const content = sentences.join(" ");
    const result = selectSourceSummaryResult(selection(1, 2, 3), content, content,
      taskProof(sentences.slice(0, 4).map((quote) => taskQuote(content, quote))));
    expect(result.incomplete).toBe(false);
    expect(result.summary).toBe(sentences.slice(0, 5).join(" "));
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  });

  it("reports a dropped whole policy whose quote alone exceeds the source word budget", () => {
    const policy = `We must not buy ${"new hardware, batteries, cables and microphones ".repeat(50).trim()}.`;
    const content = sourceWith(policy);
    const result = selectSourceSummaryResult(selection(2, 4), content, content, taskProof([]));
    expect(result.incomplete).toBe(true);
    expect(result.summary).not.toContain(policy);
    expect(result.summary.split(/\s+/u).length).toBeLessThan(content.split(/\s+/u).length * 0.8);
  });
});
