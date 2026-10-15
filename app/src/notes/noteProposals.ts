import type { Note, NoteInput } from '../domain/note'
import type { NoteProcessingResult } from '../ai/noteProcessing'
import { parseSummaryDocument, sameSummaryDocument } from '../domain/summary'

export interface NoteProposalSelection {
  title: boolean
  summary: boolean
  tags: boolean
}

export interface NoteProposal {
  source: Pick<Note, 'title' | 'content' | 'summary' | 'summaryDocument' | 'tags' | 'language'>
  generated: NoteProcessingResult
}

const sameTags = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((tag, index) => tag === right[index])

export const createNoteProposal = (
  note: Note,
  generated: NoteProcessingResult,
): NoteProposal => ({
  source: {
    title: note.title,
    content: note.content,
    summary: note.summary,
    summaryDocument: note.summaryDocument ?? null,
    tags: [...note.tags],
    language: note.language ?? 'pl',
  },
  generated: {
    ...generated,
    title: generated.failedFields?.includes('title')
      ? note.title
      : generated.title,
    summary: generated.failedFields?.includes('summary')
      ? (note.summary ?? '')
      : generated.summary,
    ...(generated.failedFields?.includes('summary')
      ? { summaryDocument: note.summaryDocument ?? null }
      : {}),
    tags: generated.failedFields?.includes('tags')
      ? [...note.tags]
      : [...generated.tags],
  },
})

export const isNoteProposalCurrent = (
  note: Note,
  proposal: NoteProposal,
): boolean =>
  note.title === proposal.source.title &&
  note.content === proposal.source.content &&
  note.summary === proposal.source.summary &&
  sameSummaryDocument(note.summaryDocument, proposal.source.summaryDocument) &&
  (note.language ?? 'pl') === (proposal.source.language ?? 'pl') &&
  sameTags(note.tags, proposal.source.tags)

export const isNoteProposalFieldAvailable = (
  proposal: NoteProposal,
  field: keyof NoteProposalSelection,
): boolean => !proposal.generated.failedFields?.includes(field)

const comparableText = (value: string | null | undefined): string =>
  (value ?? '').normalize('NFC').trim()

const categoryKeys = (tags: readonly string[]): ReadonlySet<string> =>
  new Set(tags.map((tag) => comparableText(tag).toLocaleLowerCase('pl-PL')))

const sameCategories = (left: readonly string[], right: readonly string[]): boolean => {
  const leftKeys = categoryKeys(left)
  const rightKeys = categoryKeys(right)
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key))
}

// Display equivalence is separate from the exact source identity checked above.
export const getNoteProposalChanges = (proposal: NoteProposal): NoteProposalSelection => ({
  title: isNoteProposalFieldAvailable(proposal, 'title') &&
    comparableText(proposal.source.title) !== comparableText(proposal.generated.title),
  summary: isNoteProposalFieldAvailable(proposal, 'summary') &&
    (comparableText(proposal.source.summary) !== comparableText(proposal.generated.summary) ||
      !sameSummaryDocument(proposal.source.summaryDocument, proposal.generated.summaryDocument)),
  tags: isNoteProposalFieldAvailable(proposal, 'tags') &&
    !sameCategories(proposal.source.tags, proposal.generated.tags),
})

export const getEffectiveNoteProposalSelection = (
  proposal: NoteProposal,
  selection: NoteProposalSelection,
): NoteProposalSelection => {
  const changes = getNoteProposalChanges(proposal)
  return {
    title: selection.title && changes.title,
    summary: selection.summary && changes.summary,
    tags: selection.tags && changes.tags,
  }
}

export const applyNoteProposal = (
  note: Note,
  proposal: NoteProposal,
  selection: NoteProposalSelection,
): NoteInput | null => {
  if (!isNoteProposalCurrent(note, proposal)) return null
  if (
    (selection.title && !isNoteProposalFieldAvailable(proposal, 'title')) ||
    (selection.summary && !isNoteProposalFieldAvailable(proposal, 'summary')) ||
    (selection.tags && !isNoteProposalFieldAvailable(proposal, 'tags'))
  )
    return null

  const effective = getEffectiveNoteProposalSelection(proposal, selection)
  if (!effective.title && !effective.summary && !effective.tags) return null

  const generatedDocument = proposal.generated.summaryDocument ?? null
  const summaryDocument = generatedDocument === null ? null : parseSummaryDocument(
    generatedDocument, note.content, proposal.generated.summary,
  )
  if (effective.summary && generatedDocument !== null && summaryDocument === null) return null

  return {
    title: effective.title ? proposal.generated.title : note.title,
    content: note.content,
    summary: effective.summary
      ? proposal.generated.summary.trim().length > 0
        ? proposal.generated.summary
        : null
      : note.summary,
    summaryDocument: effective.summary ? summaryDocument : note.summaryDocument ?? null,
    tags: effective.tags ? [...proposal.generated.tags] : [...note.tags],
    audioUri: note.audioUri,
    durationMs: note.durationMs,
    language: note.language ?? 'pl',
  }
}
