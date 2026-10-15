import { NOTE_CATEGORIES } from "../domain/categories";
import type { Language } from "../i18n/language";

// Everything a small model gets wrong about following instructions is repaired
// here. Kept apart from the code that runs the model so these rules can be
// exercised without loading gigabytes of weights — they are the part that
// changed most often, and the part most worth pinning down with tests.

// Exported for the title-anchor repair, which must keep these openers out of
// the vocabulary it offers to the model.
export const BANNED_PREFIXES = [
  "notatka",
  "nagranie",
  "transkrypt",
  "streszczenie",
  "podsumowanie",
  "tytuł",
  "ten tekst",
  "autor",
];

// Conversational fillers a chatty note opens with; the model tends to parrot
// them ("Dobrze, to taka notatka na szybko...") instead of getting to the point.
const FILLER_OPENER =
  /^(dobrze|dobra|no|ok|okej|okay|tak|więc|wiec|cóż|coz|otóż|otoz|hej|a więc|a wiec)\b[\s,.:;–—-]*/i;
const ENGLISH_FILLER_OPENER = /^(okay|ok|well|hey)\b[\s,.:;–—-]*/i;

// The model sometimes regurgitates its own instructions/system prompt instead
// of answering. Such output is never a valid title/summary.
const INSTRUCTION_MARKERS = [
  "wymagania:",
  "zwróć wyłącznie",
  "zwroc wylacznie",
  "podaj tytuł",
  "podaj tytul",
  "streść poniższą",
  "stresc ponizsza",
  "fraza rzeczownikowa",
  "nie powtarzaj",
  "requirements:",
  "return only",
  "give a title",
  "summarize the following",
  "noun phrase",
  "do not repeat",
];

const looksLikeInstructionEcho = (text: string): boolean => {
  const lower = text.toLowerCase();
  return INSTRUCTION_MARKERS.some((marker) => lower.includes(marker));
};

