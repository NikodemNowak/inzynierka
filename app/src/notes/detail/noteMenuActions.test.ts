import { noteMenuActions, type NoteMenuState } from './noteMenuActions'

const base: NoteMenuState = {
  language: 'pl',
  hasAudio: false,
  transcriptionIncomplete: false,
  resumable: false,
  processing: false,
  modelReady: true,
  reprocessDisabled: false,
  taskAnalysisBusy: false,
}
const labels = (state: NoteMenuState) => noteMenuActions(state).map((action) => action.label)

test('a plain note offers edit, process again, export and delete', () => {
  expect(labels(base)).toEqual(['Edytuj', 'Opracuj na nowo', 'Eksportuj', 'Usuń'])
  expect(noteMenuActions(base).map((action) => action.key)).toEqual(['edit', 'reprocess', 'export', 'delete'])
})

test('only delete is destructive', () => {
  expect(noteMenuActions({ ...base, hasAudio: true, resumable: true })
    .filter((action) => action.destructive).map((action) => action.key)).toEqual(['delete'])
})

test('an interrupted note adds resume processing', () => {
  expect(labels({ ...base, resumable: true })).toEqual(['Edytuj', 'Wznów opracowanie', 'Opracuj na nowo', 'Eksportuj', 'Usuń'])
})

test('resume follows the screen conditions: not while processing, without the model or with an incomplete transcript', () => {
  for (const change of [{ processing: true }, { modelReady: false }, { transcriptionIncomplete: true }]) {
    expect(labels({ ...base, resumable: true, ...change })).not.toContain('Wznów opracowanie')
  }
})

test('a note with audio adds transcribing the recording again', () => {
  expect(labels({ ...base, hasAudio: true })).toEqual(['Edytuj', 'Opracuj na nowo', 'Przepisz nagranie jeszcze raz', 'Eksportuj', 'Usuń'])
  expect(labels({ ...base, hasAudio: true, transcriptionIncomplete: true })).not.toContain('Przepisz nagranie jeszcze raz')
})

test('an incomplete transcript names the reprocess action as completing it', () => {
  expect(labels({ ...base, transcriptionIncomplete: true })).toContain('Uzupełnij i przetwórz')
})

test('busy or unavailable actions are disabled, not hidden', () => {
  const actions = noteMenuActions({ ...base, hasAudio: true, reprocessDisabled: true, taskAnalysisBusy: true })
  expect(actions.filter((action) => action.disabled).map((action) => action.key)).toEqual(['reprocess', 'retranscribe'])
})

test('labels follow the language', () => {
  expect(labels({ ...base, language: 'en', hasAudio: true, resumable: true })).toEqual([
    'Edit', 'Resume processing', 'Process again', 'Transcribe the recording again', 'Export', 'Delete',
  ])
})
