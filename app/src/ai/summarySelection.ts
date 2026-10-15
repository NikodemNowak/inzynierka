import { hasUnsupportedRequiredTaskContext, sourceUnitsFromPlan, type OriginalSourceUnit, type SourceUnitPlan } from "./sourceUnits";
import { sourceSpecifics } from "./noteOutput";
import type { FinalTaskEvidence, SourceReviewSpan } from "./processingContext";
import { isCompletedActionReview, type SourceEvidence } from "./sourcePipeline";

interface SourceSentence {
  start: number;
  end: number;
  text: string;
}

const sourceSentences = (content: string, plan?: SourceUnitPlan): SourceSentence[] => {
  if (plan) return sourceUnitsFromPlan(content, plan);
  const result: SourceSentence[] = [];
  let start = 0;
  const append = (end: number): void => {
    const raw = content.slice(start, end);
    const text = raw.trim();
    if (text) {
      const offset = raw.indexOf(text);
      result.push({
        start: start + offset,
        end: start + offset + text.length,
        text,
      });
    }
    start = end;
  };
  for (const boundary of content.matchAll(/[.!?]+(?=\s|$)|\n\s*\n/gu))
    append(boundary.index + boundary[0].length);
  if (start < content.length) append(content.length);
  return result;
};

// A reduced fact can be a fragment of a sentence. Restore the original sentence
// before selection so its owner, negation and deadline cannot be trimmed away.
const summarySentences = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): SourceSentence[] => {
  const all = sourceSentences(content, plan);
  if (source === content) return all;
  const chosen = new Set<SourceSentence>();
  let cursor = 0;
  while (cursor < source.length) {
    const evidence = source.slice(cursor).match(/^\[([^\]]+)\] \(([^)]*)\) /u);
    if (!evidence) throw new Error("Summary evidence has no source identity");
    const identity = evidence[2].match(/(?:^|; )source (\d+):(\d+)(?:;|$)/u);
    const quoteStart = cursor + evidence[0].length;
    let quote: string;
    let offset: number;
    if (identity) {
      offset = Number(identity[1]);
      const end = Number(identity[2]);
      quote = content.slice(offset, end);
      if (
        offset < 0 ||
        end <= offset ||
        end > content.length ||
        source.slice(quoteStart, quoteStart + quote.length) !== quote
      )
        throw new Error(
          "Summary evidence offsets do not match its source quote",
        );
    } else {
      // Legacy records can only identify one unambiguous single-line quote.
      // Current records use exact UTF-16 lengths, including any source newlines.
      const nextLine = source.indexOf("\n", quoteStart);
      quote = source.slice(
        quoteStart,
        nextLine >= 0 ? nextLine : source.length,
      );
      offset = content.indexOf(quote);
      if (!quote || offset < 0 || content.indexOf(quote, offset + 1) >= 0)
        throw new Error(
          "Summary evidence has no unambiguous exact source quote",
        );
    }
    for (const sentence of all)
      if (sentence.start < offset + quote.length && sentence.end > offset)
        chosen.add(sentence);
    cursor = quoteStart + quote.length;
    if (cursor < source.length) {
      if (source[cursor] !== "\n")
        throw new Error("Summary evidence has an invalid record boundary");
      cursor += 1;
    }
  }
  return all.filter((sentence) => chosen.has(sentence));
};

export const summarySourceSpans = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): readonly OriginalSourceUnit[] => summarySentences(source, content, plan);

export const renderSummarySource = (source: string, content: string, plan?: SourceUnitPlan): string =>
  summarySentences(source, content, plan)
    .map((sentence, index) => `[${index + 1}] ${sentence.text}`)
    .join("\n");

const wordCount = (text: string): number =>
  text.trim().split(/\s+/u).filter(Boolean).length;

export const summarySelectionMinimum = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): number => {
  const sentences = summarySentences(source, content, plan).length;
  const words = wordCount(content);
  return sentences >= 8 && words >= 90
    ? 4
    : sentences >= 6 && words >= 70
      ? 3
      : 2;
};

export const summarySelectionMaximum = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): number =>
  Math.min(
    summarySentences(source, content, plan).length >= 10 ? 7 : 4,
    Math.max(2, Math.floor(summarySentences(source, content, plan).length *
      (summarySentences(source, content, plan).length >= 10 ? 0.7 : 0.6))),
  );

export const summarySelectionSchema = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): Readonly<Record<string, unknown>> => ({
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "integer",
        minimum: 1,
        maximum: summarySentences(source, content, plan).length,
      },
      minItems: summarySelectionMinimum(source, content, plan),
      maxItems: summarySelectionMaximum(source, content, plan),
      uniqueItems: true,
    },
  },
  required: ["sentences"],
  additionalProperties: false,
});

export const canSelectSourceSummary = (
  source: string,
  content: string,
  plan?: SourceUnitPlan,
): boolean => {
  const candidates = summarySentences(source, content, plan);
  const minimum = summarySelectionMinimum(source, content, plan);
  if (candidates.length < minimum) return false;
  const smallest = candidates
    .map((sentence) => wordCount(sentence.text))
    .sort((left, right) => left - right)
    .slice(0, minimum);
  return (
    smallest.reduce((total, words) => total + words, 0) /
      Math.max(1, wordCount(content)) <
    0.8
  );
};

const contentWords = (text: string): Set<string> => {
  const ignored = new Set([
    "the",
    "and",
    "for",
    "not",
    "our",
    "are",
    "was",
    "were",
    "into",
    "also",
    "about",
    "all",
    "only",
    "can",
    "could",
    "should",
    "would",
    "they",
    "their",
    "this",
    "that",
    "with",
    "will",
    "must",
    "have",
    "been",
    "from",
    "before",
    "after",
    "later",
    "then",
    "instead",
    "final",
    "earlier",
    "previous",
    "czy",
    "ale",
    "nie",
    "się",
    "tak",
    "tym",
    "tej",
    "ten",
    "jest",
    "będzie",
    "oraz",
    "więc",
    "jego",
    "moja",
    "nasz",
    "nasze",
    "jeszcze",
    "żeby",
    "aby",
    "została",
    "został",
    "zostały",
    "przed",
    "potem",
    "wcześniejszy",
    "wcześniej",
    "końcowa",
    "wynosi",
    "należy",
    "trzeba",
    "jednak",
    "euros",
    "euro",
    "pounds",
    "dollars",
    "zloty",
    "złotych",
    "złote",
  ]);
  return new Set(
    (text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [])
      .filter((word) => word.length >= 3 && !ignored.has(word)),
  );
};

// These cues only identify explicit lexical changes. They are not an entailment
// test: indirect changes, pronouns and meaning expressed with other vocabulary
// can still be missed. Preserve the entire later statement, never rewrite it.
export const isExplicitChange = (text: string): boolean =>
  /(?:zastępu|zastapi|zastąpi|anulowan|odwołan|odwol|zamiast|korygu|korekt|zmian|\bjednak\b|\bostateczn|\bkońcow|\bfinal\b|replac|cancel|correct|\binstead\b|\bactually\b)/iu.test(
    text,
  );

// Only a literal repeated clause is reconciled here, including the same subject.
// "Alice will send ..." -> "Alice will not send ..." is bounded and observable;
// pronouns, inflection changes and indirect cancellations remain model choices.
export const negatesLiteralClause = (later: string, earlier: string): boolean => {
  const words = (text: string): string[] =>
    text.toLocaleLowerCase().match(/\p{L}+|\d+/gu) ?? [];
  const laterWords = words(later);
  if (!laterWords.some((word) => /^(?:not|never|nie|nigdy)$/u.test(word)))
    return false;
  const clause = laterWords.filter(
    (word) => !/^(?:not|never|nie|nigdy)$/u.test(word),
  );
  const original = words(earlier);
  // A three-word minimum avoids reconciling generic fragments such as "not yet".
  return (
    clause.length >= 3 &&
    clause.length <= original.length &&
    clause.every((word, index) => word === original[index])
  );
};

