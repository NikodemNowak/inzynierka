import { categoryLabel } from '../domain/categories'
import {
  languageFromLocales,
  localeForLanguage,
  noteLanguageOrDefault,
  parseLanguagePreference,
} from './language'

test('uses the first supported system language with an English fallback', () => {
  expect(languageFromLocales(['de-DE', 'pl-PL', 'en-US'])).toBe('pl')
  expect(languageFromLocales(['en-GB', 'pl-PL'])).toBe('en')
  expect(languageFromLocales(['PL_pl'])).toBe('pl')
  expect(languageFromLocales(['de-DE'])).toBe('en')
})

test('preserves the Polish language of legacy notes independently of system locale', () => {
  expect(noteLanguageOrDefault(undefined)).toBe('pl')
  expect(noteLanguageOrDefault('en')).toBe('en')
  expect(parseLanguagePreference('invalid')).toBe('system')
  expect(localeForLanguage('en')).toBe('en-US')
})

test('translates category labels without changing stored values', () => {
  expect(categoryLabel('Nauka', 'en')).toBe('Study')
  expect(categoryLabel('Nauka', 'pl')).toBe('Nauka')
  expect(categoryLabel('My custom category', 'en')).toBe('My custom category')
})
