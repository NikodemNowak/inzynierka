export interface SourceUnitPlan {
  readonly version: 1;
  readonly source: string;
  readonly identity: string;
  readonly ends: readonly number[];
}

export interface OriginalSourceUnit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// A recognizer can separate clock digits with whitespace; punctuation recovery
// may join those same digits with a colon. Expand only this exact numeric pair
// back into its original words. Never normalize a value or an existing colon.
export const punctuationProposalWords = (content: string, proposal: string): string[] => {
  const original = content.match(/\S+/gu) ?? [];
  const words: string[] = [];
  for (const word of proposal.match(/\S+/gu) ?? []) {
    const pair = /^(\d+):(\d+)([.,!?;:]*)$/u.exec(word);
    if (pair && original[words.length] === pair[1] && original[words.length + 1] === pair[2])
      words.push(pair[1], pair[2] + pair[3]);
    else words.push(word);
  }
  return words;
};

const identity = (source: string, ends: readonly number[]): string =>
  JSON.stringify([1, source, ends]);

// Shared with the established task coverage grammar. A boundary proposal must
// not turn one of these governing scopes into an independent affirmative ID.
export const hasUnsupportedRequiredTaskContext = (text: string): boolean =>
  text.includes("?") ||
  /["“”„«»]|(?:^|\s)['‘]|['’](?:\s|[.,;!?]|$)/u.test(text) ||
  /(?:^|[^\p{L}])(?:if|unless|whether|provided|assuming|when|jeśli|jeżeli|gdyby|gdy|czy|said|says|recalled|remembered|reported|mentioned|asked|proposed|previously|formerly|wspomnia\p{L}*|powiedzia\p{L}*|przypomnia\p{L}*|pod\s+warunkiem|o\s+ile|w\s+razie|chyba\s+że|(?:old|previous|earlier|dawna|poprzednia|wcześniejsza)\s+(?:rule|policy|requirement|obligation|zasada|polityka))(?!\p{L})/iu.test(text);

// These parents have scopes that a punctuation proposal cannot prove. Hold the
// whole original source for review rather than manufacturing affirmative IDs.
const ambiguousParent = (source: string): boolean =>
  hasUnsupportedRequiredTaskContext(source) ||
  /["„“”«»]|(?:^|[^\p{L}\p{N}])['‘’]|['‘’](?=$|[^\p{L}\p{N}])/u.test(source) ||
  /\b(?:suppose|hypothetical|told|claimed|disputed|allegedly|example|according to|in case)\b|(?:^|\s)(?:kiedy|w przypadku|na przykład|według|rzekomo|podobno|powiedzieli|powiedziano|mówił(?:a|em|am)?|mówiono|twierdzi(?:ł|ła)?|relacjonował(?:a)?|nie jest prawdą|nieprawda|nie uzgodniono|nie ustalono)(?=\s|$)|\b(?:no assignment was agreed|not an assignment)\b/iu.test(source);

export const canProjectSourceUnits = (source: string): boolean => !ambiguousParent(source);

const correctionCue = (text: string): boolean => /^(?:poprawka|korekta|correction|update)[:,;]?$/iu.test(text);

const unsafeBoundary = (left: string, right: string): boolean => {
  if (/(?:^|\s)(?:nie|not|no|never|bez|without|if|unless|że|aby|żeby|bo|ponieważ|because|that|whether|do|przed|by|before|to|will|must|shall|would|could|might|may|ma|mam|masz|mamy|muszę|musimy|musisz|muszą)$/iu.test(left) ||
      // First-person "muszę/musimy" opens the speaker's own statement; no subject is stranded.
      /^(?:że|aby|żeby|because|that|unless|whether|will|must|shall|would|could|might|may|ma|mam|masz|mamy|musisz|muszą)(?:\s|$)/iu.test(right)) return true;
  // An added cut before a third-person predicate can strand its subject in
  // introductory text. Retain that original context without guessing a name
  // or owner; explicit next subjects and first-person statements stay intact.
  // An existing source sentence terminator supplies its own hard boundary.
  const finitePredicate = "(?:prześle|prześlą|wyśle|wyślą|przesyła|przesyłają|wysyła|wysyłają|sprawdzi|sprawdzą|sprawdza|sprawdzają|przejrzy|przejrzą|przygotuje|przygotują|uzupełni|uzupełnią|potwierdzi|potwierdzą|wykona|wykonają|zrobi|zrobią|dostarczy|dostarczą|przekaże|przekażą|sends|checks|prepares|reviews|confirms|completes|updates|delivers|forwards)";
  if (!/[.!?]$/u.test(left) &&
      new RegExp(`^${finitePredicate}(?:\\s|$)`, "iu").test(right)) return true;
  // These orphan heads can be qualifiers of the preceding action. Abstention
  // is deliberately conservative; it never supplies an owner or action.
  if (/^(?:z|ze|with|of|to)(?:\s|$)/iu.test(right) ||
      /^[\p{L}]+(?:czy|cza|cze|owy|owa|owe|nego|nej|alny|alna|alne)(?:\s|$)/iu.test(right)) return true;
  // A preposed closed deadline cannot become the end of introductory material.
  const date = "(?:[0-3]?\\d\\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)|(?:poniedziałku|wtorku|środy|czwartku|piątku|soboty|niedzieli)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+[0-3]?\\d)";
  const hasOwnAction = /(?:^|\s)(?:mam|ma|mamy|masz|muszę|musimy|musisz|muszą)\s+[\p{L}]+ć(?:\s|$)|\b(?:will|must|shall)\s+(?:not\s+)?[\p{L}]+(?:\s|$)/iu.test(left) ||
    new RegExp(`(?:^|\\s)${finitePredicate}(?:\\s|$)`, "iu").test(left);
  if (!hasOwnAction && new RegExp(`(?:^|\\s)(?:do|przed|by|before)\\s+${date}$`, "iu").test(left)) return true;
  if (hasOwnAction && new RegExp(`^(?:do|przed|by|before)\\s+${date}$`, "iu").test(right)) return true;
  return /\d$/u.test(left) && /^(?:zł|złotych|pln|eur|usd|dollars?|euros?|pounds?|kg|%|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?:\s|$)/iu.test(right);
};

const rawUnits = (content: string, ends: readonly number[]): OriginalSourceUnit[] => {
  let start = 0;
  return ends.map((end) => {
    const raw = content.slice(start, end);
    const text = raw.trim();
    const offset = start + raw.indexOf(text);
    start = end;
    return { start: offset, end: offset + text.length, text };
  });
};

// Deterministic fallback for a long unpunctuated transcript: cut before strong
// Polish discourse markers and, past length limits, at conjunctions or any safe
// word boundary. Cuts only choose positions; unit text stays exact source.
const STRONG_STARTS: readonly (readonly string[])[] = [
  ["po", "pierwsze"], ["po", "drugie"], ["po", "trzecie"], ["po", "czwarte"], ["po", "piąte"],
  ["a", "poza", "tym"], ["poza", "tym"], ["a", "propos"], ["no", "i"], ["no", "więc"],
  ["aha"], ["dobra"], ["okej"], ["ok"], ["potem"], ["następnie"], ["na", "koniec"], ["na", "początek"],
  ["i", "jeszcze"], ["kolejna", "rzecz"], ["kolejna", "sprawa"], ["tak", "czy", "inaczej"],
  ["uwaga"], ["jeszcze", "jedna", "rzecz"], ["ostatnia", "rzecz"],
];
const DANGLING_END = /^(?:i|w|we|na|z|ze|do|od|po|za|o|u|nad|pod|przy|bez|dla|przez|oraz|albo|lub|a|ale|bo|więc|nie|że|jak|ten|ta|te|tę|to|ma|mam|mój|moje)$/iu;
const MAX_UNIT_WORDS = 30;
// Speech recognizers capitalize where they hear a new phrase; a capital mid-text
// is the strongest cue an unpunctuated transcript has.
const CAPITALIZED = /^\p{Lu}\p{Ll}*$/u;
const FIRST_PAST = /^\p{L}{3,}(?:łem|łam|liśmy|łyśmy)$/u;
const FIRST_PRESENT = /^\p{L}{3,}uję$/u;
const NUMBER_WORD = /^(?:\d+(?::\d+)?|jeden|jedna|jedno|dwa|dwie|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|\p{L}+naście|\p{L}*dzieści|\p{L}*dziesiąt|sto|dwieście|\p{L}*set|tysiąc\p{L}*|(?:pierwsz|drug|trzeci|ósm|siódm|szóst|dziewiąt|dziesiąt|\p{L}+nast|dwudziest|trzydziest)\p{L}*)$/iu;
const WEEKDAY = /^(?:poniedziałek|wtorek|środę|środa|czwartek|piątek|sobotę|sobota|niedzielę|niedziela|weekend)$/iu;
const TIME_STARTS = new Set(["jutro", "pojutrze", "dzisiaj", "dziś", "wczoraj", "później", "potem"]);
const PRONOUN_STARTS = new Set(["on", "ona", "oni", "one"]);
const DUTY_AFTER_CONJUNCTION = new Set(["muszę", "musimy", "trzeba", "mam", "jeszcze"]);
const WEAK_STARTS = new Set(["a", "ale", "więc", "wtedy", "dalej", "czyli"]);
const SOFT_STARTS = new Set(["albo", "lub", "bo", "ponieważ", "jeszcze"]);
const NAMED_AFTER = /^(?:zajęci\p{L}*|wykład\p{L}*|kurs\p{L}*|przedmiot\p{L}*|ćwiczeni\p{L}*|laboratori\p{L}*|lab|projekt\p{L}*|egzamin\p{L}*|kolokwi\p{L}*|firm\p{L}*|ulic\p{L}*|sklep\p{L}*|aplikacj\p{L}*|program\p{L}*|szkoł\p{L}*|szpital\p{L}*|restauracj\p{L}*|hotel\p{L}*|kawiarni\p{L}*|pan|pani|panem|panią|doktor\p{L}*|dr|mgr)$/u;
const REPORT_NEXT =new Set(["też", "także", "że", "żebym", "żeby", "mi", "mnie", "nam", "jeszcze", "wtedy"]);
const TIME_TAIL = /^(?:o|około|rano|wieczorem|jutro|dzisiaj|dziś|wczoraj)$/iu;
const INTENSIFIER = new Set(["całkiem", "bardzo", "dość", "naprawdę", "nawet", "mega", "super", "niezbyt", "nie"]);
const OBJECT_PRONOUN = new Set(["ją", "go", "mu", "je", "jej", "im", "ich", "cię", "ci", "nią", "nim"]);
const ADJECTIVE_END = /^\p{L}{4,}(?:ych|ymi|ego|emu|owej|owym|nej|nym|skiej|skim)$/u;
const ORDINAL_END = /(?:ej|ego|ym)$/u;
const TOPIC_STARTS = new Set(["spotkanie", "rachunek", "rachunki", "wizyta", "zaliczka", "zaliczkę", "zakupy", "prezentacja", "egzamin", "kolokwium", "termin", "rata", "czynsz", "przegląd", "urodziny", "wyjazd", "lot", "pociąg"]);

// English speech: capitals mark names, days and months, so only "I…" and spoken
// connectives start a statement, and never right after an article or preposition.
const EN_STOPWORDS = new Set(["the", "and", "is", "it", "of", "for", "you", "that", "with", "have", "i'm", "my", "was", "are", "this"]);
const EN_DANGLING = new Set(["the", "a", "an", "to", "of", "for", "with", "at", "on", "in", "by", "and", "or", "from", "mr", "mrs", "ms", "dr", "my", "your", "his", "her", "our", "their", "is", "are", "was", "be", "than", "about", "into"]);
const EN_SELF = /^i(?:'m|'ll|'ve|'d)?$/u;
const EN_STRONG: readonly (readonly string[])[] = [["and", "then"], ["also"], ["so"], ["anyway"], ["okay"], ["ok"], ["oh", "and"], ["one", "more", "thing"]];
const isEnglish = (norm: readonly string[]): boolean => norm.filter((word) => EN_STOPWORDS.has(word)).length / Math.max(1, norm.length) > 0.08;
const englishScore = (index: number, raw: readonly string[], norm: readonly string[],
  startsWith: (index: number, phrase: readonly string[]) => boolean): number => {
  // "… for coffee and I dropped the course": the "and" opens the new statement.
  if (norm[index] === "and" && EN_SELF.test(norm[index + 1] ?? "") && (raw[index + 1] ?? "").startsWith("I")) return 4;
  if (EN_DANGLING.has(norm[index - 1])) return 0;
  if (EN_SELF.test(norm[index]) && raw[index].startsWith("I")) return 4;
  if (EN_STRONG.some((phrase) => startsWith(index, phrase))) return 3;
  if (["but", "because", "then", "now"].includes(norm[index])) return 1;
  return 0;
};

// How strongly a new statement seems to begin at this word (0 = no cue).
const boundaryScore = (index: number, raw: readonly string[], norm: readonly string[],
  startsWith: (index: number, phrase: readonly string[]) => boolean, english = false): number => {
  if (english) return englishScore(index, raw, norm, startsWith);
  const previous = norm[index - 1];
  // "całkiem dobra": an adjective after an intensifier, not the discourse "Dobra,".
  if (STRONG_STARTS.some((phrase) => startsWith(index, phrase)) && !INTENSIFIER.has(previous)) return 5;
  // "muszę zrobić Slajdy", "nie zapomnieć oddać": an infinitive keeps its object.
  // "to ja ją przygotowuję": an object pronoun keeps its verb.
  if (/\p{L}{2,}ć$/u.test(previous) || OBJECT_PRONOUN.has(previous)) return 0;
  // "z sieci Komputerowych": a capitalized adjective ending continues the noun phrase.
  if (CAPITALIZED.test(raw[index]) && ADJECTIVE_END.test(norm[index]) && !NUMBER_WORD.test(norm[index])) return 0;
  // "dwa Terabajt", "dwudziestej 2": a number keeps its unit or second part, but
  // "do dwudziestej trzeciej Zakupy na weekend" starts a new statement after an ordinal.
  if (NUMBER_WORD.test(previous) && (NUMBER_WORD.test(norm[index]) || (CAPITALIZED.test(raw[index]) && !(ORDINAL_END.test(previous) && raw[index].length > 3)))) return 0;
  // "zadzwoniła Ola": a name right after a past verb is its subject.
  // "zajęcia Jakość oprogramowania": a capital after such a noun starts its name.
  if (CAPITALIZED.test(raw[index]) && NAMED_AFTER.test(previous)) return 0;
  if (CAPITALIZED.test(raw[index]))
    return raw[index].length > 2 && !TIME_STARTS.has(norm[index]) && /\p{L}{2,}(?:ł|ła|ło|li|ły)$/u.test(previous) ? 0 : 4;
  // "o 10:30 spotkałem się": the time before the verb belongs to its clause.
  const afterTime = TIME_TAIL.test(previous) || NUMBER_WORD.test(previous) || WEEKDAY.test(previous);
  if ((FIRST_PAST.test(norm[index]) || FIRST_PRESENT.test(norm[index])) && !afterTime) return 3;
  if ((norm[index] === "w" || norm[index] === "we") && WEEKDAY.test(norm[index + 1] ?? "")) return previous === "się" ? 0 : 2;
  if (TIME_STARTS.has(norm[index]) && previous === "się") return 0;
  if (TIME_STARTS.has(norm[index]) || PRONOUN_STARTS.has(norm[index]) || norm[index] === "muszę" || norm[index] === "musimy") return 2;
  // "poprosił też żebym…": another person's past verb starts a report.
  // "… tygodnie szef powiedział że …": the subject of a reported statement opens it.
  if (/^\p{Ll}{3,}$/u.test(raw[index]) && !/(?:ł|ła|li|ły|ć|ę|em|am)$/u.test(norm[index]) && !WEAK_STARTS.has(norm[index]) &&
      /^\p{L}{3,}(?:ł|ła|li|ły)$/u.test(norm[index + 1] ?? "") && REPORT_NEXT.has(norm[index + 2] ?? "") && !DANGLING_END.test(previous)) return 1;
  // "szef powiedział że": after a plain noun the verb has its subject right before it.
  if (/^\p{L}{3,}(?:ł|ła|li|ły)$/u.test(norm[index]) && !afterTime && REPORT_NEXT.has(norm[index + 1] ?? "") &&
      !(/^\p{Ll}{3,}$/u.test(raw[index - 1] ?? "") && !/(?:ł|ła|li|ły|ć|ę|em|am)$/u.test(previous) && !WEAK_STARTS.has(previous))) return 1;
  // "ale muszę jeszcze to dzisiaj przejrzeć": a new duty, not a qualifier of the last one.
  if (["ale", "a", "i", "więc"].includes(norm[index]) && DUTY_AFTER_CONJUNCTION.has(norm[index + 1] ?? "")) return 2;
  // "… mama upiekła spotkanie miało być …", "… za nocleg rachunek za internet …":
  // in a dictated plan these nouns open the next matter.
  if (TOPIC_STARTS.has(norm[index]) && !/^(?:na|w|we|z|ze|do|o|za|po|przed|mam|mamy|ma|mój|moje|moja|ten|to|ta|jakiś|jedno|jeden|każdy)$/u.test(previous)) return 2;
  if (WEAK_STARTS.has(norm[index])) return 1;
  if (norm[index] === "trzeba") return 0.5;
  if (SOFT_STARTS.has(norm[index])) return 0.5;
  return 0;
};

// "wypłata za nowych Za polecone firmy nie za nowe": the right side corrects the
// last words of the left one, so both must stay in one statement.
const CORRECTION_SKIP = /^(?:za|do|na|w|we|z|ze|o|od|u|dla|po|przy|tylko|tak|to|ten|ta|te)$/iu;
const correctsLeft = (left: string, right: string): boolean => {
  const tail = (left.toLowerCase().match(/\p{L}{3,}/gu) ?? []).slice(-3).map((word) => word.slice(0, 3));
  const after: string[] = right.toLowerCase().match(/\p{L}+/gu) ?? [];
  const nie = after.indexOf("nie");
  if (nie < 0) return false;
  const target = after.slice(nie + 1).find((word) => !CORRECTION_SKIP.test(word));
  // "zapłacić … i nie zapomnieć oddać" is a new reminder: corrections fix values, not verbs.
  return target !== undefined && target.length >= 3 && !/ć$/u.test(target) && tail.includes(target.slice(0, 3));
};

const deterministicEnds = (content: string): number[] | null => {
  if (!needsSourceUnitPlan(content)) return null;
  const words = [...content.matchAll(/\S+/gu)];
  const raw = words.map((word) => word[0].replace(/[,;:]+$/u, ""));
  const norm = raw.map((word) => word.toLowerCase());
  const wordEnd = (index: number): number => words[index].index + words[index][0].length;
  const startsWith = (index: number, phrase: readonly string[]): boolean =>
    phrase.every((part, offset) => norm[index + offset] === part);
  const cuts: number[] = [];
  let segment = 0;
  const english = isEnglish(norm);
  for (let index = 1; index < words.length; index += 1) {
    const length = index - segment;
    const score = boundaryScore(index, raw, norm, startsWith, english);
    // Short units need a strong cue; a long run accepts a weaker one.
    const wanted = (score >= 4 && length >= 3) || (score >= 3 && length >= 5) || (score >= 2 && length >= 9) ||
      (score >= 1 && length >= 15) || (score > 0 && length >= 22) || length >= MAX_UNIT_WORDS;
    if (!wanted || DANGLING_END.test(norm[index - 1]) || (english && EN_DANGLING.has(norm[index - 1]))) continue;
    // A forced cut waits a few words rather than separating an infinitive or pronoun from what follows.
    if (score === 0 && length < MAX_UNIT_WORDS + 8 && !english && (/\p{L}{2,}ć$/u.test(norm[index - 1]) || OBJECT_PRONOUN.has(norm[index - 1]))) continue;
    const left = content.slice(words[segment].index, wordEnd(index - 1));
    const right = content.slice(words[index].index, wordEnd(Math.min(words.length - 1, index + 3)));
    if (unsafeBoundary(left, right) || correctsLeft(left, content.slice(words[index].index, wordEnd(Math.min(words.length - 1, index + 7))))) continue;
    cuts.push(index);
    segment = index;
  }
  if (cuts.length && words.length - cuts[cuts.length - 1] < 3) cuts.pop();
  const ends = cuts.map((cut) => wordEnd(cut - 1));
  ends.push(content.length);
  // Recheck whole units like projectSourceUnitPlan; drop any cut that fails.
  while (ends.length > 1) {
    const units = rawUnits(content, ends);
    const unsafe = units.findIndex((unit, index) => index < units.length - 1 &&
      (correctionCue(unit.text) || unsafeBoundary(unit.text, units[index + 1].text)));
    if (unsafe < 0) break;
    ends.splice(unsafe, 1);
  }
  return ends.length >= 2 ? ends : null;
};

export const validateSourceUnitPlan = (
  content: string, value: unknown,
): SourceUnitPlan => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid source unit plan");
  const plan = value as Partial<SourceUnitPlan>;
  if (Object.keys(value).some((key) => !["version", "source", "identity", "ends"].includes(key)) ||
      plan.version !== 1 || plan.source !== content || !Array.isArray(plan.ends) ||
      plan.ends.length < 2 || plan.ends.length > 2048 || plan.ends.at(-1) !== content.length ||
      !plan.ends.every((end, index) => Number.isInteger(end) && end > (index ? plan.ends![index - 1] : 0) &&
        end <= content.length && (end === content.length || /\s/u.test(content[end]))) ||
      plan.identity !== identity(content, plan.ends) ||
      (ambiguousParent(content) && JSON.stringify(deterministicEnds(content)) !== JSON.stringify(plan.ends)))
    throw new Error("Source unit plan identity does not match its source");
  const units = rawUnits(content, plan.ends);
  if (units.some((unit) => !unit.text || correctionCue(unit.text)) || units.some((unit, index) => index < units.length - 1 && unsafeBoundary(unit.text, units[index + 1].text)))
    throw new Error("Source unit plan cuts a protected scope");
  return Object.freeze({ version: 1, source: content, identity: plan.identity,
    ends: Object.freeze([...plan.ends]) });
};

export const projectSourceUnitPlan = (
  content: string, proposal: string,
): SourceUnitPlan | null => {
  if (ambiguousParent(content)) return null;
  const original = [...content.matchAll(/\S+/gu)];
  const proposed = [...proposal.matchAll(/\S+/gu)];
  if (!original.length || original.length !== proposed.length) return null;
  const ends: number[] = [];
  for (let index = 0; index < original.length; index += 1) {
    const sourceWord = original[index][0].toLowerCase();
    const proposedWord = proposed[index][0].toLowerCase();
    if (!proposedWord.startsWith(sourceWord)) return null;
    const added = proposedWord.slice(sourceWord.length);
    // Preserve every original punctuation character. Only appended boundary
    // punctuation and case changes may affect this alignment, never its quotes.
    if (!/^[.,!?;:]*$/u.test(added)) return null;
    if (/[.!?]/u.test(added)) ends.push(index === original.length - 1 ? content.length : original[index].index + original[index][0].length);
  }
  if (ends.at(-1) !== content.length) ends.push(content.length);
  const merged = [...ends];
  // A model-proposed cut can be dropped to retain more original context. Never
  // invent a replacement cut or soften validation of externally supplied plans.
  // Recheck the changed neighbours: one repair can expose another orphan head.
  while (merged.length > 1) {
    const units = rawUnits(content, merged);
    const unsafe = units.findIndex((unit, index) => index < units.length - 1 &&
      (correctionCue(unit.text) || unsafeBoundary(unit.text, units[index + 1].text)));
    if (unsafe < 0) break;
    merged.splice(unsafe, 1);
  }
  if (merged.at(-1) !== content.length) return null;
  try {
    return validateSourceUnitPlan(content, { version: 1, source: content,
      identity: identity(content, merged), ends: merged });
  } catch {
    return null;
  }
};

export const deterministicSourceUnitPlan = (content: string): SourceUnitPlan | null => {
  const ends = deterministicEnds(content);
  if (!ends) return null;
  try {
    return validateSourceUnitPlan(content, { version: 1, source: content, identity: identity(content, ends), ends });
  } catch {
    return null;
  }
};

export const sourceUnitsFromPlan = (
  content: string, plan: SourceUnitPlan,
): OriginalSourceUnit[] => rawUnits(content, validateSourceUnitPlan(content, plan).ends);

export const sourceUnitsForRange = (
  text: string, start: number, plan: SourceUnitPlan,
): OriginalSourceUnit[] => {
  const all = sourceUnitsFromPlan(plan.source, plan);
  if (plan.source.slice(start, start + text.length) !== text)
    throw new Error("Source unit range has no original source identity");
  const intersecting = all.filter((unit) => unit.start < start + text.length && unit.end > start);
  if (intersecting.some((unit) => unit.start < start || unit.end > start + text.length))
    throw new Error("Source unit range cuts a planned statement");
  return intersecting.map((unit) => ({ start: unit.start - start, end: unit.end - start, text: unit.text }));
};

export const needsSourceUnitPlan = (content: string): boolean =>
  content.trim().split(/\s+/u).length >= 30 &&
  !/[.!?]+(?=\s|$)|\n\s*\n/u.test(content);
