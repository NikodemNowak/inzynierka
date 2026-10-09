import { parseAnchoredTitle, titleAnchorPrompt, titleNeedsSourceAnchors } from "./titleGrounding";

test.each([
  ["Sprawdzenie zestawienia", "Zespół sprawdził zestawienie.", "pl"],
  ["Sprawdzenie dostępności sali", "Sprawdzę dostępność większej sali.", "pl"],
  ["Sprawdzenie temperatury", "Sprawdziliśmy temperaturę przed uruchomieniem urządzenia.", "pl"],
  ["Sprawdzenie formularza", "Sprawdź formularz przed wysłaniem.", "pl"],
  ["Treść raportu", "Rozmawialiśmy o treści raportu.", "pl"],
  ["Ważność umowy", "Pamiętaj o ważności umowy.", "pl"],
  ["Table revision", "Please send the revised version of the table.", "en"],
  ["Document revisions", "The editor revises the document.", "en"],
  ["Schedule revision", "We are revising the schedule.", "en"],
  ["Ustalenia", "To podsumowanie dzisiejszych ustaleń.", "pl"],
  ["Nowe ustalenia", "Nie zmieniono nowych ustaleń.", "pl"],
  ["Ustalenie kosztu", "Wrócimy do ustaleń dotyczących kosztu.", "pl"],
] as const)("accepts a source action noun or a closed nominal inflection: %s", (title, source, language) => {
  expect(titleNeedsSourceAnchors(title, source, language)).toBe(false);
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, language)).toBe(title);
});

test.each([
  ["Sprawdzenie zestawienia", "Zespół naprawił zestawienie.", "pl"],
  ["Sprawdzenie zestawienia", "Prawdziwe zestawienie jest w załączniku.", "pl"],
  ["Sprawdzenie zestawienia", "Sprawiedliwość i zestawienie były tematami rozmowy.", "pl"],
  ["Table revision", "We revisited the table.", "en"],
  ["Document revision", "Revisionism is unrelated to this document.", "en"],
  ["Cost correction", "The current cost replaces the previous cost.", "en"],
  ["Korekty kosztów", "Nowy koszt zastępuje poprzedni koszt.", "pl"],
  ["Ustalenia", "Stalowe elementy są gotowe.", "pl"],
  ["Dostępność sali", "Omówiliśmy udostępnienie sali.", "pl"],
  ["Ważność umowy", "Ważne warunki umowy są w załączniku.", "pl"],
] as const)("does not treat a nearby prefix or inferred activity as support: %s", (title, source, language) => {
  expect(titleNeedsSourceAnchors(title, source, language)).toBe(true);
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, language)).toThrow();
});

test("keeps actor names, amounts, dates and negations outside morphological rewrites", () => {
  const source = "Marta sprawdzi koszt 1800 złotych do piątku. Nie zamówiono projektora.";
  for (const title of ["Sprawdzenie Marcina", "Koszt 1900", "Termin sobota", "Zakup projektora"]) {
    expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toThrow();
  }
  expect(parseAnchoredTitle('{"anchors":[1],"title":"Sprawdzenie kosztu Marty"}', source, source, "pl"))
    .toBe("Sprawdzenie kosztu Marty");
});

test("Polish retry preserves the bounded supported-word rewrite with natural nominative inflection", () => {
  const source = "Nowy koszt zastępuje dawny koszt. Następne spotkanie jest w listopadzie.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Korekty kosztów");
  expect(prompt).toContain('"supportedWords":["kosztów"]');
  expect(prompt).toContain('"unsupportedWords":["Korekty"]');
  expect(prompt).toContain("mianowniku");
  expect(prompt).toContain("użyj WYŁĄCZNIE tych słów");
  expect(prompt).toContain("Nigdy nie używaj unsupportedWords");
  expect(prompt).not.toContain("Wybierz ponownie główny temat");
  expect(parseAnchoredTitle('{"anchors":[1,2],"title":"Koszt i spotkanie"}', source, source, "pl"))
    .toBe("Koszt i spotkanie");
});

test("English wholly unsupported retry exposes the actual source nouns without repeating its category", () => {
  const source = "The table was revised. The current review concerns the final estimate.";
  const prompt = titleAnchorPrompt(source, "en", source, "Project Updates");
  const vocabulary = prompt.split("LITERAL_SOURCE_VOCABULARY_DATA_JSON\n")[1]?.split("\n")[0];
  expect(vocabulary && JSON.parse(vocabulary)).toEqual([
    "the", "table", "was", "revised", "current", "review", "concerns", "final", "estimate",
  ]);
  expect(parseAnchoredTitle('{"anchors":[1,2],"title":"Table revision and estimate"}', source, source, "en"))
    .toBe("Table revision and estimate");
});

