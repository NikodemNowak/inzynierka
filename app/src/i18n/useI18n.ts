import { useMemo } from 'react'
import { useLocales } from 'expo-localization'
import { useSettingsStore } from '../state/settingsStore'
import { languageFromLocales, localeForLanguage, selectText } from './language'

export const useI18n = () => {
  const preference = useSettingsStore((state) => state.languagePreference)
  const locales = useLocales()
  const language =
    preference === 'system'
      ? languageFromLocales(locales.map((locale) => locale.languageTag))
      : preference
  return useMemo(
    () => ({
      language,
      locale: localeForLanguage(language),
      t: (polish: string, english: string): string =>
        selectText(language, polish, english),
    }),
    [language],
  )
}
