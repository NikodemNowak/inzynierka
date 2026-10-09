import {
  cleanSummary,
  cleanTitle,
  fallbackTitle,
  isCopy,
  isUngrounded,
  parseTags,
  parseTasks,
} from "./noteOutput";

describe("English model output", () => {
  it("preserves meaningful English No instead of treating it as a Polish filler", () => {
    expect(cleanTitle("No meeting on Friday", "en")).toBe(
      "No meeting on Friday",
    );
    expect(cleanSummary("No payment is due this week.", "en")).toBe(
      "No payment is due this week.",
    );
    expect(
      fallbackTitle("No payment is due this week. Call tomorrow.", "en"),
    ).toBe("No payment is due this week");
  });

  it("removes English labels and rejects echoed English instructions", () => {
    expect(cleanTitle("Title: Client meeting plan.", "en")).toBe(
      "Client meeting plan",
    );
    expect(cleanSummary("Summary: Prepare the client meeting.", "en")).toBe(
      "Prepare the client meeting.",
    );
    expect(cleanTitle("Requirements: 3-5 words, noun phrase.", "en")).toBe("");
    expect(
      cleanSummary("Summarize the following note in 2-4 sentences.", "en"),
    ).toBe("");
  });

  it("filters English task headings without dropping an actual task that starts with Note", () => {
    expect(
      parseTasks(
        'Tasks:\n- Note the invoice number\n- Call Alice\nRules:\nNote:\n"""',
        "en",
      ),
    ).toEqual(["Note the invoice number", "Call Alice"]);
  });
});

// The failure modes below are the ones actually observed from Qwen3-1.7B on
// Polish notes, so each case is a regression guard rather than a hypothetical.

describe("cleanTitle", () => {
  it("keeps a well-formed title unchanged", () => {
    expect(cleanTitle("Zadania na tydzień")).toBe("Zadania na tydzień");
  });

  it("drops the thinking block Qwen3 emits before answering", () => {
    expect(
      cleanTitle("<think>Muszę wymyślić tytuł…</think>Ustalenia ze spotkania"),
    ).toBe("Ustalenia ze spotkania");
  });

  it("drops an unterminated thinking block", () => {
    expect(cleanTitle("<think>zastanawiam się")).toBe("");
  });

  it("rejects output that echoes the instructions instead of answering", () => {
    expect(cleanTitle("Wymagania: 3-5 słów, fraza rzeczownikowa")).toBe("");
    expect(cleanTitle("Podaj tytuł dla poniższej notatki")).toBe("");
  });

  it("strips the label the model likes to prepend", () => {
    expect(cleanTitle("Tytuł: Rozliczenie faktur")).toBe("Rozliczenie faktur");
  });

  it("strips a conversational opener parroted from the note", () => {
    expect(cleanTitle("Dobra, spotkanie z klientem")).toBe(
      "Spotkanie z klientem",
    );
  });

  it("removes surrounding quotes and a trailing period", () => {
    expect(cleanTitle('„Plan na wrzesień".')).toBe("Plan na wrzesień");
  });

  it("takes only the first line of a multi-line answer", () => {
    expect(cleanTitle("Umowa najmu\nDodatkowe wyjaśnienie modelu")).toBe(
      "Umowa najmu",
    );
  });

  it("caps the length at eight words", () => {
    const long =
      "jeden dwa trzy cztery pięć sześć siedem osiem dziewięć dziesięć";
    expect(cleanTitle(long).split(" ")).toHaveLength(8);
  });
});

describe("fallbackTitle", () => {
  it("uses the first sentence, capped at six words", () => {
    expect(
      fallbackTitle(
        "Ustalono aneks do umowy najmu magazynu na wrzesień. Reszta później.",
      ),
    ).toBe("Ustalono aneks do umowy najmu magazynu");
  });

  it("skips the chatty opener rather than making it the title", () => {
    expect(fallbackTitle("Dobra, notatka na szybko po spotkaniu")).toBe(
      "notatka na szybko po spotkaniu",
    );
  });
});

describe("cleanSummary", () => {
  it('removes the "Notatka dotyczy" opener and capitalises what follows', () => {
    expect(cleanSummary("Notatka dotyczy umowy najmu magazynu.")).toBe(
      "Umowy najmu magazynu.",
    );
  });

  it("rejects an instruction echo", () => {
    expect(cleanSummary("Streść poniższą notatkę w 2-4 zdaniach.")).toBe("");
  });
});

