export interface SummarySourceRange {
  readonly start: number
  readonly end: number
}

export interface SummaryPoint {
  readonly text: string
  readonly group?: string
  readonly sources: readonly SummarySourceRange[]
}

export interface SummaryDocument {
  readonly version: 1
  readonly source: string
  readonly format: 'bullets' | 'grouped' | 'paragraph'
  readonly points: readonly SummaryPoint[]
}

export const renderSummaryDocument = (document: SummaryDocument): string => {
  if (document.format === 'paragraph') {
    return document.points.map(point => point.text).join(' ')
  }
  if (document.format === 'bullets') {
    return document.points.map(point => `• ${point.text}`).join('\n')
  }

  const groups = new Map<string, string[]>()
  for (const point of document.points) {
    const group = point.group ?? ''
    const lines = groups.get(group)
    if (lines) lines.push(`• ${point.text}`)
    else groups.set(group, [`• ${point.text}`])
  }
  return Array.from(groups, ([group, lines]) => `${group}\n${lines.join('\n')}`).join('\n\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const splitsSurrogatePair = (source: string, offset: number): boolean => {
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

const parseRanges = (value: unknown, source: string): SummarySourceRange[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null

  const ranges: SummarySourceRange[] = []
  const values: readonly unknown[] = value
  for (const range of values) {
    if (!isRecord(range)) return null
    const { start, end } = range
    if (typeof start !== 'number' || typeof end !== 'number' ||
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || start >= end || end > source.length ||
      splitsSurrogatePair(source, start) || splitsSurrogatePair(source, end)) return null

    // Persisted ranges must already be ordered by start, then end, without duplicates.
    const previous = ranges[ranges.length - 1]
    if (previous && (start < previous.start || (start === previous.start && end <= previous.end))) {
      return null
    }
    ranges.push({ start, end })
  }
  return ranges
}

export const parseSummaryDocument = (
  value: unknown,
  content: string,
  summary: string | null,
): SummaryDocument | null => {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }
  if (!isRecord(candidate) || candidate.version !== 1 || candidate.source !== content ||
    (candidate.format !== 'bullets' && candidate.format !== 'grouped' && candidate.format !== 'paragraph') ||
    !Array.isArray(candidate.points) || candidate.points.length === 0) return null

  const points: SummaryPoint[] = []
  const values: readonly unknown[] = candidate.points
  for (const point of values) {
    if (!isRecord(point) || typeof point.text !== 'string' || point.text.trim().length === 0) return null
    const sources = parseRanges(point.sources, content)
    if (!sources) return null
    if (candidate.format === 'grouped') {
      if (typeof point.group !== 'string' || point.group.trim().length === 0) return null
      points.push({ text: point.text, group: point.group, sources })
    } else {
      if (point.group !== undefined) return null
      points.push({ text: point.text, sources })
    }
  }

  const document: SummaryDocument = { version: 1, source: content, format: candidate.format, points }
  return renderSummaryDocument(document) === summary ? document : null
}

export const sameSummaryDocument = (
  left: SummaryDocument | null | undefined,
  right: SummaryDocument | null | undefined,
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

export const reconcileSummaryDocument = (
  content: string,
  summary: string | null,
  incoming: SummaryDocument | null | undefined,
  previous?: SummaryDocument | null,
): SummaryDocument | null => incoming === null
  ? null
  : parseSummaryDocument(incoming === undefined ? previous : incoming, content, summary)
