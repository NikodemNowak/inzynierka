// Keep locale-sensitive fixtures deterministic on every developer machine.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
  useLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
}))

// Legacy source-linked engine tests rely on the pre-point-summary routing;
// the point pipeline's own tests select 'points' explicitly.
require('./src/ai/summaryEngine').setSummaryEngineMode('auto')