test.each([
  ["Sprawdzenie zadań", "Zespół sprawdził zestawienie. Nie przydzielono żadnych nowych zadań ani obowiązków."],
  ["Sprawdzenie dyżurów", "Sprawdziliśmy dokumentację. Nie ustalono nowych dyżurów."],
  ["Przygotowanie biletu", "Przygotuję prezentację. Bilet jest w archiwum."],
  ["Wysyłka kluczy", "Wyślę formularz. Klucze pozostają w szufladzie."],
  ["Sprawdzenie archiwum", "Sprawdziłem formularz i zamknąłem archiwum."],
  ["Sprawdzenie dyżurów", "Nie przydzielono dyżurów, ale zespół sprawdził dokumentację."],
  ["Sprawdzenie temperatury", "Nie sprawdzono temperatury urządzenia."],
  ["Przygotowanie materiałów", "Anulowano przygotowanie materiałów."],
  ["Sprawdzenie dokumentów", "Według plotki ktoś rzekomo sprawdził dokumenty."],
  ["Sprawdzenie sali", "W instrukcji wydrukowano cytat: „sprawdź salę”."],
  ["Przygotowanie materiałów", "Recenzent odwołał przygotowanie materiałów."],
  ["Sprawdzenie sali", "Sprawdzę adres i zarezerwuję salę."],
] as const)("does not build a positive action heading from unrelated or qualified objects: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(true);
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toThrow();
});

test.each([
  ["Sprawdzenie dyżurów", "Sprawdziliśmy dyżury. Nie przydzielono nowych dyżurów."],
  ["Sprawdzenie temperatury", "Sprawdzimy temperaturę urządzenia."],
  ["Sprawdzenie formularza", "Nie przydzielono dyżurów, ale zespół sprawdził formularz."],
  ["Sprawdzenie kluczy", "Sprawdziłem dokumenty i klucze."],
  ["Sprawdzenie formularzy", "Sprawdziłem dokumenty, formularze i klucze."],
  ["Sprawdzenie temperatury", "Nie tylko sprawdziliśmy temperaturę, ale też naprawiliśmy urządzenie."],
  ["Brak przygotowania materiałów", "Stwierdzono brak przygotowania materiałów."],
  ["Anulowane przygotowanie materiałów", "Anulowane przygotowanie materiałów nie jest nowym obowiązkiem."],
  ["Rzekome sprawdzenie dokumentów", "Rzekome sprawdzenie dokumentów jest przedmiotem wyjaśnień."],
  ["Koszty", "Sprawdzę koszty urządzenia. Nie przydzielono nowych zadań."],
  ["Ustalenia", "Nie zmieniono wcześniejszych ustaleń."],
] as const)("retains actual action objects, noun lists, negative qualifiers and ordinary subjects: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(false);
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toBe(title);
});

test("a Polish action heading must anchor the actual supporting complete statement", () => {
  const source = "Dokumenty są w archiwum. Zespół sprawdził zestawienie. Nie przydzielono nowych zadań.";
  expect(() => parseAnchoredTitle('{"anchors":[1],"title":"Sprawdzenie zestawienia"}', source, source, "pl")).toThrow();
  expect(parseAnchoredTitle('{"anchors":[2],"title":"Sprawdzenie zestawienia"}', source, source, "pl"))
    .toBe("Sprawdzenie zestawienia");
  expect(parseAnchoredTitle('{"anchors":[1,2],"title":"Sprawdzenie zestawienia"}', source, source, "pl"))
    .toBe("Sprawdzenie zestawienia");
});

test("the Polish bounded rewrite does not promote an object supported only by another negated sentence", () => {
  const source = "Zespół sprawdził zestawienie. Nie przydzielono nowych zadań.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Sprawdzenie zadań");
  expect(prompt).toContain('"supportedWords":["Sprawdzenie"]');
  expect(prompt).toContain('"unsupportedWords":["zadań"]');
});

test("English keeps its established word and omitted-anchor contracts", () => {
  const source = "The editor revised the document. The table remains in the archive.";
  expect(titleNeedsSourceAnchors("Table revision", source, "en")).toBe(false);
  expect(parseAnchoredTitle('{"anchors":[2],"title":"Document revision"}', source, source, "en"))
    .toBe("Document revision");
});

