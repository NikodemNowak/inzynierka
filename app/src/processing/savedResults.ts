import type { NoteProcessingResult } from '../ai/noteProcessing'
import type { TaskProposal } from '../ai/taskProposal'
import { isCategory } from '../domain/categories'
import { parseSummaryDocument } from '../domain/summary'

export const isNoteProcessingResult = (
  value: unknown,
): value is NoteProcessingResult => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const result = value as Record<string, unknown>
  const document = result.summaryDocument
  if (document !== undefined && document !== null) {
    if (typeof document !== 'object' || Array.isArray(document)) return false
    const source = (document as Record<string, unknown>).source
    if (typeof source !== 'string' || typeof result.summary !== 'string' ||
      parseSummaryDocument(document, source, result.summary) === null) return false
  }
  return (
    typeof result.title === 'string' &&
    typeof result.summary === 'string' &&
    Array.isArray(result.tags) &&
    result.tags.every((tag) => typeof tag === 'string' && isCategory(tag)) &&
    (result.warnings === undefined ||
      (Array.isArray(result.warnings) &&
        result.warnings.every((warning) => typeof warning === 'string'))) &&
    (result.failedFields === undefined ||
      (Array.isArray(result.failedFields) &&
        result.failedFields.every(
          (field) =>
            field === 'title' || field === 'summary' || field === 'tags',
        )))
  )
}

export const isSourceTaskResult = (
  value: unknown,
  source: string,
): value is string[] =>
  Array.isArray(value) &&
  value.every(
    (task) =>
      typeof task === 'string' &&
      task.trim().length > 0 &&
      source.includes(task),
  )

export const isTaskProposalResult = (
  value: unknown,
  source: string,
): value is TaskProposal => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const result = value as Record<string, unknown>
  return (
    isSourceTaskResult(result.tasks, source) &&
    Array.isArray(result.warnings) &&
    result.warnings.every(
      (warning) => typeof warning === 'string' && warning.trim().length > 0,
    )
  )
}

export const parseSavedProcessingResult = <T>(
  serialized: string | null,
  validate?: (value: unknown) => value is T,
): T | null => {
  if (serialized === null || !validate) return null
  try {
    const value: unknown = JSON.parse(serialized)
    return validate(value) ? value : null
  } catch {
    return null
  }
}
