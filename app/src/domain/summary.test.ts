import {
  parseSummaryDocument,
  reconcileSummaryDocument,
  renderSummaryDocument,
  sameSummaryDocument,
} from './summary'
import type { SummaryDocument } from './summary'

const source = '🙂 Brak zajęć. Brak zajęć.'
const document: SummaryDocument = {
  version: 1,
  source,
  format: 'bullets',
  points: [{ text: 'Brak zajęć.', sources: [{ start: 15, end: 26 }] }],
}
const summary = '• Brak zajęć.'

test('binds the second exact occurrence and invalidates source or summary edits', () => {
  expect(source.slice(15, 26)).toBe('Brak zajęć.')
  expect(renderSummaryDocument(document)).toBe(summary)
  expect(parseSummaryDocument(document, source, summary)).toEqual(document)
  expect(parseSummaryDocument(document, source + ' ', summary)).toBeNull()
  expect(parseSummaryDocument(document, source, 'Ręczna zmiana')).toBeNull()
  expect(parseSummaryDocument(document, source, summary + ' ')).toBeNull()
  expect(parseSummaryDocument(document, source, null)).toBeNull()
})

test('parses serialized documents without changing their exact source', () => {
  const decomposedSource = '  Zażółć.\n'
  const exactDocument: SummaryDocument = {
    version: 1,
    source: decomposedSource,
    format: 'paragraph',
    points: [{ text: 'Zażółć.', sources: [{ start: 2, end: 9 }] }],
  }
  expect(parseSummaryDocument(JSON.stringify(exactDocument), decomposedSource, 'Zażółć.'))
    .toEqual(exactDocument)
  expect(parseSummaryDocument(exactDocument, decomposedSource.trim(), 'Zażółć.')).toBeNull()
  expect(parseSummaryDocument(exactDocument, decomposedSource.normalize('NFC'), 'Zażółć.')).toBeNull()
})

test('renders bullets with one line per point', () => {
  expect(renderSummaryDocument({
    ...document,
    points: [
      { text: 'Brak zajęć.', sources: [{ start: 3, end: 14 }] },
      { text: 'Informacja powtórzona.', sources: [{ start: 15, end: 26 }] },
    ],
  })).toBe('• Brak zajęć.\n• Informacja powtórzona.')
})

test('renders a paragraph with a single space between information units', () => {
  const paragraph: SummaryDocument = {
    ...document,
    format: 'paragraph',
    points: [
      { text: 'Brak zajęć.', sources: [{ start: 3, end: 14 }] },
      { text: 'Informacja powtórzona.', sources: [{ start: 15, end: 26 }] },
    ],
  }
  expect(renderSummaryDocument(paragraph)).toBe('Brak zajęć. Informacja powtórzona.')
  expect(parseSummaryDocument(paragraph, source, 'Brak zajęć. Informacja powtórzona.'))
    .toEqual(paragraph)
})

test('renders groups in first-occurrence order and gathers interleaved points', () => {
  const grouped: SummaryDocument = {
    version: 1,
    source: 'Zajęcia. Projekt. Wolne.',
    format: 'grouped',
    points: [
      { text: 'Zajęcia rano.', group: 'Plan', sources: [{ start: 0, end: 8 }] },
      { text: 'Projekt po południu.', group: 'Praca', sources: [{ start: 9, end: 17 }] },
      { text: 'Wolny wieczór.', group: 'Plan', sources: [{ start: 18, end: 24 }] },
    ],
  }
  const rendered = 'Plan\n• Zajęcia rano.\n• Wolny wieczór.\n\nPraca\n• Projekt po południu.'
  expect(renderSummaryDocument(grouped)).toBe(rendered)
  expect(parseSummaryDocument(grouped, grouped.source, rendered)).toEqual(grouped)
})

