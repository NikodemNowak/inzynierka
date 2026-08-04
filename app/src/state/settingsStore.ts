import { create } from 'zustand'
import * as repository from '../data/settingsRepository'
import type { NoteSortMode } from '../notes/noteListView'

const SORT_MODE_KEY = 'notes.sortMode'
const ONBOARDING_KEY = 'onboarding.completed'

interface SettingsState {
  sortMode: NoteSortMode
  onboardingCompleted: boolean
  // Until settings are read, the app cannot tell a first run from a later one,
  // so screens wait rather than flashing the welcome screen at every launch.
  loaded: boolean
  load: () => Promise<void>
  setSortMode: (mode: NoteSortMode) => Promise<void>
  completeOnboarding: () => Promise<void>
}

const isSortMode = (value: string | null): value is NoteSortMode =>
  value === 'updated' || value === 'created'

export const useSettingsStore = create<SettingsState>((set) => ({
  sortMode: 'updated',
  onboardingCompleted: false,
  loaded: false,
  load: async () => {
    const [storedSort, storedOnboarding] = await Promise.all([
      repository.getSetting(SORT_MODE_KEY),
      repository.getSetting(ONBOARDING_KEY),
    ])
    set({
      sortMode: isSortMode(storedSort) ? storedSort : 'updated',
      onboardingCompleted: storedOnboarding === '1',
      loaded: true,
    })
  },
  setSortMode: async (mode) => {
    set({ sortMode: mode })
    await repository.setSetting(SORT_MODE_KEY, mode)
  },
  completeOnboarding: async () => {
    set({ onboardingCompleted: true })
    await repository.setSetting(ONBOARDING_KEY, '1')
  },
}))
