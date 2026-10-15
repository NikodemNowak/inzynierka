import {
  jobSourceIdentity,
  decodeCheckpointMap,
  isReusableJob,
} from './jobIdentity'
import type { NoteInput } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'

test('metadata-only source revisions invalidate paused and ready jobs in the current pipeline', () => {
  const document: SummaryDocument = {
    version: 1, source: 'Friday. Friday.', format: 'bullets',
    points: [{ text: 'Friday.', sources: [{ start: 0, end: 7 }] }],
  }
  const input: NoteInput = { title: 'Day', content: 'Friday. Friday.', summary: '• Friday.', summaryDocument: document, tags: [], audioUri: null, durationMs: null }
  const identity = jobSourceIdentity(input)
  expect(JSON.parse(identity)).toMatchObject({ summaryDocument: document })
  const changed = { ...input, summaryDocument: { ...document, points: [{ text: 'Friday.', sources: [{ start: 8, end: 15 }] }] } }
  for (const status of ['paused', 'ready', 'pending']) {
    const job = { source: identity, model: 'qwen', pipeline: 'point-summary-v47', status }
    expect(isReusableJob(job, jobSourceIdentity(changed), 'qwen', 'point-summary-v47')).toBe(false)
    expect(isReusableJob(job, identity, 'qwen', 'old-pipeline')).toBe(false)
  }
  expect(jobSourceIdentity({ ...input, summaryDocument: undefined })).toBe(jobSourceIdentity({ ...input, summaryDocument: null }))
  expect(JSON.parse(jobSourceIdentity({ ...input, summaryDocument: undefined })).summaryDocument).toBeNull()
})

describe('durable processing identity', () => {
  const source = {
    title: 'Meeting',
    content: 'Send the report.',
    summary: null,
    tags: ['Praca'],
    language: 'en' as const,
    audioUri: 'file:///one.wav',
    durationMs: 100,
  }

  it('invalidates checkpoints after any source, language, or model change', () => {
    const identity = jobSourceIdentity(source)
    const job = {
      source: identity,
      model: 'qwen-a',
      pipeline: 'v1',
      status: 'paused',
    }
    expect(isReusableJob(job, identity, 'qwen-a', 'v1')).toBe(true)
    for (const changed of [
      { ...source, language: 'pl' as const },
      { ...source, content: 'Do not send the report.' },
      { ...source, title: 'Edited' },
    ]) {
      expect(
        isReusableJob(job, jobSourceIdentity(changed), 'qwen-a', 'v1'),
      ).toBe(false)
    }
    expect(isReusableJob(job, identity, 'qwen-b', 'v1')).toBe(false)
    expect(isReusableJob(job, identity, 'qwen-a', 'v2')).toBe(false)
    expect(
      isReusableJob(
        { ...job, status: 'invalidated' },
        identity,
        'qwen-a',
        'v1',
      ),
    ).toBe(false)
    expect(
      isReusableJob({ ...job, status: 'completed' }, identity, 'qwen-a', 'v1'),
    ).toBe(false)
  })

  it('rejects malformed checkpoint containers instead of resuming corrupt work', () => {
    expect(decodeCheckpointMap('{"part:0":{"text":"ok"}}')).toEqual({
      'part:0': { text: 'ok' },
    })
    for (const value of ['[]', 'null', '"text"', '{broken']) {
      expect(() => decodeCheckpointMap(value)).toThrow()
    }
  })
})
