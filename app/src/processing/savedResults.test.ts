import {
  isNoteProcessingResult,
  isSourceTaskResult,
  isTaskProposalResult,
  parseSavedProcessingResult,
} from './savedResults'
import type { SummaryDocument } from '../domain/summary'

const document: SummaryDocument = {
  version: 1, source: 'On Friday I have no classes.', format: 'bullets',
  points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 28 }] }],
}
const linkedResult = { title: 'Friday', summary: '• Friday: no classes.', tags: ['Nauka'], summaryDocument: document }

test('restores a fully validated linked result and compatible absent/null legacy metadata', () => {
  expect(parseSavedProcessingResult(JSON.stringify(linkedResult), isNoteProcessingResult)).toEqual(linkedResult)
  expect(isNoteProcessingResult({ title: 'Old', summary: 'Plain text', tags: [] })).toBe(true)
  expect(isNoteProcessingResult({ title: 'Old', summary: 'Plain text', tags: [], summaryDocument: null })).toBe(true)
})

test.each([
  {}, 'not a document', JSON.stringify(document),
  { ...document, version: 2 },
  { ...document, source: 7 },
  { ...document, points: [] },
  { ...document, points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 29 }] }] },
  { ...document, points: [{ text: 'Different rendering', sources: [{ start: 0, end: 28 }] }] },
])('rejects present corrupt document metadata instead of reviving the saved result: %j', (summaryDocument) => {
  expect(parseSavedProcessingResult(JSON.stringify({ ...linkedResult, summaryDocument }), isNoteProcessingResult)).toBeNull()
})

test('requires exact rendering without trimming or Unicode normalization', () => {
  expect(isNoteProcessingResult({ ...linkedResult, summary: '• Friday: no classes. ' })).toBe(false)
})

test('restores only well-formed note fields and recognized failure metadata', () => {
  const saved =
    '{"title":"Client report","summary":"A report is needed.","tags":["Praca"],"failedFields":["summary"],"warnings":["Summary unavailable"]}'
  expect(parseSavedProcessingResult(saved, isNoteProcessingResult)).toEqual({
    title: 'Client report',
    summary: 'A report is needed.',
    tags: ['Praca'],
    failedFields: ['summary'],
    warnings: ['Summary unavailable'],
  })
  expect(
    parseSavedProcessingResult(
      '{"title":"Client report","summary":"Text","tags":["Invented"]}',
      isNoteProcessingResult,
    ),
  ).toBeNull()
  expect(
    parseSavedProcessingResult(
      '{"title":"Client report","summary":"Text","tags":[],"failedFields":["content"]}',
      isNoteProcessingResult,
    ),
  ).toBeNull()
  expect(
    parseSavedProcessingResult('{broken', isNoteProcessingResult),
  ).toBeNull()
})

test('restores task warnings with their source anchored proposals', () => {
  const source = 'Send the report by Friday.'
  const valid = (value: unknown) => isTaskProposalResult(value, source)
  const proposal = {
    tasks: ['Send the report by Friday'],
    warnings: ['Check the cancellation.'],
  }
  expect(parseSavedProcessingResult(JSON.stringify(proposal), valid)).toEqual(
    proposal,
  )
  expect(
    parseSavedProcessingResult(
      '{"tasks":["Send the report by Monday"],"warnings":[]}',
      valid,
    ),
  ).toBeNull()
  expect(
    parseSavedProcessingResult('{"tasks":[],"warnings":[7]}', valid),
  ).toBeNull()
  expect(parseSavedProcessingResult('{"tasks":[]}', valid)).toBeNull()
  expect(
    parseSavedProcessingResult('{"tasks":[],"warnings":[]}', valid),
  ).toEqual({ tasks: [], warnings: [] })
})

test('refuses fabricated persisted tasks and keeps an intentionally empty result', () => {
  const source = 'Send report by Friday. Call Alice.'
  const validate = (value: unknown): value is string[] =>
    isSourceTaskResult(value, source)
  expect(
    parseSavedProcessingResult(
      '["Send report by Friday","Call Alice"]',
      validate,
    ),
  ).toEqual(['Send report by Friday', 'Call Alice'])
  expect(
    parseSavedProcessingResult('["Send report by Monday"]', validate),
  ).toBeNull()
  expect(parseSavedProcessingResult('[]', validate)).toEqual([])
})