test.each([
  ['null', null],
  ['undefined', undefined],
  ['malformed JSON', '{bad JSON'],
  ['JSON null', 'null'],
  ['JSON array', '[]'],
  ['number', 1],
  ['array', []],
  ['unsupported version', { ...document, version: 2 }],
  ['non-string source', { ...document, source: 1 }],
  ['unsupported format', { ...document, format: 'table' }],
  ['missing points', { ...document, points: undefined }],
  ['empty points', { ...document, points: [] }],
  ['null point', { ...document, points: [null] }],
  ['empty point text', { ...document, points: [{ text: '', sources: [{ start: 3, end: 14 }] }] }],
  ['blank point text', { ...document, points: [{ text: ' \n', sources: [{ start: 3, end: 14 }] }] }],
  ['non-string point text', { ...document, points: [{ text: 1, sources: [{ start: 3, end: 14 }] }] }],
  ['missing sources', { ...document, points: [{ text: 'Brak zajęć.' }] }],
  ['empty sources', { ...document, points: [{ text: 'Brak zajęć.', sources: [] }] }],
  ['unexpected group in bullets', { ...document, points: [{ ...document.points[0], group: 'Plan' }] }],
  ['null group in bullets', { ...document, points: [{ ...document.points[0], group: null }] }],
  ['missing group', { ...document, format: 'grouped' }],
  ['blank group', { ...document, format: 'grouped', points: [{ ...document.points[0], group: ' ' }] }],
  ['unexpected group in paragraph', { ...document, format: 'paragraph', points: [{ ...document.points[0], group: 'Plan' }] }],
])('rejects corrupt document: %s', (_name, value) => {
  expect(parseSummaryDocument(value, source, summary)).toBeNull()
})

test.each([
  ['null range', null],
  ['non-numeric start', { start: '3', end: 14 }],
  ['non-integer start', { start: 3.5, end: 14 }],
  ['non-integer end', { start: 3, end: 14.5 }],
  ['NaN', { start: Number.NaN, end: 14 }],
  ['infinite end', { start: 3, end: Number.POSITIVE_INFINITY }],
  ['negative start', { start: -1, end: 14 }],
  ['empty range', { start: 3, end: 3 }],
  ['reversed range', { start: 14, end: 3 }],
  ['past source end', { start: 3, end: 27 }],
  ['split surrogate start', { start: 1, end: 2 }],
  ['split surrogate end', { start: 0, end: 1 }],
])('rejects invalid UTF-16 range: %s', (_name, range) => {
  const invalid = { ...document, points: [{ text: 'Brak zajęć.', sources: [range] }] }
  expect(parseSummaryDocument(invalid, source, summary)).toBeNull()
})

test('accepts a whole surrogate pair and ranges ending at the source boundary', () => {
  const anchored: SummaryDocument = {
    ...document,
    points: [{ text: 'Brak zajęć.', sources: [{ start: 0, end: 2 }, { start: 15, end: 26 }] }],
  }
  expect(parseSummaryDocument(anchored, source, summary)).toEqual(anchored)
})

test('rejects duplicate or noncanonical ranges without silently sorting persisted data', () => {
  for (const ranges of [
    [{ start: 15, end: 26 }, { start: 3, end: 14 }],
    [{ start: 3, end: 14 }, { start: 3, end: 14 }],
    [{ start: 3, end: 14 }, { start: 3, end: 8 }],
  ]) {
    expect(parseSummaryDocument({ ...document, points: [{ text: 'Brak zajęć.', sources: ranges }] }, source, summary))
      .toBeNull()
  }
  const ordered: SummaryDocument = {
    ...document,
    points: [{ text: 'Brak zajęć.', sources: [{ start: 3, end: 8 }, { start: 3, end: 14 }, { start: 15, end: 26 }] }],
  }
  expect(parseSummaryDocument(ordered, source, summary)).toEqual(ordered)
})

test('retains only valid previous metadata for omitted incoming documents', () => {
  expect(reconcileSummaryDocument(source, summary, undefined, document)).toEqual(document)
  expect(reconcileSummaryDocument(source + ' ', summary, undefined, document)).toBeNull()
  expect(reconcileSummaryDocument(source, 'Ręczna zmiana', undefined, document)).toBeNull()
  expect(reconcileSummaryDocument(source, summary, undefined)).toBeNull()
})

test('clears explicit null and validates explicit replacements independently of previous metadata', () => {
  expect(reconcileSummaryDocument(source, summary, null, document)).toBeNull()
  expect(reconcileSummaryDocument(source, summary, document, null)).toEqual(document)
  expect(reconcileSummaryDocument(source, summary, { ...document, source: 'old' }, document)).toBeNull()
})

test('compares document values and treats null and undefined as absent metadata', () => {
  expect(sameSummaryDocument(null, undefined)).toBe(true)
  expect(sameSummaryDocument(undefined, undefined)).toBe(true)
  expect(sameSummaryDocument(document, JSON.parse(JSON.stringify(document)) as unknown as SummaryDocument)).toBe(true)
  expect(sameSummaryDocument(document, null)).toBe(false)
  expect(sameSummaryDocument(document, { ...document, source: source + ' ' })).toBe(false)
  expect(sameSummaryDocument(document, {
    ...document,
    points: [{ text: 'Brak zajęć.', sources: [{ start: 3, end: 14 }] }],
  })).toBe(false)
})
