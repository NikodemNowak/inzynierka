import { create } from 'zustand'
import * as repository from '../data/settingsRepository'
import { noteLanguageOrDefault, type Language } from '../i18n/language'

const DRAFT_KEY = 'recording.draft'

export interface RecordingDraft {
  transcript: string
  startedAt: number
  language: Language
}

interface DraftState {
  draft: RecordingDraft | null
  load: () => Promise<void>
  save: (
    transcript: string,
    startedAt: number,
    language?: Language,
  ) => Promise<void>
  clear: () => Promise<void>
}

const parse = (raw: string | null): RecordingDraft | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { transcript, startedAt, language } = value as Partial<RecordingDraft>
    if (typeof transcript !== 'string' || typeof startedAt !== 'number')
      return null
    return transcript.trim().length > 0
      ? { transcript, startedAt, language: noteLanguageOrDefault(language) }
      : null
  } catch {
    return null
  }
}

// Transcript recovery for the legacy foreground speech recorder. Native iOS
// capture keeps its own audio journal and can repair its own partial PCM files;
// neither path promises zero loss after a crash or power failure.
export const useDraftStore = create<DraftState>((set) => ({
  draft: null,
  load: async () => {
    set({ draft: parse(await repository.getSetting(DRAFT_KEY)) })
  },
  save: async (transcript, startedAt, language = 'pl') => {
    if (transcript.trim().length === 0) return
    const draft: RecordingDraft = { transcript, startedAt, language }
    set({ draft })
    await repository.setSetting(DRAFT_KEY, JSON.stringify(draft))
  },
  clear: async () => {
    set({ draft: null })
    await repository.setSetting(DRAFT_KEY, '')
  },
}))
