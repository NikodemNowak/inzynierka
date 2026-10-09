import type { Language } from '../i18n/language'

// Closed vocabulary: notes are classified into these fixed categories rather
// than tagged with free-form text. Keeps the set small and the filter bounded.
export const NOTE_CATEGORIES = [
  'Praca',
  'Dom',
  'Finanse',
  'Zdrowie',
  'Zakupy',
  'Nauka',
  'Podróże',
  'Pomysły',
] as const

export const isCategory = (value: string): boolean =>
  (NOTE_CATEGORIES as readonly string[]).includes(value)

const ENGLISH_CATEGORIES: Record<(typeof NOTE_CATEGORIES)[number], string> = {
  Praca: 'Work',
  Dom: 'Home',
  Finanse: 'Finance',
  Zdrowie: 'Health',
  Zakupy: 'Shopping',
  Nauka: 'Study',
  Podróże: 'Travel',
  Pomysły: 'Ideas',
}

// Stored identifiers remain stable across interface languages and app upgrades.
export const categoryLabel = (category: string, language: Language): string =>
  language === 'en' && isCategory(category)
    ? ENGLISH_CATEGORIES[category as (typeof NOTE_CATEGORIES)[number]]
    : category
