import { create } from 'zustand'
import * as repository from '../data/settingsRepository'
import type { NoteSortMode } from '../notes/noteListView'
import {
  parseAppearancePreference,
  synchronizeNativeAppearance,
} from '../ui/appearance'
import type { AppearancePreference } from '../ui/appearance'

const SORT_MODE_KEY = 'notes.sortMode'
const ONBOARDING_KEY = 'onboarding.completed'
const APPEARANCE_KEY = 'appearance.preference'

let appearanceWriteVersion = 0

interface SettingsState {
  sortMode: NoteSortMode
  onboardingCompleted: boolean
  appearancePreference: AppearancePreference
  // Until settings are read, the app cannot tell a first run from a later one,
  // so screens wait rather than flashing the welcome screen at every launch.
  loaded: boolean
  load: () => Promise<void>
  setSortMode: (mode: NoteSortMode) => Promise<void>
  setAppearancePreference: (preference: AppearancePreference) => Promise<void>
  completeOnboarding: () => Promise<void>
}

const isSortMode = (value: string | null): value is NoteSortMode =>
  value === 'updated' || value === 'created'

export const useSettingsStore = create<SettingsState>((set, get) => ({
  sortMode: 'updated',
  onboardingCompleted: false,
  appearancePreference: 'system',
  loaded: false,
  load: async () => {
    const [storedSort, storedOnboarding, storedAppearance] = await Promise.all([
      repository.getSetting(SORT_MODE_KEY),
      repository.getSetting(ONBOARDING_KEY),
      repository.getSetting(APPEARANCE_KEY),
    ])
    const appearancePreference = parseAppearancePreference(storedAppearance)
    synchronizeNativeAppearance(appearancePreference)
    set({
      sortMode: isSortMode(storedSort) ? storedSort : 'updated',
      onboardingCompleted: storedOnboarding === '1',
      appearancePreference,
      loaded: true,
    })
  },
  setSortMode: async (mode) => {
    set({ sortMode: mode })
    await repository.setSetting(SORT_MODE_KEY, mode)
  },
  setAppearancePreference: async (preference) => {
    const previousPreference = get().appearancePreference
    const writeVersion = ++appearanceWriteVersion
    set({ appearancePreference: preference })
    synchronizeNativeAppearance(preference)
    try {
      await repository.setSetting(APPEARANCE_KEY, preference)
    } catch (error) {
      if (appearanceWriteVersion === writeVersion) {
        set({ appearancePreference: previousPreference })
        synchronizeNativeAppearance(previousPreference)
      }
      throw error
    }
  },
  completeOnboarding: async () => {
    set({ onboardingCompleted: true })
    await repository.setSetting(ONBOARDING_KEY, '1')
  },
}))