describe("parseTags", () => {
  it("maps model output onto the fixed category set", () => {
    expect(parseTags("Praca, Finanse")).toEqual(["Praca", "Finanse"]);
  });

  it("matches regardless of case and stray punctuation", () => {
    expect(parseTags('"praca", #DOM.')).toEqual(["Praca", "Dom"]);
  });

  it('drops anything outside the set, including "brak"', () => {
    expect(parseTags("brak")).toEqual([]);
    expect(parseTags("Praca, Wynajem magazynu")).toEqual(["Praca"]);
  });

  it("accepts newline-separated output", () => {
    expect(parseTags("Zdrowie\nZakupy")).toEqual(["Zdrowie", "Zakupy"]);
  });

  it("deduplicates and keeps at most two categories", () => {
    expect(parseTags("Praca, Praca, Dom, Finanse")).toEqual(["Praca", "Dom"]);
  });

  it("preserves an empty classification when no listed category is named", () => {
    expect(parseTags("brak")).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("parseTasks", () => {
  it("extracts one task per line and strips the bullets", () => {
    const raw = "- Przygotować aneks do umowy\n- Wysłać mail do księgowości";
    expect(parseTasks(raw)).toEqual([
      "Przygotować aneks do umowy",
      "Wysłać mail do księgowości",
    ]);
  });

  it("strips numbering as well as bullets", () => {
    expect(parseTasks("1. Sprawdzić termin płatności")).toEqual([
      "Sprawdzić termin płatności",
    ]);
  });

  it("drops leaked instruction and heading lines", () => {
    const raw = 'Zasady:\n- Zadanie pierwsze\nNotatka:\n"""\n- Zadanie drugie';
    expect(parseTasks(raw)).toEqual(["Zadanie pierwsze", "Zadanie drugie"]);
  });

  it("preserves more than eight tasks for later source validation", () => {
    const raw = Array.from({ length: 12 }, (_, i) => `- Zadanie ${i + 1}`).join(
      "\n",
    );
    expect(parseTasks(raw)).toHaveLength(12);
  });
});

describe("isCopy", () => {
  const note =
    "Dobra, notatka na szybko po spotkaniu z klientem. Ustaliliśmy, że aneks do umowy najmu przygotujemy do 15 czerwca. Czynsz rośnie o 10 procent od lipca.";

  it("flags output that repeats the note verbatim", () => {
    expect(isCopy(note, note)).toBe(true);
  });

  it("flags empty output", () => {
    expect(isCopy("", note)).toBe(true);
  });

  it("accepts a genuinely shorter summary that reuses the note vocabulary", () => {
    expect(
      isCopy(
        "Aneks do umowy najmu do 15 czerwca, czynsz rośnie o 10 procent.",
        note,
      ),
    ).toBe(false);
  });

  it("does not confuse a compressed source excerpt with an uncompressed copy", () => {
    expect(
      isCopy("Dobra, notatka na szybko po spotkaniu z klientem.", note),
    ).toBe(false);
  });

  it("accepts a faithful summary of an already dense note", () => {
    // The threshold was raised to 0.85 for exactly this case: a terse note
    // cannot be compressed much, so the summary stays similar in length and
    // vocabulary while still being the model's own wording.
    const dense =
      "Aneks do 15 czerwca. Czynsz plus 10 procent. Mail do księgowości.";
    const summary =
      "Aneks na 15 czerwca, czynsz wyższy o 10 procent, mail do księgowości.";
    expect(isCopy(summary, dense)).toBe(false);
  });

  it("accepts a short essential source sentence after omitting unrelated discussion", () => {
    const source =
      "We discussed several routes and their advantages for the whole morning. The launch is cancelled. Another long conversation about lunch followed without any decision.";
    expect(isCopy("The launch is cancelled.", source)).toBe(false);
  });
});

describe("isUngrounded", () => {
  const note =
    "Aneks do umowy najmu magazynu trzeba przygotować do 15 czerwca.";

  it("flags a summary that shares almost no vocabulary with the note", () => {
    expect(
      isUngrounded(
        "Pacjent zgłasza bóle głowy i gorączkę od trzech dni.",
        note,
      ),
    ).toBe(true);
  });

  it("accepts a summary grounded in the note", () => {
    expect(
      isUngrounded("Przygotować aneks do umowy najmu magazynu.", note),
    ).toBe(false);
  });

  it("flags empty output", () => {
    expect(isUngrounded("", note)).toBe(true);
  });

  it("rejects an invented number or weekday even when the subject vocabulary matches", () => {
    const source =
      "Send the client report by Thursday. The budget is 1200 euros.";
    expect(
      isUngrounded(
        "Send the client report by Friday. The budget is 1500 euros.",
        source,
      ),
    ).toBe(true);
    expect(
      isUngrounded(
        "The client report is due Thursday with a budget of 1200 euros.",
        source,
      ),
    ).toBe(false);
  });
});
