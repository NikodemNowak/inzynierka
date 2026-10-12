import { hasUnsupportedRequiredTaskContext } from './sourceUnits';
import type { FinalTaskEvidence } from './processingContext';
import type { SummaryDraft } from './summaryProtocol';
import type { SummarySourceUnit } from './summarySources';

const overlaps = (left: { start: number; end: number }, right: { start: number; end: number }): boolean => left.start < right.end && right.start < left.end;
export const negationWord = /(?:^|[^\p{L}])(?:nie|nigdy|not|never)(?![\p{L}])/iu;

// Spoken numbers reach the draft as digits ("czternastej" -> "14:00"). The 4B
// verifier misses wrong conversions, so every number in a point must occur in
// its cited sources as digits or as a Polish number word.
const numberWords: readonly (readonly [number, RegExp])[] = [
  [11, /^jedenast/u], [12, /^dwunast/u], [13, /^trzynast/u], [14, /^czternast/u], [15, /^piętnast/u], [16, /^szesnast/u],
  [17, /^siedemnast/u], [18, /^osiemnast/u], [19, /^dziewiętnast/u], [20, /^dwudziest/u], [30, /^trzydzie/u], [40, /^czterdzie/u],
  [50, /^pięćdziesi/u], [60, /^sześćdziesi/u], [70, /^siedemdziesi/u], [80, /^osiemdziesi/u], [90, /^dziewięćdziesi/u], [100, /^sto(?:$|[^\p{L}])/u], [200, /^dwie[sś]c/u], [300, /^trzyst/u],
  [400, /^czterysta/u], [500, /^pięćset/u], [600, /^sześćset/u], [700, /^siedemset/u], [800, /^osiemset/u], [900, /^dziewięćset/u], [1000, /^tysi/u],
  [1, /^(?:jeden|jedn|pierwsz)/u], [2, /^(?:dwa|dwie|dwóch|dwu|drug)/u], [3, /^(?:trzy|trzech|trzeci)/u],
  [4, /^(?:cztery|czterech|czwart)/u], [5, /^(?:pięć|pięci|piąt)/u], [6, /^(?:sześć|sześci|szóst)/u],
  [7, /^(?:siedem|siedmi|siódm)/u], [8, /^(?:osiem|ośmi|ósm)/u], [9, /^(?:dziewięć|dziewięci|dziewiąt)/u],
  [10, /^(?:dziesięć|dziesięci|dziesiąt)/u],
];
// Every number a text can express: digits, single number words and, for a run
// of consecutive number words, each prefix sum ("pięćdziesiąt osiem" = 58).
// `totals` keeps only digits and complete runs, i.e. what the text states.
export const spokenNumbers = (text: string): { readonly all: ReadonlySet<number>; readonly totals: ReadonlySet<number> } => {
  const all = new Set<number>();
  const totals = new Set<number>();
  for (const token of text.match(/\d+/gu) ?? []) { const value = Number.parseInt(token, 10); all.add(value); totals.add(value); }
  let sum = 0;
  let last: number | null = null;
  const closeRun = (): void => { if (last !== null) totals.add(last); sum = 0; last = null; };
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const hit = numberWords.find(([, pattern]) => pattern.test(word));
    if (!hit) { closeRun(); continue; }
    all.add(hit[0]);
    sum += hit[0];
    all.add(sum);
    last = sum;
  }
  closeRun();
  return { all, totals };
};
const sourceNumbers = (text: string): ReadonlySet<number> => spokenNumbers(text).all;
export const hasUnsourcedNumber = (point: SummaryDraft['points'][number], units: readonly SummarySourceUnit[]): boolean => {
  const found = new Set<number>();
  for (const id of point.sourceIds) for (const value of sourceNumbers(units.find(unit => unit.id === id)?.text ?? '')) found.add(value);
  return (point.text.match(/\d+/gu) ?? []).some(token => {
    const value = Number.parseInt(token, 10);
    return value !== 0 && !found.has(value);
  });
};

