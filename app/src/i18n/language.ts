export type Language = 'pl' | 'en'
export type LanguagePreference = 'system' | Language

export const isLanguage = (value: unknown): value is Language =>
  value === 'pl' || value === 'en'

export const parseLanguagePreference = (value: unknown): LanguagePreference =>
  isLanguage(value) ? value : 'system'

// Older notes were created by the Polish-only application. Their content is
// never translated or relabelled when the interface language changes.
export const noteLanguageOrDefault = (value: unknown): Language =>
  isLanguage(value) ? value : 'pl'

export const languageFromLocales = (locales: readonly string[]): Language => {
  for (const locale of locales) {
    const language = locale.toLowerCase().split(/[-_]/)[0]
    if (isLanguage(language)) return language
  }
  return 'en'
}

export const localeForLanguage = (language: Language): 'pl-PL' | 'en-US' =>
  language === 'pl' ? 'pl-PL' : 'en-US'

export const selectText = (
  language: Language,
  polish: string,
  english: string,
): string => (language === 'pl' ? polish : english)
