import type { NoteInput } from '../domain/note'

export const jobSourceIdentity = (source: NoteInput): string =>
  JSON.stringify({
    title: source.title,
    content: source.content,
    summary: source.summary,
    summaryDocument: source.summaryDocument ?? null,
    tags: source.tags,
    language: source.language ?? 'pl',
    audioUri: source.audioUri,
    durationMs: source.durationMs,
    transcriptionIncomplete: source.transcriptionIncomplete ?? false,
  })

export const isReusableJob = (
  job: { source: string; model: string; pipeline: string; status: string },
  source: string,
  model: string,
  pipeline: string,
): boolean =>
  job.source === source &&
  job.model === model &&
  job.pipeline === pipeline &&
  ['paused', 'failed', 'running', 'ready', 'pending'].includes(job.status)

export const decodeCheckpointMap = (json: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(json)
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid processing checkpoint')
  return value as Record<string, unknown>
}
