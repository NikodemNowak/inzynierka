import type { Note } from '../domain/note'
import {
  applyNoteProposal,
  createNoteProposal,
  type NoteProposalSelection,
} from './noteProposals'

const note: Note = {
  id: 'note-1',
  title: 'Spotkanie z promotorem',
  content: 'Omówiliśmy wyniki testów i dalszy plan.',
  summary: 'Omówiliśmy wyniki.',
  tags: ['Praca'],
  audioUri: 'file:///notes/one.m4a',
  durationMs: 42_000,
  createdAt: 10,
  updatedAt: 20,
}

const selection: NoteProposalSelection = {
  title: true,
  summary: false,
  tags: true,
}

describe('note reprocessing proposals', () => {
  it('applies each selected field while retaining the current values of unselected fields', () => {
    const proposal = createNoteProposal(note, {
      title: 'Plan dalszych badań',
      summary: 'Przygotować porównanie i prezentację.',
      tags: ['Nauka'],
    })

    expect(applyNoteProposal(note, proposal, selection)).toEqual({
      title: 'Plan dalszych badań',
      content: 'Omówiliśmy wyniki testów i dalszy plan.',
      summary: 'Omówiliśmy wyniki.',
      tags: ['Nauka'],
      audioUri: 'file:///notes/one.m4a',
      durationMs: 42_000,
    })
  })

  it('refuses to apply a proposal after the source note content changes', () => {
    const proposal = createNoteProposal(note, {
      title: 'Plan dalszych badań',
      summary: 'Przygotować porównanie i prezentację.',
      tags: ['Nauka'],
    })

    expect(
      applyNoteProposal(
        { ...note, content: 'Dodałem nowy termin spotkania.' },
        proposal,
        selection,
      ),
    ).toBeNull()
  })

  it('refuses to apply a proposal if a field changed while the chooser was open', () => {
    const proposal = createNoteProposal(note, {
      title: 'Plan dalszych badań',
      summary: 'Przygotować porównanie i prezentację.',
      tags: ['Nauka'],
    })

    expect(
      applyNoteProposal(
        { ...note, title: 'Ręcznie poprawiony tytuł' },
        proposal,
        selection,
      ),
    ).toBeNull()
  })
})