export const stripModelArtifacts = (
  text: string,
  language: Language = "pl",
): string =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(/^(tytuł|streszczenie|podsumowanie|title|summary)\s*[:\-]\s*/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(language === "pl" ? FILLER_OPENER : ENGLISH_FILLER_OPENER, "")
    .trim();

export const stripBannedOpener = (text: string, language: Language): string => {
  if (language === "en") {
    const next = text
      .replace(
        /^(?:this |the )?(?:note|recording|transcript|summary|title|text|author)\b[\s:,\-–—]*(?:is about|concerns|describes|contains|presents)?[\s:,\-–—]*/i,
        "",
      )
      .trim();
    return next.length > 0 ? next[0].toUpperCase() + next.slice(1) : text;
  }
  const pattern = new RegExp(
    `^(${BANNED_PREFIXES.join("|")})\\b[\\s:,\\-–—]*(dotyczy|opisuje|mówi o|zawiera|przedstawia)?[\\s:,\\-–—]*`,
    "i",
  );
  const next = text.replace(pattern, "").trim();
  return next.length > 0 ? next[0].toUpperCase() + next.slice(1) : text;
};

const firstWords = (text: string, count: number): string =>
  text.split(/\s+/).filter(Boolean).slice(0, count).join(" ");

export const cleanTitle = (raw: string, language: Language = "pl"): string => {
  const stripped = stripModelArtifacts(raw, language);
  if (looksLikeInstructionEcho(stripped)) return "";
  const firstLine =
    stripped
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  // Quotes and trailing punctuation are stripped together: handled separately,
  // `"Tytuł."` loses the period and keeps the quote it was hiding behind.
  const withoutBanned = stripBannedOpener(firstLine, language)
    .replace(/^[\s"'„”»«]+/g, "")
    .replace(/[\s"'„”»«.,;:!?]+$/g, "")
    .trim();
  return firstWords(withoutBanned, 8);
};

// Fallback only when the model returns nothing usable. Prefer the summary (clean,
// topic-first) and strip any conversational opener so we never fall back to the
// note's chatty intro (e.g. "Dobra, to taka notatka na szybko").
export const fallbackTitle = (
  source: string,
  language: Language = "pl",
): string => {
  const firstSentence =
    stripModelArtifacts(source, language).split(/[.!?\n]/)[0] ?? source;
  return firstWords(firstSentence.trim(), 6);
};

export const cleanSummary = (
  raw: string,
  language: Language = "pl",
): string => {
  const stripped = stripModelArtifacts(raw, language);
  if (looksLikeInstructionEcho(stripped)) return "";
  return stripBannedOpener(stripped, language);
};

// Classification, not generation: keep only outputs that exactly match a known
// category (case-insensitive), mapped back to canonical casing. Anything else
// (including "brak") is dropped, so the result is always a subset of the set.
const CATEGORY_BY_LOWER = new Map<string, string>(
  NOTE_CATEGORIES.map((c) => [c.toLowerCase(), c]),
);

export const parseTags = (raw: string): string[] => {
  const cleaned = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const found = cleaned
    .replace(/\n/g, ",")
    .split(",")
    .map((part) =>
      CATEGORY_BY_LOWER.get(
        part
          .trim()
          .toLowerCase()
          .replace(/["'`.#]/g, "")
          .trim(),
      ),
    )
    .filter((category): category is string => category !== undefined);
  return Array.from(new Set(found)).slice(0, 2);
};

// The model returns a loose list; pull out one task per line, drop bullets,
// numbering and any leaked instruction/heading lines. Source validation happens
// in the extraction pipeline; list length cannot prove that a task is spurious.
export const parseTasks = (
  raw: string,
  language: Language = "pl",
): string[] => {
  const cleaned = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  return cleaned
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•\d.)\s]+/, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 1 &&
        !(language === "pl"
          ? /^(?:(?:zasady|notatka|zadania)\s*:?\s*$|wypisz\b|brak (?:zadań|zadan)\b|nie ma (?:zadań|zadan)\b)/i.test(
              line,
            )
          : /^(?:(?:tasks|rules|note|to-do(?: list)?|action items)\s*:?\s*$|list the tasks\b|no (?:tasks|action items)\b)/i.test(
              line,
            )) &&
        !line.includes('"""'),
    );
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const stems = (text: string): string[] =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 4));

// Token-overlap similarity: high value means the summary reuses almost the same
// words as the note (a near-verbatim copy, even if punctuation/diacritics differ).
const jaccard = (a: string, b: string): number => {
  const setA = new Set(stems(a));
  const setB = new Set(stems(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((stem) => {
    if (setB.has(stem)) intersection += 1;
  });
  return intersection / (setA.size + setB.size - intersection);
};

const wordCountOf = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

const DATE_WORDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "tomorrow",
  "today",
  "yesterday",
  "poniedzia",
  "wtorek",
  "wtork",
  "środ",
  "czwart",
  "piąt",
  "sobot",
  "niedziel",
  "stycz",
  "lut",
  "marzec",
  "marca",
  "kwie",
  "kwiet",
  "maj",
  "czerw",
  "lip",
  "sierp",
  "wrze",
  "wrześ",
  "paźdz",
  "listop",
  "grud",
  "jutro",
  "jutra",
  "dzisiaj",
  "dziś",
  "wczoraj",
];

// This guard only checks literal numbers and date words. Semantic consistency
// still needs evaluation; matching vocabulary alone cannot prove it.
export const sourceSpecifics = (text: string): Set<string> => {
  const values = new Set(
    (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((value) =>
      value.replace(",", "."),
    ),
  );
  const words = text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  for (const word of words) {
    const date = DATE_WORDS.find((candidate) => word.startsWith(candidate));
    if (date) values.add(date);
  }
  return values;
};

export const dropsSourceConstraints = (
  quote: string,
  excerpt: string,
): boolean => {
  const included = sourceSpecifics(excerpt);
  if ([...sourceSpecifics(quote)].some((item) => !included.has(item)))
    return true;
  const negations =
    quote
      .toLocaleLowerCase()
      .match(/\b(?:not|never|without|cannot|nie|nigdy|bez)\b/gu) ?? [];
  const excerptWords = new Set(
    excerpt.toLocaleLowerCase().match(/\p{L}+/gu) ?? [],
  );
  return negations.some((word) => !excerptWords.has(word));
};

// A copy is a summary that failed to compress: it reuses almost the same words
// AND stays nearly as long as the note. A faithful but genuinely short summary
// shares vocabulary too, so length is what separates a summary from a copy.
export const isCopy = (summary: string, content: string): boolean => {
  const o = normalize(summary);
  const c = normalize(content);
  if (o.length === 0) return true;
  // Already-dense notes (e.g. a terse meeting recap) can't be compressed much, so
  // a faithful summary stays similar in length and vocabulary. Only flag output
  // that is BOTH almost as long AND almost the same words — a genuine non-summary.
  const lengthRatio = wordCountOf(summary) / Math.max(1, wordCountOf(content));
  if (c.includes(o) && lengthRatio >= 0.85) return true;
  return lengthRatio >= 0.85 && jaccard(summary, content) >= 0.8;
};

// Catches hallucinations: a summary that shares almost no vocabulary with the
// transcript (e.g. a small model copying a few-shot example) is not grounded.
export const hasUnsupportedSpecifics = (
  output: string,
  content: string,
): boolean => {
  const supported = sourceSpecifics(content);
  return [...sourceSpecifics(output)].some((item) => !supported.has(item));
};

export const isUngrounded = (summary: string, content: string): boolean => {
  if (hasUnsupportedSpecifics(summary, content)) return true;
  const summaryStems = stems(summary);
  if (summaryStems.length === 0) return true;
  const contentStems = new Set(stems(content));
  const shared = summaryStems.filter((stem) => contentStems.has(stem)).length;
  return shared / summaryStems.length < 0.3;
};