test.each([
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport i Marek czyta dokumenty."],
  ["Sprawdzenie zestawienia", "Zespół sprawdził raport i Marta przeczyta zestawienie."],
  ["Sprawdzenie raportu", "Zespół sprawdził formularz i Lena omawia raport."],
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport i czyta dokumenty."],
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport oraz czyta dokumenty."],
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport, Marek czyta dokumenty."],
  ["Sprawdzenie listy dokumentów", "Zespół sprawdził raport i lista dokumentów jest niekompletna."],
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport i dokumenty wymagają podpisu."],
  ["Sprawdzenie katalogu", "Zespół sprawdził raport i katalog ma poprawny adres."],
  ["Sprawdzenie formularzy", "Zespół sprawdził raport i Marek czyta dokumenty, formularze."],
  ["Sprawdzenie raportu", "Zespół nie zamierza w tym tygodniu sprawdzić raportu."],
  ["Wysyłka dokumentów", "Zespół nie miał wczoraj czasu na wysłanie dokumentów."],
  ["Sprawdzenie raportu", "'Zespół sprawdził raport.'"],
  ["Sprawdzenie raportu", "‘Zespół sprawdził raport.’"],
] as const)("does not adopt an independent coordinated predicate object: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(true);
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toThrow();
});

test.each([
  ["Sprawdzenie formularzy", "Zespół sprawdził dokumenty i formularze."],
  ["Sprawdzenie formularzy", "Zespół sprawdził dokumenty oraz formularze."],
  ["Sprawdzenie dokumentów i formularzy", "Zespół sprawdził dokumenty i formularze."],
  ["Sprawdzenie listy dokumentów", "Zespół sprawdził raport i listę dokumentów."],
  ["Sprawdzenie ważnych formularzy", "Zespół sprawdził raport i ważne formularze."],
  ["Sprawdzenie formularzy", "Zespół sprawdził dokumenty, formularze."],
  ["Sprawdzenie dokumentów", "Zespół sprawdził raport i Marta sprawdziła dokumenty."],
  ["Sprawdzenie formularza", "Sprawdzę formularz O'Connora."],
] as const)("keeps literal simple or modified coordinated object phrases: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(false);
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toBe(title);
});

test("an independent predicate object is absent from the existing rewrite hints", () => {
  const source = "Zespół sprawdził raport i czyta dokumenty.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Sprawdzenie dokumentów");
  expect(prompt).toContain('"supportedWords":["Sprawdzenie"]');
  expect(prompt).toContain('"unsupportedWords":["dokumentów"]');
});

test.each([
  ["Odwołanie zobowiązania", "Odwołanie zobowiązania nie nastąpiło."],
  ["Odwołanie", "Odwołanie zobowiązania nie nastąpiło."],
  ["Anulowanie rezerwacji", "Anulowanie rezerwacji nie nastąpiło."],
  ["Anulowanie", "Anulowanie rezerwacji nie nastąpiło."],
] as const)("does not erase following negation of a nominal cancellation witness: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(true);
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toThrow();
});

test.each([
  ["Odwołanie zobowiązania", "Odwołanie zobowiązania nastąpiło."],
  ["Odwołanie", "Odwołanie zobowiązania nastąpiło."],
  ["Anulowanie rezerwacji", "Anulowanie rezerwacji nastąpiło."],
  ["Anulowanie", "Anulowanie rezerwacji nastąpiło."],
  ["Odwołanie zobowiązania", "Zespół odwołał zobowiązanie Alicji."],
  ["Anulowanie rezerwacji", "Zespół anulował rezerwację sali."],
  ["Odwołanie zobowiązania", "Odwołanie zobowiązania nastąpiło, ale nie zamknięto dawnej sprawy."],
  ["Odwołanie zobowiązania", "Zespół odwołał zobowiązanie, ale nie zamknął dawnej sprawy."],
  ["Odwołanie rezerwacji", "Odwołanie rezerwacji nastąpiło i nie wysłano formularza."],
  ["Anulowanie rezerwacji", "Anulowanie rezerwacji nastąpiło, lecz nie zamknięto sprawy."],
  ["Odwołanie rezerwacji", "Odwołanie rezerwacji nie tylko nastąpiło, ale też zostało potwierdzone."],
  ["Odwołanie rezerwacji", "Odwołano rezerwację nie wczoraj."],
] as const)("keeps positive nominal or finite cancellation and separate negative clauses: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(false);
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toBe(title);
});

