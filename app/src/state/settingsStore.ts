import { create } from 'zustand'
import * as repository from '../data/settingsRepository'
import type { NoteSortMode } from '../notes/noteListView'
import {
  parseAppearancePreference,
  synchronizeNativeAppearance,
} from '../ui/appearance'
import type { AppearancePreference } from '../ui/appearance'
import {
  isLanguage,
  parseLanguagePreference,
  type Language,
  type LanguagePreference,
} from '../i18n/language'
import { getSystemLanguage } from '../i18n/systemLanguage'

const SORT_MODE_KEY = 'notes.sortMode'
const ONBOARDING_KEY = 'onboarding.completed'
const APPEARANCE_KEY = 'appearance.preference'
const LANGUAGE_KEY = 'language.interface'
const NOTE_LANGUAGE_KEY = 'language.note'
const BACKGROUND_PROCESSING_KEY = 'processing.background'

let appearanceWriteVersion = 0
let languageWriteVersion = 0
let noteLanguageWriteVersion = 0
let languageWrites: Promise<void> = Promise.resolve()
let noteLanguageWrites: Promise<void> = Promise.resolve()
let pendingLanguageWrites = 0
let pendingNoteLanguageWrites = 0
let savedLanguagePreference: LanguagePreference = 'system'
let savedNoteLanguage: Language = getSystemLanguage()

interface SettingsState {
  sortMode: NoteSortMode
  onboardingCompleted: boolean
  appearancePreference: AppearancePreference
  languagePreference: LanguagePreference
  noteLanguage: Language
  backgroundProcessing: boolean
  setBackgroundProcessing: (enabled: boolean) => Promise<void>
  // Until settings are read, the app cannot tell a first run from a later one,
  // so screens wait rather than flashing the welcome screen at every launch.
  loaded: boolean
  load: () => Promise<void>
  setSortMode: (mode: NoteSortMode) => Promise<void>
  setAppearancePreference: (preference: AppearancePreference) => Promise<void>
  setLanguagePreference: (preference: LanguagePreference) => Promise<void>
  setNoteLanguage: (language: Language) => Promise<void>
  completeOnboarding: () => Promise<void>
}

const isSortMode = (value: string | null): value is NoteSortMode =>
  value === 'updated' || value === 'created'

export const useSettingsStore = create<SettingsState>((set, get) => ({
  sortMode: 'updated',
  onboardingCompleted: false,
  appearancePreference: 'system',
  languagePreference: 'system',
  noteLanguage: getSystemLanguage(),
  backgroundProcessing: false,
  setBackgroundProcessing: async (enabled) => {
    await repository.setSetting(BACKGROUND_PROCESSING_KEY, enabled ? '1' : '0')
    set({ backgroundProcessing: enabled })
  },
  loaded: false,
  load: async () => {
    const [
      storedSort,
      storedOnboarding,
      storedAppearance,
      storedLanguage,
      storedNoteLanguage,
      storedBackgroundProcessing,
    ] = await Promise.all([
      repository.getSetting(SORT_MODE_KEY),
      repository.getSetting(ONBOARDING_KEY),
      repository.getSetting(APPEARANCE_KEY),
      repository.getSetting(LANGUAGE_KEY),
      repository.getSetting(NOTE_LANGUAGE_KEY),
      repository.getSetting(BACKGROUND_PROCESSING_KEY),
    ])
    const appearancePreference = parseAppearancePreference(storedAppearance)
    synchronizeNativeAppearance(appearancePreference)
    set({
      sortMode: isSortMode(storedSort) ? storedSort : 'updated',
      onboardingCompleted: storedOnboarding === '1',
      appearancePreference,
      languagePreference: parseLanguagePreference(storedLanguage),
      noteLanguage: isLanguage(storedNoteLanguage)
        ? storedNoteLanguage
        : getSystemLanguage(),
      loaded: true,
      backgroundProcessing: storedBackgroundProcessing === '1',
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
  setLanguagePreference: async (preference) => {
    if (pendingLanguageWrites === 0)
      savedLanguagePreference = get().languagePreference
    pendingLanguageWrites += 1
    const version = ++languageWriteVersion
    set({ languagePreference: preference })
    const write = languageWrites
      .catch(() => undefined)
      .then(() => repository.setSetting(LANGUAGE_KEY, preference))
    languageWrites = write
    try {
      await write
      savedLanguagePreference = preference
    } catch (error) {
      if (version === languageWriteVersion)
        set({ languagePreference: savedLanguagePreference })
      throw error
    } finally {
      pendingLanguageWrites -= 1
    }
  },
  setNoteLanguage: async (language) => {
    if (pendingNoteLanguageWrites === 0) savedNoteLanguage = get().noteLanguage
    pendingNoteLanguageWrites += 1
    const version = ++noteLanguageWriteVersion
    set({ noteLanguage: language })
    const write = noteLanguageWrites
      .catch(() => undefined)
      .then(() => repository.setSetting(NOTE_LANGUAGE_KEY, language))
    noteLanguageWrites = write
    try {
      await write
      savedNoteLanguage = language
    } catch (error) {
      if (version === noteLanguageWriteVersion)
        set({ noteLanguage: savedNoteLanguage })
      throw error
    } finally {
      pendingNoteLanguageWrites -= 1
    }
  },
}))
