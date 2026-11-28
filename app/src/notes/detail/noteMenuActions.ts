import { selectText, type Language } from '../../i18n/language'

export type NoteMenuKey = 'edit' | 'resume' | 'reprocess' | 'retranscribe' | 'export' | 'delete'

export interface NoteMenuAction {
  readonly key: NoteMenuKey
  readonly label: string
  readonly destructive?: boolean
  readonly disabled?: boolean
}

export interface NoteMenuState {
  readonly language: Language
  readonly hasAudio: boolean
  readonly transcriptionIncomplete: boolean
  // A processing run was interrupted and can continue from its checkpoint.
  readonly resumable: boolean
  readonly processing: boolean
  readonly modelReady: boolean
  readonly reprocessDisabled: boolean
  readonly taskAnalysisBusy: boolean
}

// The "…" menu of a note, in display order.
export const noteMenuActions = (state: NoteMenuState): NoteMenuAction[] => {
  const t = (pl: string, en: string): string => selectText(state.language, pl, en)
  const canResume = state.resumable && !state.processing && state.modelReady && !state.transcriptionIncomplete
  const canRetranscribe = state.hasAudio && !state.transcriptionIncomplete
  return [
    { key: 'edit', label: t('Edytuj', 'Edit') },
    ...(canResume ? [{ key: 'resume' as const, label: t('Wznów opracowanie', 'Resume processing') }] : []),
    { key: 'reprocess', label: state.transcriptionIncomplete ? t('Uzupełnij i przetwórz', 'Complete and process') : t('Opracuj na nowo', 'Process again'), disabled: state.reprocessDisabled },
    ...(canRetranscribe
      ? [{ key: 'retranscribe' as const, label: t('Przepisz nagranie jeszcze raz', 'Transcribe the recording again'), disabled: state.taskAnalysisBusy }]
      : []),
    { key: 'export', label: t('Eksportuj', 'Export') },
    { key: 'delete', label: t('Usuń', 'Delete'), destructive: true },
  ]
}
