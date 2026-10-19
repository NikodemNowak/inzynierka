import type { Language } from '../i18n/language'

// Word handling shared by the notes index and the question: lower case, no
// diacritics (speech recognizers are not consistent with them) and a light stem,
// because Polish inflects a word into many forms ("dentysta", "dentysty", "dentyście").

const STOP = new Set([
  // Polish
  'i', 'a', 'w', 'we', 'z', 'ze', 'na', 'do', 'od', 'o', 'u', 'po', 'za', 'dla', 'przy', 'bez', 'nad', 'pod', 'przez',
  'to', 'ten', 'ta', 'te', 'tego', 'tej', 'tym', 'jest', 'sa', 'byl', 'byla', 'bylo', 'bede', 'mam', 'masz', 'ma', 'mamy',
  'sie', 'nie', 'tak', 'czy', 'co', 'jak', 'kiedy', 'gdzie', 'ile', 'ktory', 'ktora', 'ktore', 'jaki', 'jaka', 'jakie',
  'mi', 'mnie', 'moj', 'moja', 'moje', 'ja', 'ty', 'on', 'ona', 'oni', 'my', 'wy', 'ze', 'zeby', 'ale', 'wiec', 'bo',
  'ktorej', 'ktorego', 'ktorym', 'ktorzy', 'jakiej', 'jakim', 'tez', 'juz', 'jeszcze', 'tylko', 'no', 'jakis', 'jakas', 'sobie', 'trzeba', 'musze', 'mozna', 'czyli', 'potem',
  // English
  'the', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be',
  'i', 'me', 'my', 'you', 'your', 'it', 'its', 'this', 'that', 'do', 'does', 'did', 'have', 'has', 'had', 'what', 'when',
  'where', 'which', 'who', 'how', 'much', 'many', 'about', 'any', 'there', 'so', 'just', 'need', 'should', 'will', 'can',
])

export const plain = (text: string): string =>
  text.toLowerCase().replace(/ł/gu, 'l').normalize('NFD').replace(/[̀-ͯ]/gu, '')

// Long words keep 6 letters, shorter 5: enough to join inflected forms without
// merging unrelated words. Numbers stay whole.
export const stem = (word: string): string => (/^\d/u.test(word) ? word : word.slice(0, word.length >= 8 ? 6 : 5))

export const terms = (text: string): string[] =>
  (plain(text).match(/[a-z]+|\d+(?:[:.,]\d+)?/gu) ?? [])
    .filter((word) => /^\d/u.test(word) || (word.length >= 3 && !STOP.has(word)))
    .map((word) => stem(word.replace(/,/gu, '.')))

const POLISH_HINT = /[ąćęłńóśźż]|\b(?:czy|jak|kiedy|gdzie|ile|mam|jest|jutro|dzisiaj|się|co|który|jaki|mój|moja|zadania|notatk)\b/iu
const ENGLISH_HINT = /\b(?:what|when|where|which|who|how|do|does|did|my|the|is|are|tomorrow|today|have|need)\b/iu

// The answer follows the language of the question; the app language breaks ties.
export const questionLanguage = (question: string, fallback: Language): Language => {
  const pl = POLISH_HINT.test(question)
  const en = ENGLISH_HINT.test(question)
  if (pl && !en) return 'pl'
  if (en && !pl) return 'en'
  return fallback
}
