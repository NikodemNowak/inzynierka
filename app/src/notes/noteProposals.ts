import type { Note, NoteInput } from '../domain/note'
import type { NoteProcessingResult } from '../ai/noteProcessing'

export interface NoteProposalSelection {
  title: boolean
  summary: boolean
  tags: boolean
}

export interface NoteProposal {
  source: Pick<Note, 'title' | 'content' | 'summary' | 'tags'>
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
    tags: [...note.tags],
  },
  generated: { ...generated, tags: [...generated.tags] },
})

export const isNoteProposalCurrent = (
  note: Note,
  proposal: NoteProposal,
): boolean =>
  note.title === proposal.source.title &&
  note.content === proposal.source.content &&
  note.summary === proposal.source.summary &&
  sameTags(note.tags, proposal.source.tags)

export const applyNoteProposal = (
  note: Note,
  proposal: NoteProposal,
  selection: NoteProposalSelection,
): NoteInput | null => {
  if (!isNoteProposalCurrent(note, proposal)) return null

  return {
    title: selection.title ? proposal.generated.title : note.title,
    content: note.content,
    summary: selection.summary
      ? proposal.generated.summary.trim().length > 0
        ? proposal.generated.summary
        : null
      : note.summary,
    tags: selection.tags ? [...proposal.generated.tags] : [...note.tags],
    audioUri: note.audioUri,
    durationMs: note.durationMs,
  }
}
