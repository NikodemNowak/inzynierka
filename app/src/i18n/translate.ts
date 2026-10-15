import { useSettingsStore } from '../state/settingsStore'
import { selectText, type Language } from './language'
import { getSystemLanguage } from './systemLanguage'

export const getAppLanguage = (): Language => {
  const preference = useSettingsStore.getState().languagePreference
  return preference === 'pl' || preference === 'en'
    ? preference
    : getSystemLanguage()
}

// For errors and operations outside React. Components use useI18n so they
// rerender immediately when the preference or system locale changes.
export const translate = (polish: string, english: string): string =>
  selectText(getAppLanguage(), polish, english)
