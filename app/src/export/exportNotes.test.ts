import type { Note } from '../domain/note'
import { buildExportPayload, exportFileName } from './exportNotes'

jest.mock('../data/metricsRepository', () => ({ listMetrics: jest.fn() }))
jest.mock('../ai/benchmarkStorage', () => ({ listBenchmarkRuns: jest.fn() }))
jest.mock('../i18n/translate', () => ({
  getAppLanguage: () => 'en',
  translate: (_pl: string, en: string) => en,
}))

const note: Note = {
  id: 'one',
  title: 'Meeting',
  content: 'Call the supplier.',
  summary: null,
  tags: ['Praca'],
  audioUri: 'file:///one.m4a',
  durationMs: 10_000,
  createdAt: 1,
  updatedAt: 2,
  language: 'en',
}

describe('note export language', () => {
  it('exports whole operations including failures alongside generation data', () => {
    const operation = {
      id: 'op',
      operation: 'note' as const,
      model: 'Qwen3',
      inputChars: 100,
      queueMs: 20,
      modelLoadMs: 300,
      totalMs: 1400,
      succeeded: false,
      createdAt: 1,
    }
    const payload = buildExportPayload([note], [], 3, [], [operation])
    expect(payload.version).toBe(2)
    expect(payload.operations).toEqual([operation])
    expect(payload.benchmarks).toEqual([])
  })
  it('preserves each note language and defaults legacy notes to Polish', () => {
    const payload = buildExportPayload(
      [note, { ...note, id: 'legacy', language: undefined }],
      [],
      3,
    )
    expect(payload.notes[0]).toMatchObject({
      language: 'en',
      content: 'Call the supplier.',
      tags: ['Praca'],
    })
    expect(payload.notes[1].language).toBe('pl')
    expect(payload.notes[0]).not.toHaveProperty('audioUri')
  })

  it('uses a filename matching the chosen interface language', () => {
    const date = new Date(2026, 8, 30).getTime()
    expect(exportFileName(date, 'en')).toBe('notes-2026-09-30.json')
    expect(exportFileName(date, 'pl')).toBe('notatki-2026-09-30.json')
  })
})