const hasOnlyDeadlineSuffix = (later: string, earlier: string): boolean => {
  const words = (text: string): string[] =>
    text.toLocaleLowerCase().match(/\p{L}+|\d+/gu) ?? [];
  const clauseLength = words(later).filter(
    (word) => !/^(?:not|never|nie|nigdy)$/u.test(word),
  ).length;
  const suffix = words(earlier).slice(clauseLength);
  // A bare number can be an amount/object. It is not a deadline without an
  // explicit temporal prefix; unsupported suffixes keep the whole source.
  if (suffix.length && !/^(?:by|before|on|at|do|w|o|przed)$/u.test(suffix[0]))
    return false;
  return suffix.every(
    (word) =>
      /^(?:by|before|on|at|do|w|o|przed|na)$/u.test(word) ||
      sourceSpecifics(word).size > 0,
  );
};

interface ScalarFact {
  subject: string[];
  value: string;
  currency: string;
  corrective?: boolean;
}

const lexicalWords = (text: string): string[] =>
  text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const SCALAR_HEADS: ReadonlySet<string> = new Set(["budget", "amount", "cost", "budżet", "kwota", "koszt", "cena"]);

const CURRENCIES: Readonly<Record<string, string>> = {
  dollar: "usd", dollars: "usd", usd: "usd", "$": "usd",
  pound: "gbp", pounds: "gbp", gbp: "gbp", "£": "gbp",
  euro: "eur", euros: "eur", eur: "eur", "€": "eur",
  "zł": "pln", "złoty": "pln", "złote": "pln", "złotych": "pln", pln: "pln",
};

// This is recognition, never a transcript rewrite. Spoken English amounts are
// kept as their literal words; numeric formatting and words are not equated.
const amount = (text: string): { value: string; currency: string } | null => {
  const cleaned = text.toLocaleLowerCase().trim().replace(/[.!?]$/u, "");
  const match = cleaned.match(/^([$€£])?\s*(.*?)\s*(dollars?|usd|pounds?|gbp|euros?|eur|złotych|złote|złoty|zł|pln)?$/u);
  if (!match || !match[2]) return null;
  const value = match[2].trim();
  const numeralWords = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and))*$/u;
  if (!/^\d+(?:[.,]\d+)*$/u.test(value) && !numeralWords.test(value)) return null;
  const prefixCurrency = match[1] ? CURRENCIES[match[1]] : "";
  const suffixCurrency = match[3] ? CURRENCIES[match[3]] : "";
  if (prefixCurrency && suffixCurrency && prefixCurrency !== suffixCurrency) return null;
  return { value, currency: prefixCurrency || suffixCurrency };
};

const scalarSubject = (text: string): string[] => {
  let subject = lexicalWords(text);
  while (/^(?:the|a|an)$/u.test(subject[0] ?? "")) subject = subject.slice(1);
  const modifier = /^(?:original|initial|earlier|previous|final|approved|początkowo|początkowy|pierwotny|wcześniejszy|poprzedni|ostateczny|ostateczna|końcowy|końcowa|zatwierdzony)$/u;
  let prefixLength = 0;
  while (modifier.test(subject[prefixLength] ?? "")) prefixLength += 1;
  // Modifiers belong to the scalar head only in this closed local position.
  // Never erase "original" from "budget for original paintings" or from
  // "original paintings budget": those are different objects, not dates.
  if (prefixLength && SCALAR_HEADS.has(subject[prefixLength])) subject = subject.slice(prefixLength);
  if (subject.length === 2 && SCALAR_HEADS.has(subject[0]) &&
    /^(?:początkowo|początkowy|pierwotny|wcześniejszy|poprzedni|ostateczny|ostateczna|końcowy|końcowa|zatwierdzony)$/u.test(subject[1])) subject = subject.slice(0, 1);
  return subject;
};

const finalScalarSubject = (text: string): boolean => {
  let terms = lexicalWords(text);
  while (/^(?:the|a|an)$/u.test(terms[0] ?? "")) terms = terms.slice(1);
  const finalModifier = /^(?:final|approved|ostateczny|ostateczna|końcowy|końcowa|zatwierdzony)$/u;
  let prefixLength = 0;
  while (finalModifier.test(terms[prefixLength] ?? "")) prefixLength += 1;
  const finalCue = /^(?:final|ostateczny|ostateczna|końcowy|końcowa)$/u;
  return (prefixLength > 0 && SCALAR_HEADS.has(terms[prefixLength]) && terms.slice(0, prefixLength).some((term) => finalCue.test(term))) ||
    (terms.length === 2 && SCALAR_HEADS.has(terms[0]) && finalCue.test(terms[1]));
};

