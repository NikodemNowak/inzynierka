// Keep locale-sensitive fixtures deterministic on every developer machine.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
  useLocales: jest.fn(() => [{ languageTag: 'pl-PL', languageCode: 'pl' }]),
}))

// Expo installs `fetch` as a lazy global. If a test never used it, Jest's teardown
// would trigger the getter after the tests finished and log a module error, so an
// untouched getter is dropped once the file is done.
afterAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  if (descriptor?.get && descriptor.configurable)
    Object.defineProperty(globalThis, 'fetch', {
      value: undefined,
      configurable: true,
      writable: true,
    })
})

// Legacy source-linked engine tests rely on the pre-point-summary routing;
// the point pipeline's own tests select 'points' explicitly.
require('./src/ai/summaryEngine').setSummaryEngineMode('auto')
