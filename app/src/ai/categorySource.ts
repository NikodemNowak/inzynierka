import type { Language } from '../i18n/language'
import { titleNeedsSourceAnchors } from './titleGrounding'
import { literalTopicDeclaration } from './titleDeclaration'
import { renderSummarySource } from './summarySelection'
import { sourceUnitsFromPlan, type SourceUnitPlan } from './sourceUnits'

export interface CategoryMetadata {
  readonly title: string
  readonly summary: string
}

interface LiteralStatement {
  readonly start: number
  readonly end: number
  readonly quote: string
}

export interface CategoryStatement extends LiteralStatement {
  readonly id: number
}

const statements = (source: string): LiteralStatement[] => {
  const result: LiteralStatement[] = []
  let start = 0
  const append = (end: number): void => {
    const raw = source.slice(start, end)
    const quote = raw.trim()
    if (quote) {
      const offset = start + raw.indexOf(quote)
      result.push({start: offset, end: offset + quote.length, quote})
    }
    start = end
  }
  for (const boundary of source.matchAll(/[.!?]+(?=\s|$)|\n\s*\n/gu))
    append(boundary.index + boundary[0].length)
  if (start < source.length) append(source.length)
  return result
}

const normalized = (text: string): string => text.replace(/\s+/gu, ' ').trim()

// Prepared evidence retains its original identities. Parsing by exact quote
// lengths also handles embedded newlines and repeated identical statements;
// never recover an offset from the first substring match when offsets exist.
export const categoryLiteralStatements = (
  content: string,
  originalContent: string = content,
  plan?: SourceUnitPlan,
): CategoryStatement[] => {
  const all: LiteralStatement[] = plan
    ? sourceUnitsFromPlan(originalContent, plan).map(({start,end,text}) => ({start,end,quote:text}))
    : statements(originalContent)
  if (content === originalContent) return all.map((statement, index) => ({id: index + 1, ...statement}))
  const restored = renderSummarySource(content, originalContent, plan)
  const chosen = new Set<LiteralStatement>()
  let cursor = 0
  while (cursor < content.length) {
    const header = content.slice(cursor).match(/^\[([^\]]+)\] \(([^)]*)\) /u)
    if (!header) throw new Error('Category evidence has no source identity')
    const identity = header[2].match(/(?:^|; )source (\d+):(\d+)(?:;|$)/u)
    const quoteStart = cursor + header[0].length
    let start: number
    let quote: string
    if (identity) {
      start = Number(identity[1])
      quote = originalContent.slice(start, Number(identity[2]))
    } else {
      const end = content.indexOf('\n', quoteStart)
      quote = content.slice(quoteStart, end >= 0 ? end : content.length)
      start = originalContent.indexOf(quote)
    }
    for (const statement of all)
      if (statement.start < start + quote.length && statement.end > start) chosen.add(statement)
    cursor = quoteStart + quote.length
    if (cursor < content.length) cursor += 1
  }
  const literal = all.filter((statement) => chosen.has(statement))
  if (literal.map((statement, index) => `[${index + 1}] ${statement.quote}`).join('\n') !== restored)
    throw new Error('Category source restoration does not match the validated source')
  return literal.map((statement, index) => ({id: index + 1, ...statement}))
}

// This is evidence packing, not a local topic classifier. Only complete literal
// statements are admitted. A shorter generated/paraphrased summary cannot prove
// what was excluded, so it uses the established complete-source path instead.
export const categorySourceBrief = (
  content: string,
  language: Language,
  metadata?: CategoryMetadata,
): string | null => {
  if (content.length < 2000 || !metadata || typeof metadata.title !== 'string' ||
      typeof metadata.summary !== 'string' || !metadata.title.trim() ||
      !metadata.summary.trim() || metadata.title.length > 160 ||
      titleNeedsSourceAnchors(metadata.title, content, language)) return null
  const all = statements(content)
  const summary = statements(metadata.summary)
  // Grounded title/summary can still describe an obsolete opening purpose.
  // Pack only when the complete source establishes one guarded current topic;
  // absent, competing, quoted or retracted declarations use complete source.
  const topic = literalTopicDeclaration(content)
  if (!topic) return null
  if (all.length < 6 || !summary.length ||
      !all.some((statement) => !titleNeedsSourceAnchors(metadata.title, statement.quote, language))) return null
  const chosen = new Set<LiteralStatement>()
  for (const statement of summary) {
    const literal = all.find((candidate) => normalized(candidate.quote) === normalized(statement.quote))
    if (!literal) return null
    chosen.add(literal)
  }
  // Boundaries are context, not a declaration that the first sentence is always
  // the main topic. The guarded explicit declaration can be anywhere in source.
  for (const statement of [...all.slice(0, 2), ...all.slice(-2)]) chosen.add(statement)
  const index = all.findIndex((statement) => statement.start === topic.start && statement.end === topic.end)
  if (index < 0) return null
  for (const statement of all.slice(Math.max(0, index - 1), index + 2)) chosen.add(statement)
  const literal = all.filter((statement) => chosen.has(statement))
  const data = JSON.stringify({scope: 'selected-source-statements', title: metadata.title.trim(), sourceLength: content.length,
    statements: literal.map((statement, index) => ({id: index + 1, ...statement}))})
  // Never truncate an actor, negation, correction or surrounding statement to
  // satisfy a token target. Insufficient savings use the original request.
  return data.length <= 6000 && data.length < content.length * 0.5 ? data : null
}