export const scalarFact = (text: string): ScalarFact | null => {
  if (text.trim().endsWith("?")) return null;
  const correction = /^(?:correction|korekta)\s*[:,]/iu.test(text.trim());
  // ASR can omit punctuation after the spoken correction cue. Recognize that
  // cue only before a closed present scalar clause, never as a subject noun.
  const bareCorrection = text.trim().match(/^(?:correction|korekta)\s+((?:the|a|an)\s+.+)$/iu);
  const statement = bareCorrection?.[1] ?? text.trim().replace(/^(?:correction|korekta)\s*[:,]\s*/iu, "");
  const match = statement
    .match(/^([^,;.!?]+?)\s+(?:is|was|equals|wynosi|wynosił|wynosiła|wynosiło)\s+(.+?)\s*[.!?]?$/iu);
  if (!match) return null;
  const subject = scalarSubject(match[1]);
  if (!subject.length || subject.some((word) => /^(?:and|or|will|must|i|oraz|lub|że|która|który)$/u.test(word))) return null;
  const parsedAmount = amount(match[2]);
  if (bareCorrection && (!/\s+(?:is|equals|wynosi)\s+/iu.test(statement) ||
    /\b(?:last\s+year|according\s+to)\b/iu.test(match[1]) ||
    /["“”„‘’'«»]/u.test(text) || subject.filter((word) => SCALAR_HEADS.has(word)).length !== 1 ||
    subject.some((word) => /\d/u.test(word) || /^(?:if|unless|whether|when|would|assuming|said|says|told|reported|asked|proposed|hypothetical|possible|potential|provisional|tentative|estimated|draft|historical|previous|earlier|original|past|former|old|not|never|no)$/u.test(word)))) return null;
  return parsedAmount ? { subject, ...parsedAmount, corrective: correction || !!bareCorrection || finalScalarSubject(match[1]) } : null;
};

const sameWords = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((word, index) => word === right[index]);

const includesWords = (full: readonly string[], part: readonly string[]): boolean =>
  part.length > 0 && full.some((_, start) => sameWords(full.slice(start, start + part.length), part));

export const replacedScalar = (text: string): ScalarFact | null => {
  if (text.trim().endsWith("?")) return null;
  const match = text.match(/^(.*?)\s+(?:replaces|zastępuje)\s+(?:the\s+)?(?:earlier\s+|previous\s+|original\s+|wcześniejszy\s+|poprzedni\s+)?(.+?)\s*[.!]?$/iu);
  if (!match) return null;
  const prefix = match[1].trim().replace(/\s+(?:and|i|oraz)$/iu, "");
  const prefixSubject = scalarSubject(prefix);
  // An affirmative closed amount statement or bare scalar noun is required.
  // Intentions, questions, directives and negated replacement claims do not
  // establish a replacement, even when they quote the old value exactly.
  if (!scalarFact(prefix) && !(prefixSubject.length === 1 && SCALAR_HEADS.has(prefixSubject[0]))) return null;
  const reference = match[2];
  const tokens = reference.trim().split(/\s+/u);
  for (let index = 1; index < tokens.length; index += 1) {
    const parsedAmount = amount(tokens.slice(index).join(" ").replace(/^of\s+/u, ""));
    if (parsedAmount) return { subject: scalarSubject(tokens.slice(0, index).join(" ")), ...parsedAmount };
  }
  return null;
};

// Ambiguity considers every earlier statement, including compound sentences
// that are never deletion targets. Coarse number formatting is used only to
// block deletion; it cannot prove equivalence or rewrite the user's transcript.
const mentionsScalar = (text: string, reference: ScalarFact, sameValue: boolean): boolean => {
  const terms = lexicalWords(text);
  if (!includesWords(terms, reference.subject)) return false;
  if (reference.currency && !terms.some((term) => CURRENCIES[term] === reference.currency) &&
    ![...text].some((character) => CURRENCIES[character] === reference.currency)) return false;
  const numbers = text.match(/\d+(?:[.,]\d+)*/gu) ?? [];
  if (!sameValue) return numbers.length > 0 || terms.some((term) => term !== "and" && amount(term) !== null);
  if (/^\d/u.test(reference.value)) return numbers.some((number) => number.replace(/[.,]/gu, "") === reference.value.replace(/[.,]/gu, ""));
  return includesWords(terms.filter((term) => term !== "and"), lexicalWords(reference.value).filter((term) => term !== "and"));
};

// Delete only a whole, closed scalar fact. A citation of its old subject/value
// must identify exactly one earlier source fact; shared prefixes, pronouns and
// ambiguous independent budgets do not establish that identity. A compound
// sentence containing another person's action never parses as a scalar fact.
const supersedesScalar = (
  later: SourceSentence,
  earlier: SourceSentence,
  all: readonly SourceSentence[],
): boolean => {
  const previous = scalarFact(earlier.text);
  if (!previous) return false;
  const current = scalarFact(later.text);
  const explicitReference = replacedScalar(later.text);
  const priorFacts = all.filter((sentence) => sentence.start < later.start)
    .map((sentence) => ({ sentence, fact: scalarFact(sentence.text) }))
    .filter((entry): entry is { sentence: SourceSentence; fact: ScalarFact } => entry.fact !== null);
  if (explicitReference) {
    const matches = priorFacts.filter(({ fact }) =>
      fact.value === explicitReference.value && fact.currency === explicitReference.currency &&
      includesWords(fact.subject, explicitReference.subject),
    );
    const mentions = all.filter((sentence) => sentence.start < later.start && mentionsScalar(sentence.text, explicitReference, true));
    return matches.length === 1 && matches[0].sentence.start === earlier.start && mentions.length === 1;
  }
  if (!current?.corrective || current.currency !== previous.currency || !sameWords(current.subject, previous.subject)) return false;
  const mentions = all.filter((sentence) => sentence.start < later.start && mentionsScalar(sentence.text, current, false));
  return priorFacts.filter(({ fact }) => sameWords(fact.subject, current.subject)).length === 1 && mentions.length === 1;
};

const pureScalarReference = (text: string): ScalarFact | null => {
  if (text.trim().endsWith("?")) return null;
  const reference = text.trim().match(/^this\s+final\s+amount\s+replaces\s+the\s+(?:earlier|previous|original)\s+(budget|amount|cost)\s+(?:of\s+)?(.+?)\s*[.!]?$/iu);
  if (!reference) return null;
  const previous = amount(reference[2]);
  return previous ? { subject: [reference[1].toLocaleLowerCase()], ...previous } : null;
};

// Missing ASR punctuation can join this closed amount reference to a second
// clause. Recognize only an explicit clause boundary; preserve its whole quote.
const leadingScalarReference = (text: string): ScalarFact | null => {
  if (text.trim().endsWith("?") || /["“”„‘’'«»]/u.test(text)) return null;
  const boundaries = [...text.matchAll(/\s+(?=(?:the|a|an)\s+(?:[\p{L}-]+\s+){1,6}(?:is|was|were|will|must|has|had)\b)/giu)];
  const references = boundaries.flatMap((boundary) => {
    const reference = pureScalarReference(text.slice(0, boundary.index));
    return reference ? [reference] : [];
  });
  return references.length === 1 ? references[0] : null;
};

// A selected closed correction already states its current value. An adjacent
// pure pronoun reference to the old amount need not consume a second slot.
// This only controls automatic context attachment, never scalar deletion or
// removal of an explicitly selected source sentence.
const redundantScalarReference = (
  later: SourceSentence, earlier: SourceSentence, all: readonly SourceSentence[],
  reference: ScalarFact | null = pureScalarReference(later.text),
): boolean => {
  const current = scalarFact(earlier.text);
  if (!current?.corrective || all.findIndex((sentence) => sentence.start === later.start) !==
    all.findIndex((sentence) => sentence.start === earlier.start) + 1) return false;
  if (!reference) return false;
  const heads = current.subject.filter((word) => SCALAR_HEADS.has(word));
  return heads.length === 1 && heads[0] === reference.subject[0] &&
    reference.currency === current.currency && reference.value !== current.value;
};

// Resolve only a model-selected literal dependency, never discover arbitrary
// amounts. The preceding current quote and the one older referenced scalar
// must both be source-proven; compound mentions block ambiguous identity.
// This does not change the guards that delete an earlier selected old fact.
const closeScalarReferences = (selected: readonly SourceSentence[], content: string, plan?: SourceUnitPlan): SourceSentence[] => {
  const all = sourceSentences(content, plan);
  const closed = new Map<number, SourceSentence>();
  for (const sentence of selected) {
    const pureReference = pureScalarReference(sentence.text);
    const reference = pureReference ?? leadingScalarReference(sentence.text);
    const index = all.findIndex((candidate) => candidate.start === sentence.start);
    const current = index > 0 ? all[index - 1] : undefined;
    const fact = current ? scalarFact(current.text) : null;
    let resolved = false;
    if (reference && current && fact && redundantScalarReference(sentence, current, all, reference) &&
      /\s+(?:is|equals|wynosi)\s+/iu.test(current.text) &&
      !/["“”„‘’'«»]/u.test(current.text) &&
      !fact.subject.some((word) => /\d/u.test(word) || /^(?:if|unless|whether|when|would|assuming|said|says|told|reported|asked|proposed|hypothetical|possible|potential|provisional|tentative|estimated|draft|historical|previous|earlier|original|past|former|old|not|never|no)$/u.test(word))) {
      const older = all.filter((candidate) => candidate.start < current.start);
      const matching = older.filter((candidate) => {
        const previous = scalarFact(candidate.text);
        return previous?.value === reference.value && previous.currency === reference.currency && includesWords(previous.subject, reference.subject);
      });
      resolved = matching.length === 1 && older.filter((candidate) => mentionsScalar(candidate.text, reference, true)).length === 1;
    }
    const canonical = resolved && current ? current : sentence;
    closed.set(canonical.start, canonical);
    // A joined sentence contains independent facts, so attaching the current
    // amount cannot replace its studio/action clause with an amount-only quote.
    if (resolved && !pureReference) closed.set(sentence.start, sentence);
  }
  return [...closed.values()];
};

const retainExplicitChanges = (
  selected: readonly SourceSentence[],
  content: string,
  explicitlySelected: readonly SourceSentence[] = selected,
  plan?: SourceUnitPlan,
): SourceSentence[] => {
  const included = new Set(selected);
  const all = sourceSentences(content, plan);
  for (const candidate of all) {
    const replaced = [...included].filter((sentence) =>
      sentence.start < candidate.start && supersedesScalar(candidate, sentence, all),
    );
    if (replaced.length) {
      replaced.forEach((sentence) => included.delete(sentence));
      if (![...included].some((sentence) => sentence.start === candidate.start)) included.add(candidate);
      continue;
    }
    const negated = [...included].filter(
      (sentence) =>
        sentence.start < candidate.start &&
        negatesLiteralClause(candidate.text, sentence.text),
    );
    if (negated.length) {
      // The unmatched suffix may contain another actor/action. Keep that entire
      // source sentence unless the suffix consists solely of a literal deadline.
      negated
        .filter((sentence) =>
          hasOnlyDeadlineSuffix(candidate.text, sentence.text),
        )
        .forEach((sentence) => included.delete(sentence));
      if (![...included].some((sentence) => sentence.start === candidate.start))
        included.add(candidate);
      continue;
    }
    if (!isExplicitChange(candidate.text)) continue;
    // A proposed or conditional change is not automatic correction evidence.
    // Keep it when selected by the model, without expanding lexical overlap.
    if (!explicitlySelected.some((sentence) => sentence.start === candidate.start) &&
      /\b(?:if|unless|might|would|hypothetical|proposed)\b/iu.test(candidate.text)) continue;
    // Describing how a correction was interpreted is not a new correction.
    // Preserve explicit model selections and joined current commitments.
    if (!explicitlySelected.some((sentence) => sentence.start === candidate.start) &&
      /^(?:a|the)\s+(?:correction|change|cancellation)\s+(?:was|were|is|are)\s+(?:interpreted|discussed|described|explained|reported|quoted|illustrated)\b/iu.test(candidate.text) &&
      /\b(?:historical|history|background|examples?|archive)\b/iu.test(candidate.text) &&
      !/[:;]|\s[—–]\s/u.test(candidate.text) &&
      !/\b(?:will|must|shall|should|need|needs|final|approved|replac\p{L}*|instead|cancell?ed|changed|moved|delayed|rescheduled|postponed|confirmed)\b/iu.test(candidate.text)) continue;
    const words = contentWords(candidate.text);
    const numbers = new Set(candidate.text.match(/\d+(?:[.,]\d+)*/gu) ?? []);
    if (
      selected.some((sentence) => {
        if (sentence.start >= candidate.start) return false;
        if (!explicitlySelected.some((entry) => entry.start === candidate.start) &&
          redundantScalarReference(candidate, sentence, all)) return false;
        const shared = [...contentWords(sentence.text)].filter((word) =>
          words.has(word),
        ).length;
        const sharedNumber = (
          sentence.text.match(/\d+(?:[.,]\d+)*/gu) ?? []
        ).some((number) => numbers.has(number));
        const bothHaveNumbers = numbers.size > 0 && /\d/u.test(sentence.text);
        return (
          shared >= 2 || (shared >= 1 && (sharedNumber || bothHaveNumbers))
        );
      })
    ) {
      // Offset identity matters because sourceSentences creates fresh objects.
      if (![...included].some((sentence) => sentence.start === candidate.start))
        included.add(candidate);
    }
  }
  return [...included].sort((left, right) => left.start - right.start);
};

export interface SourceSummarySelection {
  summary: string;
  incomplete: boolean;
  omittedImportantFacts?: readonly SourceReviewSpan[];
}

const evidenceSentences = (entry: SourceEvidence, content: string, all: readonly SourceSentence[]): SourceSentence[] => {
  if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 ||
    entry.end <= entry.start || entry.end > content.length || content.slice(entry.start, entry.end) !== entry.quote ||
    !entry.task || !entry.quote.includes(entry.task)) throw new Error("Task priority evidence does not match its source quote");
  const sentences = all.filter((sentence) => sentence.start < entry.end && sentence.end > entry.start);
  if (!sentences.length) throw new Error("Task priority evidence has no source sentence");
  return sentences;
};

const reviewSentences = (entry: SourceReviewSpan, content: string, all: readonly SourceSentence[]): SourceSentence[] => {
  if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 ||
    entry.end <= entry.start || entry.end > content.length || content.slice(entry.start, entry.end) !== entry.quote ||
    typeof entry.reason !== "string" || !entry.reason.trim()) throw new Error("Review evidence does not match its literal source");
  const sentences = all.filter((sentence) => sentence.start < entry.end && entry.start < sentence.end);
  if (!sentences.length) throw new Error("Review evidence has no source sentence");
  return sentences;
};

// This only ranks source sentences the model already selected. Literal dates
// and closed correction statements reserve a slot before optional context;
// it neither discovers new facts nor authorizes any source deletion.
export const hasExplicitDate = (text: string): boolean => {
  if (/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{4})?|\d{1,2}:\d{2})\b/u.test(text)) return true;
  const dated = (phrase: string): boolean => [...sourceSpecifics(phrase)].some((value) => /\p{L}/u.test(value));
  for (const match of text.matchAll(/(?:^|[^\p{L}])(?:on|by|before|until|at|w|we|do|przed|o)\s+((?:(?:next|this)\s+)?[\p{L}\d]+(?:\s+[\p{L}\d]+)?)/giu))
    if (dated(match[1])) return true;
  return [...text.matchAll(/(?:^|[^\p{L}\d])(?:\d{1,2}\s+\p{L}+|\p{L}+\s+\d{1,2})(?![\p{L}\d])/gu)].some((match) => dated(match[0]));
};

