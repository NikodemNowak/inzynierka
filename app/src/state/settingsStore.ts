import { create } from 'zustand'
import * as repository from '../data/settingsRepository'
import type { NoteSortMode } from '../notes/noteListView'

const SORT_MODE_KEY = 'notes.sortMode'

interface SettingsState {
  sortMode: NoteSortMode
  load: () => Promise<void>
  setSortMode: (mode: NoteSortMode) => Promise<void>
}

const isSortMode = (value: string | null): value is NoteSortMode =>
  value === 'updated' || value === 'created'

export const useSettingsStore = create<SettingsState>((set) => ({
  sortMode: 'updated',
  load: async () => {
    const stored = await repository.getSetting(SORT_MODE_KEY)
    if (isSortMode(stored)) set({ sortMode: stored })
  },
  setSortMode: async (mode) => {
    set({ sortMode: mode })
    await repository.setSetting(SORT_MODE_KEY, mode)
  },
}))
