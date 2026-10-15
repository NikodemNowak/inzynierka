import type { SummarySourceRange } from "../domain/summary";
import { summarySourceSpans } from "./summarySelection";
import type { OriginalSourceUnit, SourceUnitPlan } from "./sourceUnits";

export interface SummarySourceUnit extends OriginalSourceUnit {
  readonly id: number;
}

export const createSummarySources = (
  content: string,
  plan?: SourceUnitPlan,
): readonly SummarySourceUnit[] =>
  summarySourceSpans(content, content, plan).map((unit, index) => ({ ...unit, id: index + 1 }));

const splitsSurrogatePair = (content: string, offset: number): boolean => {
  const before = content.charCodeAt(offset - 1);
  const after = content.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
};

// The established resolver also accepts legacy unambiguous quotes. New global
// references require positions so repeated quotations can never select an ID
// by text search. Skip each quote by its UTF-16 length, including source newlines.
const requirePositionalEvidence = (reduced: string, content: string): void => {
  if (reduced === content) return;
  let cursor = 0;
  while (cursor < reduced.length) {
    const header = reduced.slice(cursor).match(/^\[([^\]]+)\] \(([^)]*)\) /u);
    const fields = header?.[2].split("; ");
    const positions = fields?.filter(field => field.startsWith("source "));
    const identity = positions?.length === 1 ? positions[0].match(/^source (\d+):(\d+)$/u) : null;
    if (!header || !identity) throw new Error("Summary evidence requires exact source positions");
    const start = Number(identity[1]);
    const end = Number(identity[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end <= start || end > content.length ||
      splitsSurrogatePair(content, start) || splitsSurrogatePair(content, end)) {
      throw new Error("Summary evidence positions are invalid");
    }
    cursor += header[0].length + end - start;
    if (cursor > reduced.length) throw new Error("Summary evidence quote is truncated");
    if (cursor < reduced.length) {
      if (reduced[cursor] !== "\n") throw new Error("Summary evidence has an invalid record boundary");
      cursor += 1;
    }
  }
};

export const sourcesFromReducedView = (
  reduced: string,
  content: string,
  catalog: readonly SummarySourceUnit[],
  plan?: SourceUnitPlan,
): readonly SummarySourceUnit[] => {
  const expected = createSummarySources(content, plan);
  if (catalog.length !== expected.length || expected.some((unit, index) => {
    const candidate = catalog[index];
    return candidate.id !== unit.id || candidate.start !== unit.start ||
      candidate.end !== unit.end || candidate.text !== unit.text;
  })) throw new Error("Summary source catalog does not match its source or plan");
  requirePositionalEvidence(reduced, content);
  const spans = summarySourceSpans(reduced, content, plan);
  return spans.map(span => {
    const unit = catalog.find(candidate => candidate.start === span.start &&
      candidate.end === span.end && candidate.text === span.text);
    if (!unit) throw new Error("Summary source catalog does not match its source");
    return unit;
  });
};

export const resolveSummarySourceIds = (
  ids: readonly number[],
  catalog: readonly SummarySourceUnit[],
): readonly SummarySourceRange[] | null => {
  if (ids.length === 0 || ids.some(id => !Number.isInteger(id) || id < 1)) return null;
  const chosen = new Set(ids);
  if ([...chosen].some(id => !catalog.some(unit => unit.id === id))) return null;
  return catalog.filter(unit => chosen.has(unit.id))
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
};

export const renderSummarySources = (units: readonly SummarySourceUnit[]): string =>
  units.map(unit => `[${unit.id}] ${unit.text}`).join("\n");
