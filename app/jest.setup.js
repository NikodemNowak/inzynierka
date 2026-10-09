// Keep locale-sensitive fixtures deterministic on every developer machine.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
  useLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
}))