test.each([
  ["Odwołanie zobowiązania", "Wczoraj Alicja obiecała, że wyśle aktualny harmonogram do piątku. Ta czynność nadal pozostaje do wykonania. Bruno zakończył wysyłanie starych faktur w ubiegłym miesiącu. To podsumowanie dzisiejszych ustaleń; nie odwołano zobowiązania Alicji."],
  ["Odwołanie rezerwacji", "Nie odwołano rezerwacji."],
  ["Anulowanie zamówienia", "Nie anulowano zamówienia."],
  ["Odwołanie rezerwacji", "Zespół nie zamierza w tym tygodniu odwołać rezerwacji."],
  ["Anulowanie biletu", "Nie mieliśmy wczoraj czasu na anulowanie biletu."],
  ["Odwołanie rezerwacji", "'Odwołano rezerwację.'"],
  ["Anulowanie biletu", "‘Anulowano bilet.’"],
  ["Odwołanie rezerwacji", "Ktoś podobno odwołał rezerwację."],
  ["Anulowanie zamówienia", "Rzekomo anulowano zamówienie."],
  ["Odwołanie formularza", "Odwołano rezerwację. Formularz jest w archiwum."],
  ["Anulowanie umowy", "Anulowano zamówienie i Marek czyta umowę."],
  ["Odwołanie biletu", "Odwołano rezerwację i czyta bilet."],
  ["Odwołanie zobowiązania", "Odwołano rezerwację, ale nie odwołano zobowiązania."],
  ["Odwołanie", "Nie odwołano rezerwacji."],
  ["Anulowanie", "Nie anulowano zamówienia."],
  ["Odwołanie", "‘Odwołano rezerwację.’"],
] as const)("rejects cancellation headings with only negative, qualified or unrelated support: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(true);
  expect(() => parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toThrow();
});

test.each([
  ["Odwołanie rezerwacji", "Odwołano rezerwację."],
  ["Anulowanie zamówienia", "Anulowano zamówienie."],
  ["Odwołanie spotkania", "Zespół odwołał spotkanie."],
  ["Anulowanie biletu", "Anulujemy bilet."],
  ["Odwołanie rezerwacji", "Odwołam rezerwację."],
  ["Odwołanie rezerwacji", "Rezerwacja została odwołana."],
  ["Anulowanie zamówienia", "Zamówienie zostało anulowane."],
  ["Odwołanie biletu", "Odwołano rezerwację i bilet."],
  ["Anulowanie zamówienia i biletu", "Anulowano zamówienie oraz bilet."],
  ["Odwołanie zobowiązania", "Nie odwołano rezerwacji, ale odwołano zobowiązanie."],
  ["Odwołanie rezerwacji", "Nie tylko odwołano rezerwację, ale też wysłano wiadomość."],
  ["Odwołanie", "Odwołano rezerwację."],
  ["Anulowanie", "Anulowano zamówienie."],
  ["Brak odwołania rezerwacji", "Stwierdzono brak odwołania rezerwacji."],
] as const)("retains affirmative cancellation families and literal negative headings: %s", (title, source) => {
  expect(titleNeedsSourceAnchors(title, source, "pl")).toBe(false);
  expect(parseAnchoredTitle(JSON.stringify({ anchors: [1], title }), source, source, "pl")).toBe(title);
});

test("a cancellation heading must anchor its affirmative statement", () => {
  const source = "Nie odwołano zobowiązania. Odwołano rezerwację.";
  expect(() => parseAnchoredTitle('{"anchors":[1],"title":"Odwołanie rezerwacji"}', source, source, "pl")).toThrow();
  expect(parseAnchoredTitle('{"anchors":[2],"title":"Odwołanie rezerwacji"}', source, source, "pl"))
    .toBe("Odwołanie rezerwacji");
});

test("the bounded rewrite cannot shorten a negated cancellation into a bare cancellation noun", () => {
  const source = "Nie odwołano zobowiązania. Harmonogram pozostaje aktualny.";
  const prompt = titleAnchorPrompt(source, "pl", source, "Odwołanie zobowiązania");
  expect(prompt).toContain('"supportedWords":[]');
  expect(prompt).toContain('"unsupportedWords":["Odwołanie","zobowiązania"]');
});
