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
