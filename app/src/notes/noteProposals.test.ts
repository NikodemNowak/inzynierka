import type { Note } from '../domain/note'
import type { SummaryDocument } from '../domain/summary'
import {
  applyNoteProposal,
  createNoteProposal,
  getEffectiveNoteProposalSelection,
  getNoteProposalChanges,
  isNoteProposalCurrent,
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

const linkedDocument: SummaryDocument = {
  version: 1, source: 'On Friday I have no classes.', format: 'bullets',
  points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 28 }] }],
}
const linkedNote: Note = {
  ...note, content: 'On Friday I have no classes.', summary: '• Friday: no classes.', language: 'en',
}

describe('source-linked proposal pairs', () => {
  it('applies newly linked identical summary text only when summary is selected', () => {
    const proposal = createNoteProposal(linkedNote, {
      title: 'Friday', summary: '• Friday: no classes.', summaryDocument: linkedDocument, tags: [],
    })
    expect(getNoteProposalChanges(proposal).summary).toBe(true)
    expect(applyNoteProposal(linkedNote, proposal, { title: true, summary: false, tags: false }))
      .toMatchObject({ title: 'Friday', summary: '• Friday: no classes.', summaryDocument: null })
    expect(applyNoteProposal(linkedNote, proposal, { title: false, summary: true, tags: false }))
      .toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it.each(['title', 'tags'] as const)('retains existing links on a %s-only application', (field) => {
    const original = { ...linkedNote, summaryDocument: linkedDocument }
    const proposal = createNoteProposal(original, { title: 'Friday', summary: 'New summary', tags: ['Nauka'] })
    expect(proposal.source).toMatchObject({ summaryDocument: linkedDocument })
    expect(applyNoteProposal(original, proposal, { title: field === 'title', summary: false, tags: field === 'tags' }))
      .toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it('copies the original pair when summary generation failed', () => {
    const original = { ...linkedNote, summaryDocument: linkedDocument }
    const proposal = createNoteProposal(original, {
      title: 'Friday', summary: '', summaryDocument: null, tags: [], failedFields: ['summary'],
    })
    expect(proposal.generated).toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
    expect(getNoteProposalChanges(proposal).summary).toBe(false)
    expect(applyNoteProposal(original, proposal, { title: true, summary: false, tags: false }))
      .toMatchObject({ summary: '• Friday: no classes.', summaryDocument: linkedDocument })
  })

  it('rejects a metadata-only revision even when text and timestamp are unchanged', () => {
    const proposal = createNoteProposal(linkedNote, { title: 'Friday', summary: 'New', tags: [] })
    const revised = { ...linkedNote, summaryDocument: linkedDocument }
    expect(isNoteProposalCurrent(revised, proposal)).toBe(false)
    expect(applyNoteProposal(revised, proposal, selection)).toBeNull()
    expect(isNoteProposalCurrent({ ...linkedNote, summaryDocument: null }, proposal)).toBe(true)
  })

  it.each([
    { ...linkedDocument, source: 'On Monday I have no classes.' },
    { ...linkedDocument, points: [{ text: 'Different rendering', sources: [{ start: 0, end: 28 }] }] },
    { ...linkedDocument, points: [{ text: 'Friday: no classes.', sources: [{ start: 0, end: 29 }] }] },
  ])('refuses selected invalid or foreign links without publishing a replacement: %j', (summaryDocument) => {
    const proposal = createNoteProposal(linkedNote, { title: 'Friday', summary: '• Friday: no classes.', summaryDocument, tags: [] })
    expect(applyNoteProposal(linkedNote, proposal, { title: true, summary: true, tags: false })).toBeNull()
    expect(applyNoteProposal(linkedNote, proposal, { title: true, summary: false, tags: false }))
      .toMatchObject({ summary: '• Friday: no classes.', summaryDocument: null })
  })

  it('removes links on an explicitly selected legacy summary replacement', () => {
    const original = { ...linkedNote, summaryDocument: linkedDocument }
    const proposal = createNoteProposal(original, { title: original.title, summary: 'Plain summary', tags: [] })
    expect(applyNoteProposal(original, proposal, { title: false, summary: true, tags: false }))
      .toMatchObject({ summary: 'Plain summary', summaryDocument: null })
  })
})

describe('note reprocessing proposals', () => {
  it('reports only available actual changes and intersects them with the selection', () => {
    const proposal = createNoteProposal(note, {
      title: note.title, summary: 'Different summary', tags: ['Nauka'], failedFields: ['tags'],
    })
    expect(getNoteProposalChanges(proposal)).toEqual({ title: false, summary: true, tags: false })
    expect(getEffectiveNoteProposalSelection(proposal, { title: true, summary: true, tags: true }))
      .toEqual({ title: false, summary: true, tags: false })
  })

  it.each([
    { title: ` ${note.title} ` },
    { summary: ` ${note.summary} ` },
    { tags: ['praca'] },
    { content: `${note.content} ` },
  ])('keeps raw source changes stale even when display values are equivalent: %j', (edit) => {
    const proposal = createNoteProposal(note, { title: 'New title', summary: 'New summary', tags: ['Nauka'] })
    expect(isNoteProposalCurrent({ ...note, ...edit }, proposal)).toBe(false)
    expect(applyNoteProposal({ ...note, ...edit }, proposal, { title: true, summary: true, tags: true }))
      .toBeNull()
  })

  it('returns no update for three identical proposed values', () => {
    const proposal = createNoteProposal(note, {
      title: note.title,
      summary: note.summary ?? '',
      tags: [...note.tags],
    })
    expect(applyNoteProposal(note, proposal, { title: true, summary: true, tags: true }))
      .toBeNull()
  })

  it('returns no update when the only changed field is not selected', () => {
    const proposal = createNoteProposal(note, {
      title: 'A different title',
      summary: note.summary ?? '',
      tags: [...note.tags],
    })
    expect(applyNoteProposal(note, proposal, { title: false, summary: true, tags: true }))
      .toBeNull()
    expect(applyNoteProposal(note, proposal, { title: false, summary: false, tags: false }))
      .toBeNull()
  })

  it('compares categories as a set without changing the raw source guard', () => {
    const source = { ...note, tags: ['Nauka', 'Praca'] }
    const proposal = createNoteProposal(source, {
      title: source.title,
      summary: source.summary ?? '',
      tags: [' praca ', 'NAUKA', 'Nauka'],
    })
    expect(applyNoteProposal(source, proposal, { title: false, summary: false, tags: true }))
      .toBeNull()
    expect(isNoteProposalCurrent({ ...source, tags: ['Praca', 'Nauka'] }, proposal)).toBe(false)
    expect(applyNoteProposal({ ...source, tags: ['Praca', 'Nauka'] }, proposal, selection))
      .toBeNull()
  })

  it('preserves current raw values for equivalent fields while applying a real change', () => {
    const source = { ...note, title: 'Żółć', summary: '  Dosłowne podsumowanie.  ', tags: ['Nauka', 'Praca'] }
    const proposal = createNoteProposal(source, {
      title: ` ${source.title.normalize('NFD')} `,
      summary: 'Nowe podsumowanie.',
      tags: ['PRACA', ' nauka ', 'Nauka'],
    })
    expect(applyNoteProposal(source, proposal, { title: true, summary: true, tags: true }))
      .toMatchObject({ title: source.title, summary: 'Nowe podsumowanie.', tags: source.tags })
  })

  it('treats an empty generated summary as unchanged when no summary exists', () => {
    const source = { ...note, summary: null }
    const proposal = createNoteProposal(source, { title: source.title, summary: ' \n ', tags: source.tags })
    expect(applyNoteProposal(source, proposal, { title: false, summary: true, tags: false }))
      .toBeNull()
  })

  it('keeps text case, punctuation and internal line breaks meaningful', () => {
    const source = { ...note, title: 'Plan', summary: 'Pierwszy cytat.\nDrugi cytat.' }
    const proposal = createNoteProposal(source, {
      title: 'plan', summary: 'Pierwszy cytat. Drugi cytat.', tags: ['Study'],
    })
    expect(applyNoteProposal(source, proposal, { title: true, summary: true, tags: true }))
      .toMatchObject({ title: 'plan', summary: 'Pierwszy cytat. Drugi cytat.', tags: ['Study'] })
  })

  it.each(['title', 'summary', 'tags'] as const)(
    'refuses a selected failed %s field instead of applying an old fallback as new',
    (field) => {
      const proposal = createNoteProposal(note, {
        title: 'New title',
        summary: 'New summary',
        tags: ['Nauka'],
        failedFields: [field],
        warnings: ['The field could not be generated.'],
      })
      expect(applyNoteProposal(note, proposal, {
        title: field === 'title',
        summary: field === 'summary',
        tags: field === 'tags',
      })).toBeNull()
    },
  )

  it('allows a successful field while retaining an unselected failed summary and its warning', () => {
    const proposal = createNoteProposal(note, {
      title: 'New title',
      summary: '',
      tags: ['Nauka'],
      failedFields: ['summary'],
      warnings: ['Summary unavailable'],
    })
    expect(applyNoteProposal(note, proposal, { title: true, summary: false, tags: false }))
      .toMatchObject({ title: 'New title', summary: note.summary, content: note.content, tags: ['Praca'] })
    expect(proposal.generated.warnings).toEqual(['Summary unavailable'])
    expect(proposal.generated.failedFields).toEqual(['summary'])
  })

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
      summaryDocument: null,
      tags: ['Nauka'],
      audioUri: 'file:///notes/one.m4a',
      durationMs: 42_000,
      language: 'pl',
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

  it('refuses to apply a proposal after the note language changes', () => {
    const proposal = createNoteProposal(note, {
      title: 'Plan dalszych badań',
      summary: 'Przygotować porównanie i prezentację.',
      tags: ['Nauka'],
    })
    expect(
      applyNoteProposal({ ...note, language: 'en' }, proposal, selection),
    ).toBeNull()
  })

  it('retains English content and language when applying a suggestion', () => {
    const englishNote: Note = {
      ...note,
      language: 'en',
      title: 'Research meeting',
      content: 'Discussed test results.',
    }
    const proposal = createNoteProposal(englishNote, {
      title: 'Next research steps',
      summary: '',
      tags: ['Nauka'],
    })
    expect(applyNoteProposal(englishNote, proposal, selection)).toMatchObject({
      language: 'en',
      content: englishNote.content,
      summary: englishNote.summary,
    })
  })
})