// A missing ASR sentence boundary can join a current amount and its explicit
// old-value reference. This only prioritizes an already selected whole quote;
// it does not discover a fact, remove an older amount or rewrite the source.
const joinedSelectedScalarCorrection = (text: string): boolean => {
  if (text.trim().endsWith("?") || /["“”„‘’'«»]/u.test(text)) return false;
  const boundaries = [...text.matchAll(/\s+(?=This\s+final\s+amount\s+replaces\b)/giu)];
  if (boundaries.length !== 1) return false;
  const prefix = text.slice(0, boundaries[0].index);
  const current = scalarFact(prefix);
  const previous = pureScalarReference(text.slice(boundaries[0].index).trim());
  if (!current?.corrective || !previous || !/\s+(?:is|equals|wynosi)\s+/iu.test(prefix) ||
    /\b(?:if|unless|whether|would|assuming|said|says|reported|proposed|hypothetical|possible|potential|provisional|tentative|estimated|historical|previous|earlier|original|past|former|old|not|never|no|last\s+year|according\s+to)\b/iu.test(prefix)) return false;
  const heads = current.subject.filter((word) => SCALAR_HEADS.has(word));
  return heads.length === 1 && heads[0] === previous.subject[0] &&
    current.currency === previous.currency && current.value !== previous.value;
};

// Priority only: a selected closed monetary correction may cite the earlier
// amount without repeating its scalar noun. This never deletes an old source
// sentence or infers a replacement relationship from numerical similarity.
const selectedMonetaryReplacement = (text: string): boolean => {
  if (text.trim().endsWith("?") || /["“”„‘’'«»]/u.test(text)) return false;
  const subject = "(?:(?:the|a|an)\\s+)?(?:(?:final|current|approved)\\s+){0,2}(?:estimate|amount|budget|cost|price|allowance|total|fee)|(?:(?:końcowa|ostateczna|zatwierdzona|aktualna|końcowy|ostateczny|zatwierdzony|aktualny)\\s+){0,2}(?:wycena|kwota|budżet|koszt|cena|stawka|opłata)";
  const statement = new RegExp(`^(?:${subject})\\s+(?:is|equals|wynosi)\\s+(.+?)\\s+(?:and\\s+replaces|i\\s+zastępuje)\\s+(?:(?:the\\s+)?(?:previous|earlier|original|poprzednie|wcześniejsze|pierwotne)\\s+)?(.+?)[.]?$`, "iu").exec(text.trim());
  if (!statement) return false;
  const current = amount(statement[1]);
  const previous = amount(statement[2]);
  return !!current?.currency && !!previous?.currency && current.currency === previous.currency;
};

// Visibility only for one complete, direct current monetary correction. A
// closed final/current subject, present predicate and explicit same-currency
// pair cannot infer an earlier source identity or authorize any deletion. Keep
// its entire original quote; unfamiliar scope or actionable tails stay model
// decisions. This is not task evidence or a transcript rewrite.
const directClosedCurrentMonetaryCorrection = (text: string): boolean => {
  if (hasUnsupportedRequiredTaskContext(text) || /[?"“”„‘’'«»]/u.test(text)) return false;
  const englishSubject = "(?:(?:the|a|an)\\s+)?(?:(?:final|current|approved|production)\\s+){1,3}(?:estimate|amount|budget|cost|price|allowance|total|fee)";
  const polishModifier = "(?:końcow[ay]|ostateczn[ay]|aktualn[ay]|obecn[ay]|zatwierdzon[ay]|produkcyjn[ay])";
  const polishSubject = `(?:${polishModifier}\\s+){0,3}(?:wycena|kwota|budżet|koszt|cena|stawka|opłata)(?:\\s+${polishModifier}){0,3}`;
  const cue = "(?:(?:correction|update|korekta|poprawka)\\s*[:,]?\\s+)?";
  const statement = new RegExp(`^${cue}(${englishSubject}|${polishSubject})\\s+(?:is|equals|wynosi)\\s+(.+?)\\s+(?:instead\\s+of|rather\\s+than|and\\s+replaces|zamiast|i\\s+zastępuje)\\s+(.+?)[.]?$`, "iu").exec(text.trim());
  if (!statement || !/(?:^|\s)(?:final|current|końcow[ay]|ostateczn[ay]|aktualn[ay]|obecn[ay])(?:\s|$)/iu.test(statement[1])) return false;
  const current = amount(statement[2]);
  const previous = amount(statement[3]);
  return !!current?.currency && !!previous?.currency && current.currency === previous.currency && current.value !== previous.value;
};

// Visibility only for an already selected closed current Polish correction.
// The cue never authorizes deletion or a new scalar replacement relationship.
export const selectedPolishScalarCorrection = (text: string): boolean => {
  const statement = text.trim().match(/^poprawka\s*[:,]?\s+(.+)$/iu)?.[1];
  if (!statement || hasUnsupportedRequiredTaskContext(text) ||
      /(?:^|[^\p{L}])(?:nie|nigdy|dawn\p{L}*|wcześniejsz\p{L}*|poprzedn\p{L}*|zeszłoroczn\p{L}*|historyczn\p{L}*)(?!\p{L})/iu.test(statement) ||
      !/\s+wynosi\s+/iu.test(statement)) return false;
  const fact = scalarFact(statement);
  return !!fact && fact.subject.filter((word) => SCALAR_HEADS.has(word)).length === 1;
};

export const importantSelectedFact = (sentence: SourceSentence): boolean =>
  hasExplicitDate(sentence.text) || scalarFact(sentence.text)?.corrective === true || selectedPolishScalarCorrection(sentence.text) || joinedSelectedScalarCorrection(sentence.text) || replacedScalar(sentence.text) !== null || selectedMonetaryReplacement(sentence.text) ||
  /(?:^|[^\p{L}])(?:cancelled|canceled|anulowan\p{L}*|odwołan\p{L}*)(?!\p{L})/iu.test(sentence.text);

interface SourceRestriction {
  sentence: SourceSentence;
  actor?: string;
  action?: string;
}

// This deliberately recognizes a closed set of direct prohibitions, not
// ordinary negative facts or predictions. Keep the whole original sentence,
// including another action in a compound sentence, regardless of task kind.
const directPolicyStatement = (text: string): boolean =>
  !/[?"“”„‘’«»]|(?:^|\s)'|'(?:\s|$)/u.test(text) &&
  !/(?:^|[^\p{L}])(?:if|unless|when|whether|would|provided|assuming|said|says|told|proposed|suggested|asked|discuss\p{L}*|consider\p{L}*|previously|formerly|earlier|historically|used\s+to|(?:previous|former|old|past|historical|prior)\s+(?:policy|rule|restriction|prohibition|ban)|jeśli|jeżeli|gdy|gdyby|chyba\s+że|dawniej|wcześniej|powiedział\p{L}*|zaproponował\p{L}*)(?!\p{L})/iu.test(text);

const policyWords = (text: string): string => text.toLowerCase().replace(/[.!]+$/u, "").trim().replace(/\s+/gu, " ");

// A closed first-person plural purchase/order restriction is a current source
// decision, not a task. Preserve its whole quote without deriving an actor or
// interpreting arbitrary negative facts, historical clauses or reported rules.
const currentPolishPurchaseRestriction = (text: string): boolean => {
  if (!directPolicyStatement(text)) return false;
  const normalized = policyWords(text);
  const word = "[\\p{L}\\p{N}][\\p{L}\\p{N}-]*";
  const current = new RegExp(`^(?:(?:teraz|obecnie)\\s+)?(?:(?:na|dla|do|podczas|w\\s+ramach)\\s+(${word}(?:\\s+${word}){0,3})\\s+)?(?:my\\s+)?nie\\s+(?:kupujemy|zamawiamy|dokupujemy|kupimy|zamówimy|dokupimy|będziemy\\s+(?:kupować|zamawiać|dokupować))\\s+(${word}(?:\\s+${word}){0,9})$`, "u").exec(normalized);
  if (!current) return false;
  // Past context belongs to the adjunct, not to an object's age: declining to
  // purchase old equipment is still a current restriction.
  if (current[1] && /(?:^|[^\p{L}])(?:poprzedn\p{L}*|zeszł\p{L}*|ubiegł\p{L}*|minion\p{L}*|dawn\p{L}*|wcześniejsz\p{L}*|historyczn\p{L}*|archiwaln\p{L}*)(?!\p{L})/u.test(current[1])) return false;
  // Unsupported clause/qualification tails remain the model's decision. The
  // closed object phrase cannot contain another action or scope assertion.
  return !/(?:^|[^\p{L}])(?:nie|i|oraz|ale|lub|bo|ponieważ|że|aby|by|więc|czy|gdy|gdyby|kiedy|dopóki|dopóty|chyba|warunk\p{L}*|ile|może|jakoby|podobno|rzekomo|prawdopodobnie|powiedział\p{L}*|powiedziel\p{L}*|mówi\p{L}*|stwierdzi\p{L}*|napisa\p{L}*|zapropon\p{L}*|suger\p{L}*|rozwa\p{L}*|był\p{L}*|było|była|były)(?!\p{L})/u.test(current[2]);
};

const sourceRestrictions = (all: readonly SourceSentence[]): SourceRestriction[] => {
  const result: SourceRestriction[] = [];
  for (const sentence of all) {
    if (!directPolicyStatement(sentence.text)) continue;
    const text = policyWords(sentence.text);
    const english = /(?:^|;\s*|(?:,\s*)?\b(?:and|but)\s+)(we|i|you|they|he|she)\s+(?:must\s+(?:not|never)|mustn't|(?:am|are|is)\s+not\s+(?:allowed|permitted)\s+to)\s+([\p{L}][\s\S]*)$/u.exec(text);
    // A conjunction alone cannot escape the scope of a historical/reporting
    // prefix. Only a closed affirmative present/future pronoun clause may
    // precede it; a semicolon starts an independent main clause.
    const directClause = english && (english.index === 0 || text[english.index] === ";" ||
      /^(we|i|you|they|he|she)\s+(?:will|must|am|are|is|use|have|keep)\s+\p{L}/u.test(text.slice(0, english.index)));
    if (english && directClause && !/^(?:have|had)\s+\p{L}/u.test(english[2]))
      result.push({ sentence, actor: english[1], action: english[2] });
    else if (/^(?:do\s+not|never)\s+(?!(?:did|had|have|has|was|were|we|i|you|they|he|she)\b)\p{L}/u.test(text) || /^(?:nie\s+wolno|zabrania\s+się)\s+\p{L}/u.test(text))
      result.push({ sentence });
  }
  return result;
};

const restrictionBundles = (all: readonly SourceSentence[]): SourceSentence[][] => {
  const restrictions = sourceRestrictions(all);
  return restrictions.map((restriction) => {
    const lifting = all.filter((sentence, index) => {
      if (sentence.start <= restriction.sentence.start || !directPolicyStatement(sentence.text)) return false;
      const text = policyWords(sentence.text);
      // A later permission may only join the same actor's exact action. This
      // adds literal contrast, never authorizes deleting the original quote.
      const permission = /^(we|i|you|they|he|she)\s+(?:(?:may|can)\s+(?:now\s+)?|(?:am|are|is)\s+(?:now\s+)?(?:allowed|permitted)\s+to\s+)([\p{L}][\s\S]*?)\s*(?:\s+now)?$/u.exec(text);
      if (permission && permission[1] === restriction.actor && policyWords(permission[2]) === restriction.action) return true;
      // A closed demonstrative reference is bounded to the immediately
      // preceding, single prohibition. More distant references remain unproven.
      return all[index - 1]?.start === restriction.sentence.start &&
        restrictions.filter((entry) => entry.sentence.start === restriction.sentence.start).length === 1 &&
        /^(?:that|this)\s+(?:restriction|prohibition|ban)\s+(?:no longer applies|is\s+(?:now\s+)?(?:lifted|removed|cancelled|canceled))(?=[.;]|$)/u.test(text);
    });
    return [restriction.sentence, ...lifting];
  });
};

const CALENDAR_MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const CALENDAR_DAY = "(?:0?[1-9]|[12]\\d|3[01])";
const CALENDAR_DATE = `(?:${CALENDAR_MONTH}\\s+${CALENDAR_DAY}(?:,?\\s+\\d{4})?|${CALENDAR_DAY}\\s+${CALENDAR_MONTH}(?:\\s+\\d{4})?|\\d{4}-(?:0[1-9]|1[0-2])-${CALENDAR_DAY}|${CALENDAR_DAY}[./](?:0?[1-9]|1[0-2])(?:[./]\\d{4})?|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)`;
const CALENDAR_CLOCK = "(?:(?:[01]?\\d|2[0-3]):[0-5]\\d|(?:[1-9]|1[0-2]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\\s*(?:am|pm)|\\s+in\\s+the\\s+(?:morning|afternoon|evening))?)";
const CALENDAR_MODIFIER = "(?:planning|editorial|team|project|weekly|monthly|client|medical|status|follow-up)";
const closedCalendar = (text: string): boolean => {
  const calendar = new RegExp(`^The\\s+(?:(?:next|current)\\s+)?(?:${CALENDAR_MODIFIER}\\s+){0,2}(meeting|review|appointment)\\s+is\\s+on\\s+${CALENDAR_DATE}(?![\\p{L}\\d])(?:\\s+at\\s+${CALENDAR_CLOCK}(?![\\p{L}\\d]))?(.*)$`, "iu").exec(text.trim());
  if (!calendar) return false;
  const tail = calendar[2].trim().replace(/[.!]$/u, "").trim();
  if (!tail) return true;
  // A closed agenda list is common in unpunctuated ASR. The noun-only list
  // cannot contain another action, alternate date, condition or reported fact.
  const agenda = /^the\s+([\p{L}\s,-]+?)\s+(?:is\s+the\s+(?:topic|agenda)|are\s+the\s+topics)\s+for\s+(?:that|the)\s+(meeting|review|appointment)$/iu.exec(tail);
  return !!agenda && agenda[2].toLocaleLowerCase() === calendar[1].toLocaleLowerCase() &&
    !/\b(?:if|unless|whether|might|may|will|must|should|would|could|can|not|never|no|said|says|reported|or|instead|is|are|was|were|be|has|had|pending|subject\s+to|tentative|provisional|potential|possible|unconfirmed|unapproved|conditional|hypothetical|false|untrue|incorrect|invalid|wrong|assum\p{L}*|imagin\p{L}*|propos\p{L}*|suggest\p{L}*|suppos\p{L}*|cancel\p{L}*)\b/iu.test(agenda[1]);
};

// Restore only one direct NEXT/CURRENT schedule, as a whole source fact. A
// second schedule or a later relevant date/time/cancellation reference leaves
// the calendar decision to the model; it never proves a new task or deletion.
const singletonNextCalendar = (all: readonly SourceSentence[]): SourceSentence[] => {
  const schedules = all.filter((sentence) => closedCalendar(sentence.text));
  if (schedules.length !== 1 || !/^The\s+(?:next|current)\s+/iu.test(schedules[0].text)) return [];
  const current = schedules[0];
  // An unknown modifier cannot be promoted to a calendar fact, but another
  // direct dated calendar still makes the source ambiguous in either order.
  const directCalendar = new RegExp(`^The\\s+(?:next\\s+)?(?:[\\p{L}-]+\\s+){0,2}(?:meeting|review|appointment)\\s+is\\s+on\\s+${CALENDAR_DATE}(?![\\p{L}\\d])`, "iu");
  if (all.some((sentence) => sentence.start !== current.start && directCalendar.test(sentence.text.trim()))) return [];
  const date = new RegExp(`(?:^|[^\\p{L}\\d])${CALENDAR_DATE}(?![\\p{L}\\d])`, "iu");
  const clock = new RegExp(`\\b(?:at|is|now)\\s+${CALENDAR_CLOCK}(?![\\p{L}\\d])`, "iu");
  const laterChange = all.some((sentence) => {
    if (sentence.start <= current.start) return false;
    const text = sentence.text;
    const calendarNoun = /\b(?:the|that|this|our|next|no)\s+(?:[\p{L}-]+\s+){0,2}(?:meeting|review|appointment)\b/iu.test(text);
    const reference = /^(?:(?:actually|correction|instead)\s*[:,]?\s*)?(?:it\b|(?:that|this|the|its|our)\s+(?:date|time|schedule)\b)/iu.test(text.trim());
    const correction = /^(?:actually|correction|instead)\s*[:,]?\s+/iu.test(text.trim());
    const changed = /\b(?:cancel\p{L}*|reschedul\p{L}*|postpon\p{L}*|mov\p{L}*|chang\p{L}*|correct\p{L}*|called\s+off|incorrect|wrong|invalid|taken\s+place|took\s+place|held|completed|instead|actually|now|not|never|no|won't|isn't|wasn't)\b/iu.test(text);
    return (calendarNoun || reference) && (date.test(text) || clock.test(text) || changed) || correction && date.test(text);
  });
  return laterChange ? [] : [current];
};

export interface SourceSummaryOptions {
  sourceUnitPlan?: SourceUnitPlan;
  preserveLiteralCommitments?: boolean;
}

// Protect a complete source quote containing one terminal named action with
// an explicit deadline. This is summary coverage only: no task classification,
// actor repair, clause extraction or new source relation is inferred. A
// descriptive negation before the terminal clause stays in the whole quote.
const literalDeadlineCommitment = (text: string): boolean => {
  if (/[?"“”„«»]|(?:^|\s)['‘]|['’](?:\s|[.,;!?]|$)/u.test(text) ||
    /(?:^|[^\p{L}])(?:if|unless|whether|when|provided|assuming|would|could|might|may|said|says|told|reported|mentioned|asked|proposed|suggested|example\p{L}*|hypothet\p{L}*|historical\p{L}*|previous\p{L}*|earlier|archived|yesterday|last\s+year|old|according|remember\p{L}*|recalled|recorded|wrote|written|stated|cancel\p{L}*|replaced|reschedul\p{L}*|postpon\p{L}*|fiction\p{L}*|false|untrue|incorrect)(?!\p{L})/iu.test(text))
    return false;
  const owners = [...text.matchAll(/(?:^|\s)(\p{Lu}[\p{L}'’-]*)\s+will\s+/gu)];
  if (owners.length !== 1 || [...text.matchAll(/\bwill\b/giu)].length !== 1)
    return false;
  const owner = owners[0];
  if (/^(?:the|a|an|this|that|no|nobody|nothing|who|which|when|where|why|how|on|by|before|after|during|in|report|meeting|budget|policy|rule|schedule|will)$/iu.test(owner[1]))
    return false;
  const prefix = text.slice(0, owner.index).trim().replace(/[,;:]$/u, "").trim();
  const lastPrefixWord = prefix.match(/(\p{L}+)$/u)?.[1];
  // A capitalized preceding word may be part of a multiword name, while a
  // conjunction may join another owner. Neither has a safe local boundary.
  if (prefix && (!lastPrefixWord || /^\p{Lu}/u.test(lastPrefixWord) ||
    /^(?:and|or|but|nor|with|i|oraz|lub|albo|ale|z|that|which|who)$/iu.test(lastPrefixWord)))
    return false;
  const tail = text.slice(owner.index).trim();
  const action = /^\p{Lu}[\p{L}'’-]*\s+will\s+(?:send|prepare|contact|call|submit|deliver|finish|complete|check|test|review|update|book|arrange|pay)\s+([^.!?]+)[.]?$/u.exec(tail);
  if (!action || /\b(?:not|never|no|none|neither|and|or|but|because|although|while|that|which|who|whose|where)\b/iu.test(action[1]))
    return false;
  const weekday = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
  const month = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
  const date = `(?:(?:(?:next|this)\\s+)?${weekday}|\\d{4}-[01]\\d-[0-3]\\d|[0-3]?\\d[./][01]?\\d(?:[./]\\d{4})?|${month}\\s+(?:[1-9]|[12]\\d|3[01])(?:,?\\s+\\d{4})?)`;
  const clock = "(?:[01]?\\d|2[0-3])(?::[0-5]\\d)?";
  return new RegExp(`\\S\\s+(?:by|before)\\s+${date}(?:\\s+at\\s+${clock})?$`, "iu").test(action[1]);
};

const prioritizeTaskSentences = (
  selected: readonly SourceSentence[], content: string, maximum: number, proof: FinalTaskEvidence,
  options?: SourceSummaryOptions,
): SourceSummarySelection => {
  const all = sourceSentences(content, options?.sourceUnitPlan);
  const required = proof.evidence.flatMap((entry) => evidenceSentences(entry, content, all));
  if (proof.reviewSpans !== undefined && !Array.isArray(proof.reviewSpans)) throw new Error("Review evidence is not a source span list");
  const reviewSpans = proof.reviewSpans ?? [];
  const reviews = reviewSpans.filter((entry) => !isCompletedActionReview(entry))
    .flatMap((entry) => reviewSentences(entry, content, all));
  const completedReviews = reviewSpans.filter(isCompletedActionReview)
    .flatMap((entry) => reviewSentences(entry, content, all));
  const literalCommitments = options?.preserveLiteralCommitments
    ? all.filter((sentence) => literalDeadlineCommitment(sentence.text)) : [];
  for (const { earlier, later } of proof.superseded) {
    evidenceSentences(earlier, content, all);
    evidenceSentences(later, content, all);
    if (later.start <= earlier.start) throw new Error("Task priority change has no later source evidence");
  }
  const overlaps = (entry: SourceEvidence, sentence: SourceSentence): boolean => entry.start < sentence.end && entry.end > sentence.start;
  // Only complete original task sentences removed by strict reconciliation
  // may disappear. A task clause or active action in a compound sentence is
  // insufficient proof to remove that sentence's other source facts.
  const excluded = new Set(all.filter((sentence) =>
    !proof.evidence.some((entry) => overlaps(entry, sentence)) && proof.superseded.some(({ earlier }) =>
      earlier.start === sentence.start && earlier.end === sentence.end && earlier.quote === sentence.text &&
      earlier.task === earlier.quote,
    ),
  ).map((sentence) => sentence.start));
  const terminalCancellations = (sentence: SourceSentence): SourceSentence[] => {
    const result: SourceSentence[] = [];
    for (const pair of proof.superseded) {
      if (!overlaps(pair.earlier, sentence)) continue;
      let terminal = pair.later;
      // Follow only the already validated removal chain. Intermediate active
      // deadlines never become priority evidence again.
      for (let index = 0; index < proof.superseded.length; index += 1) {
        const next = proof.superseded.find((change) => change.earlier.start === terminal.start && change.earlier.end === terminal.end);
        if (!next) break;
        terminal = next.later;
      }
      if (terminal.kind === "cancelled") result.push(...evidenceSentences(terminal, content, all));
    }
    return result;
  };
  const chosen = new Map<number, SourceSentence>();
  const totalWords = Math.max(1, wordCount(content));
  const policies = restrictionBundles(all);
  const currentPurchasePolicies = all.filter((sentence) => currentPolishPurchaseRestriction(sentence.text));
  const calendar = singletonNextCalendar(all);
  const currentMonetaryCorrections = all.filter((sentence) => directClosedCurrentMonetaryCorrection(sentence.text));
  const important = selected.filter(importantSelectedFact);
  const optional = selected.filter((sentence) => !importantSelectedFact(sentence));
  const policyGroup = (sentence: SourceSentence): SourceSentence[] =>
    policies.find((group) => group[0].start === sentence.start) ?? [sentence];
  // Dense notes can contain more protected facts than the model's ordinary
  // selection allows. Give exact obligations and important source facts the
  // established seven-quote ceiling; optional context keeps its old capacity.
  // The word-compression guard still applies to every complete quote bundle.
  const coverageMaximum = Math.max(maximum, Math.min(7, all.length - 1));
  const groups: { sentences: SourceSentence[]; literalReview: boolean; literalTask?: boolean; optional?: boolean }[] = [
    ...required.map((sentence) => ({ sentences: policyGroup(sentence), literalReview: false, literalTask: true })),
    ...reviews.map((sentence) => ({ sentences: [sentence], literalReview: true })),
    ...[...policies, ...important.map(policyGroup), ...calendar.map(policyGroup)]
      .map((sentences) => ({ sentences, literalReview: false })),
    // Closed current monetary quotes reserve existing slots before optional
    // context. They carry only literal visibility, never lexical replacement
    // links to another sentence or permission to remove a selected old amount.
    ...currentMonetaryCorrections.map((sentence) => ({ sentences: [sentence], literalReview: true })),
    ...completedReviews.map((sentence) => ({ sentences: [sentence], literalReview: true, optional: true })),
    ...optional.map((sentence) => ({ sentences: policyGroup(sentence), literalReview: false, optional: true })),
    // Newly discovered visibility cannot exchange an already selected cost,
    // date or current review for this fact. Fit under the existing limits or
    // report the exact missing whole quote when compression prevents coverage.
    ...currentPurchasePolicies.map((sentence) => ({ sentences: [sentence], literalReview: true })),
  ];
  for (const { sentences, literalReview, literalTask, optional } of groups) {
    // Keep each exact-source correction bundle together. If it cannot fit,
    // skip the entire bundle instead of leaving an obsolete selected fact.
    // An unresolved quote proves source visibility, not a relationship to
    // other corrections. Never expand it through lexical overlap or removals.
    // Final task proof already reconciled source changes. A task quote cannot
    // infer another change merely through words shared with later background.
    // Preserve its whole policy bundle and only validated cancellation links;
    // model-selected factual groups keep their existing correction handling.
    const group = (literalReview ? sentences : literalTask
      ? sentences.flatMap((sentence) => [sentence, ...terminalCancellations(sentence)])
      : sentences.flatMap((sentence) => [...retainExplicitChanges([sentence], content, selected, options?.sourceUnitPlan), ...terminalCancellations(sentence)]))
      .filter((candidate) => !excluded.has(candidate.start));
    const proposed = new Map(chosen);
    for (const candidate of group) proposed.set(candidate.start, candidate);
    if (proposed.size > (optional ? maximum : coverageMaximum) || [...proposed.values()].reduce((sum, candidate) => sum + wordCount(candidate.text), 0) / totalWords >= 0.8) continue;
    for (const candidate of group) chosen.set(candidate.start, candidate);
  }
  // Keep the established selection intact before adding bounded source
  // visibility. A new literal quote cannot displace an already chosen budget,
  // policy, calendar fact or task. Its descriptive context is not a proof of
  // lexical correction links; follow only validated task-removal chains.
  const selectedCount = chosen.size;
  let literalCommitmentDropped = false;
  for (const sentence of literalCommitments) {
    const group = [sentence, ...terminalCancellations(sentence)]
      .filter((candidate) => !excluded.has(candidate.start));
    const proposed = new Map(chosen);
    for (const candidate of group) proposed.set(candidate.start, candidate);
    if (proposed.size > selectedCount + 2 ||
      [...proposed.values()].reduce((sum, candidate) => sum + wordCount(candidate.text), 0) / totalWords >= 0.8) {
      literalCommitmentDropped = true;
      continue;
    }
    for (const candidate of group) chosen.set(candidate.start, candidate);
  }
  const summary = [...chosen.values()].sort((left, right) => left.start - right.start).map((sentence) => sentence.text).join(options?.sourceUnitPlan ? "\n" : " ");
  if (!summary) throw new Error("Summary has no source sentences within its compression limit");
  const importantDropped = important.some((sentence) => {
    const retained = retainExplicitChanges([sentence], content, selected, options?.sourceUnitPlan).filter((candidate) => !excluded.has(candidate.start));
    return retained.some((candidate) => !chosen.has(candidate.start));
  });
  const policyDropped = [...policies.flat(), ...currentPurchasePolicies].some((sentence) => !excluded.has(sentence.start) && !chosen.has(sentence.start));
  const calendarDropped = calendar.some((sentence) => !excluded.has(sentence.start) && !chosen.has(sentence.start));
  const monetaryCorrectionDropped = currentMonetaryCorrections.some((sentence) => !excluded.has(sentence.start) && !chosen.has(sentence.start));
  const missingImportant = new Map<number, SourceSentence>();
  for (const sentence of [...important.flatMap((entry) => retainExplicitChanges([entry], content, selected, options?.sourceUnitPlan)), ...policies.flat(), ...currentPurchasePolicies, ...calendar, ...currentMonetaryCorrections])
    if (!excluded.has(sentence.start) && !chosen.has(sentence.start)) missingImportant.set(sentence.start, sentence);
  const omittedImportantFacts = [...missingImportant.values()].sort((left, right) => left.start - right.start)
    .map((sentence) => ({ start: sentence.start, end: sentence.end, quote: sentence.text, reason: "Important source fact exceeds summary capacity" }));
  return { summary, incomplete: proof.warnings.length > 0 || reviewSpans.length > 0 || importantDropped || policyDropped || calendarDropped || monetaryCorrectionDropped || literalCommitmentDropped || required.some((sentence) => !chosen.has(sentence.start)),
    ...(omittedImportantFacts.length ? { omittedImportantFacts } : {}) };
};

export const selectSourceSummaryResult = (
  raw: string,
  source: string,
  content: string,
  proof?: FinalTaskEvidence,
  options?: SourceSummaryOptions,
): SourceSummarySelection => {
  const cleaned = raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, "")
    .trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Summary selection is not an object");
  if (Object.keys(parsed).some((key) => key !== "sentences"))
    throw new Error("Summary selection contains an unexpected field");
  const ids = (parsed as { sentences?: unknown }).sentences;
  const candidates = summarySentences(source, content, options?.sourceUnitPlan);
  if (
    !Array.isArray(ids) ||
    ids.length < summarySelectionMinimum(source, content, options?.sourceUnitPlan) ||
    ids.length > summarySelectionMaximum(source, content, options?.sourceUnitPlan) ||
    new Set(ids).size !== ids.length ||
    !ids.every(
      (id): id is number =>
        typeof id === "number" &&
        Number.isInteger(id) &&
        id >= 1 &&
        id <= candidates.length,
    )
  )
    throw new Error("Summary selection referenced invalid sentences");
  // Validate the complete model result before applying authoritative task
  // evidence; priority must never turn malformed generation into success.
  // Model IDs refer to the prepared candidates. Restored task and correction
  // quotes come from the whole note, whose original capacity still applies.
  const outputMaximum = Math.max(4, summarySelectionMaximum(content, content, options?.sourceUnitPlan));
  const canonical = closeScalarReferences(ids.map((id) => candidates[id - 1]), content, options?.sourceUnitPlan);
  if (proof) return prioritizeTaskSentences(canonical, content,
    outputMaximum, proof, options);
  const selected = retainExplicitChanges(
    canonical,
    content,
    canonical,
    options?.sourceUnitPlan,
  );
  if (selected.length > outputMaximum)
    throw new Error(
      "Summary cannot retain explicit changes within its sentence limit",
    );
  const summary = selected.map((sentence) => sentence.text).join(options?.sourceUnitPlan ? "\n" : " ");
  if (wordCount(summary) / Math.max(1, wordCount(content)) >= 0.8)
    throw new Error(
      "Summary selection did not meaningfully shorten the source",
    );
  return { summary, incomplete: false };
};

export const selectSourceSummary = (
  raw: string, source: string, content: string, proof?: FinalTaskEvidence,
): string => selectSourceSummaryResult(raw, source, content, proof).summary;
