import { create } from 'zustand'
import * as repository from '../data/settingsRepository'

const DRAFT_KEY = 'recording.draft'

export interface RecordingDraft {
  transcript: string
  startedAt: number
}

interface DraftState {
  draft: RecordingDraft | null
  load: () => Promise<void>
  save: (transcript: string, startedAt: number) => Promise<void>
  clear: () => Promise<void>
}

const parse = (raw: string | null): RecordingDraft | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { transcript, startedAt } = value as Partial<RecordingDraft>
    if (typeof transcript !== 'string' || typeof startedAt !== 'number') return null
    return transcript.trim().length > 0 ? { transcript, startedAt } : null
  } catch {
    return null
  }
}

// Written while recording so that a recording interrupted by the system — a
// crash, a low-memory kill, a battery running out — costs the user nothing.
// Text only: audio files of an interrupted session are left half-written by the
// recorder and are not worth pretending to recover.
export const useDraftStore = create<DraftState>((set) => ({
  draft: null,
  load: async () => {
    set({ draft: parse(await repository.getSetting(DRAFT_KEY)) })
  },
  save: async (transcript, startedAt) => {
    if (transcript.trim().length === 0) return
    const draft: RecordingDraft = { transcript, startedAt }
    set({ draft })
    await repository.setSetting(DRAFT_KEY, JSON.stringify(draft))
  },
  clear: async () => {
    set({ draft: null })
    await repository.setSetting(DRAFT_KEY, '')
  },
}))