// A source sentence copied as a point starts mid-thought ("i muszę omówić...").
// Drop the leading conjunction and capitalise; the words stay the speaker's own.
export const tidyLiteral = (text: string): string => {
  const trimmed = text.trim();
  const stripped = trimmed.replace(/^(?:i|oraz|a|and)\s+/iu, '');
  const base = stripped.length ? stripped : trimmed;
  return base.charAt(0).toUpperCase() + base.slice(1);
};

// Per-unit guard for literal completion: never resurrect a unit that a task
// correction superseded, a review flagged, or whose task context is unsupported.
// literalRepair keeps its whole-scope refusal for the rejected-points path.
export const guardedEssenceUnit = (unit: SummarySourceUnit, taskProof?: FinalTaskEvidence): boolean =>
  hasUnsupportedRequiredTaskContext(unit.text) ||
  (taskProof?.superseded.some(pair => overlaps(unit, pair.earlier) || overlaps(unit, pair.later)) ?? false) ||
  (taskProof?.reviewSpans?.some(span => overlaps(unit, span)) ?? false);

export type PointIssue = 'number' | 'negation' | 'tense' | 'hedge' | 'words' | 'superseded';

// Content-word stems (first four letters) tolerate Polish inflection and
// nominalization (rozmawiałem/rozmowa); shorter words carry no checkable content.
const stems = (text: string): string[] =>
  (text.toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []).map(word => word.slice(0, 4));

const pastModal = /(?:^|[^\p{L}])(?:musiał(?:em|am|o|y|iśmy|yśmy)?|miał(?:em|am|o|y|iśmy|yśmy)?|powinien|powinna|had\s+to|was\s+supposed)(?![\p{L}])/iu;
const presentModal = /(?:^|[^\p{L}])(?:muszę|musimy|musisz|musi|mam|mamy|masz|trzeba|must|need\s+to|needs\s+to|has\s+to|have\s+to|should|will)(?![\p{L}])/iu;
const hedge = /(?:^|[^\p{L}])(?:jeśli|jeżeli|o\s+ile|może|chyba|prawdopodobnie|if|maybe|might|perhaps|probably)(?![\p{L}])/iu;
const MIN_STEM_OVERLAP = 0.75;

// Deterministic faithfulness checks for one generated point against the exact
// source units it cites. A failing point is replaced by the literal source
// sentences, so these checks may over-reject but must never let a changed
// number, a lost negation, a shifted tense or an invented word pass. They
// cannot see a swapped actor; that stays a documented limitation.
export const checkPoint = (
  point: SummaryDraft['points'][number], units: readonly SummarySourceUnit[], taskProof?: FinalTaskEvidence,
): readonly PointIssue[] => {
  const cited = point.sourceIds.map(id => units.find(unit => unit.id === id));
  if (!cited.length || cited.some(unit => !unit)) return ['words'];
  const sourceText = cited.map(unit => unit!.text).join(' ');
  const issues: PointIssue[] = [];
  if (hasUnsourcedNumber(point, units)) issues.push('number');
  if (negationWord.test(sourceText) !== negationWord.test(point.text)) issues.push('negation');
  if (presentModal.test(point.text) && pastModal.test(sourceText) && !presentModal.test(sourceText)) issues.push('tense');
  if (hedge.test(sourceText) && !hedge.test(point.text)) issues.push('hedge');
  const have = new Set(stems(sourceText));
  const wanted = stems(point.text);
  if (wanted.length && wanted.filter(stem => have.has(stem)).length / wanted.length < MIN_STEM_OVERLAP) issues.push('words');
  // A point must not state the old value of a corrected fact on its own.
  if (taskProof?.superseded.some(pair => cited.every(unit => overlaps(unit!, pair.earlier)) &&
    !cited.some(unit => overlaps(unit!, pair.later)))) issues.push('superseded');
  return issues;
};
