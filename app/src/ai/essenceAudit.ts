import type { FinalTaskEvidence } from './processingContext';
import {
  hasExplicitDate, importantSelectedFact, isExplicitChange, replacedScalar,
  scalarFact, selectedPolishScalarCorrection,
} from './summarySelection';
import type { SummarySourceUnit } from './summarySources';

export type EssenceCategory = 'decision' | 'task' | 'amount-date' | 'correction' | 'availability';

interface Span { readonly start: number; readonly end: number }

const overlaps = (left: Span, right: Span): boolean => left.start < right.end && right.start < left.end;

// Closed decision cues from the established essence rubric. Inflections are not
// expanded here; a missed cue only weakens the soft audit, never the gate.
const decisionCue = /(?:^|[^\p{L}])(?:ustaliliśmy|ustalono|umówiliśmy\s+się|uzgodniliśmy|postanowiliśmy|decyzja|najważniejsze\s+jest)(?!\p{L})/iu;

const negationToken = /(?:^|[^\p{L}])(?:nie|nigdy|not|never)(?!\p{L})/iu;

// At least three tokens of three or more letters or digits besides the negation
// itself; short fragments such as "not yet" cannot reserve an essence slot.
const contentWords = (text: string): number =>
  (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => word.length >= 3 && !/^(?:nie|nigdy|not|never)$/u.test(word)).length;

// Deterministic category priority; the first matching signal wins so the same
// unit always maps to the same category. A superseded unit is a correction
// even though its span also overlaps task proof, and explicit task proof
// outranks the lexical decision cue.
const categoryFor = (unit: SummarySourceUnit, taskProof?: FinalTaskEvidence): EssenceCategory | null => {
  if (taskProof?.superseded.some(pair => overlaps(unit, pair.earlier) || overlaps(unit, pair.later))) return 'correction';
  if (taskProof && (taskProof.evidence.some(entry => entry.kind === 'active' && overlaps(unit, entry)) ||
    taskProof.reviewSpans?.some(span => overlaps(unit, span)))) return 'task';
  if (decisionCue.test(unit.text)) return 'decision';
  if (hasExplicitDate(unit.text) || scalarFact(unit.text) !== null || replacedScalar(unit.text) !== null ||
    selectedPolishScalarCorrection(unit.text) || importantSelectedFact(unit)) return 'amount-date';
  if (isExplicitChange(unit.text)) return 'correction';
  if (negationToken.test(unit.text) && contentWords(unit.text) >= 3) return 'availability';
  return null;
};

// Soft essence audit (P1-2 / P0-4b of PLAN-POPRAWY-v40-2026-10-11): the map
// marks units whose loss would drop a decision, task, amount/date, correction or
// availability fact. It never rejects a summary on its own; groundedSummary uses
// it to complete or repair gaps deterministically. Pure and synchronous.
export const essenceUnitIds = (
  units: readonly SummarySourceUnit[], taskProof?: FinalTaskEvidence,
): ReadonlyMap<number, EssenceCategory> => {
  const result = new Map<number, EssenceCategory>();
  for (const unit of units) {
    const category = categoryFor(unit, taskProof);
    if (category !== null) result.set(unit.id, category);
  }
  return result;
};
