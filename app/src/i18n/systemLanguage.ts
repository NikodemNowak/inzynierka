import { getLocales } from 'expo-localization'
import { languageFromLocales, type Language } from './language'

export const getSystemLanguage = (): Language =>
  languageFromLocales(getLocales().map((locale) => locale.languageTag))
