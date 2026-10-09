import { requireOptionalNativeModule } from 'expo-modules-core'
import type { NativeSpeechWindowDiagnostics } from './nativeCapture'

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}))
const optionalModule = jest.mocked(requireOptionalNativeModule)
const args = ['file:///audio.wav', 0, 1000, 'en-US', 'request-1'] as const
const rawModule = () => ({
  start: jest.fn(), stop: jest.fn(), resume: jest.fn(), getSnapshot: jest.fn(), recoverSessions: jest.fn(),
  markMaterialized: jest.fn(), deleteCaptureAudio: jest.fn(), inspectAudio: jest.fn(),
  cancelTranscription: jest.fn(), addListener: jest.fn(), transcribeWindow: jest.fn(),
})
const loadFacade = () => {
  let facade: typeof import('./nativeCapture') | undefined
  jest.isolateModules(() => { facade = jest.requireActual<typeof import('./nativeCapture')>('./nativeCapture') })
  if (!facade) throw new Error('Facade did not load')
  return facade.nativeCapture
}

test('keeps missing native support optional', () => {
  optionalModule.mockReturnValueOnce(null)
  expect(loadFacade()).toBeNull()
})
test('normalizes old native string results without fabricating diagnostics', async () => {
  const raw = rawModule()
  raw.transcribeWindow.mockResolvedValue('Actual old-native speech')
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  expect(await facade.transcribeWindow(...args)).toBe('Actual old-native speech')
  expect(await facade.transcribeWindowWithDiagnostics(...args)).toEqual({ transcript: 'Actual old-native speech' })
  expect(raw.transcribeWindow).toHaveBeenCalledWith(...args)
})
test('keeps ordinary import text and exposes only the actual inline native diagnostics', async () => {
  const diagnostics: NativeSpeechWindowDiagnostics = {
    version: 1, requestedStartMs: 0, requestedDurationMs: 1000, decodedFrames: 16000,
    decodedDurationMs: 1000, decodedSampleRate: 16000, callbackCount: 2, finalCallbackCount: 1,
    finalLikeCallbackCount: 2, untimedCallbackCount: 0, mergedSegmentCount: 3,
    callbacksTruncated: false, callbacks: [], requestTaskHintRawValue: 1,
  }
  const raw = rawModule()
  raw.transcribeWindow.mockResolvedValue({ transcript: 'Observed source speech', diagnostics })
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  expect(await facade.transcribeWindow(...args)).toBe('Observed source speech')
  expect(await facade.transcribeWindowWithDiagnostics(...args)).toEqual({ transcript: 'Observed source speech', diagnostics })
  expect((await facade.transcribeWindowWithDiagnostics(...args)).diagnostics).toBe(diagnostics)
})
test('forwards cancellation and capture methods with the original receiver', async () => {
  const raw = rawModule()
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  await facade.cancelTranscription('request-1')
  await facade.start('capture-1', 'en')
  expect(raw.cancelTranscription).toHaveBeenCalledWith('request-1')
  expect(raw.start).toHaveBeenCalledWith('capture-1', 'en')
  expect(raw.start.mock.contexts[0]).toBe(raw)
})
test('does not hide a native interruption or accept a malformed native result', async () => {
  const raw = rawModule()
  raw.transcribeWindow.mockRejectedValueOnce(new Error('Transcription cancelled')).mockResolvedValueOnce({ transcript: 42 })
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  await expect(facade.transcribeWindowWithDiagnostics(...args)).rejects.toThrow('Transcription cancelled')
  await expect(facade.transcribeWindow(...args)).rejects.toThrow('invalid result')
})
test('rejects native failure envelopes while retaining only actual partial text and request diagnostics', async () => {
  const raw = rawModule()
  const diagnostics = { version: 1, callbackCount: 3, requestTaskHintRawValue: 1 }
  raw.transcribeWindow.mockResolvedValue({ transcript: 'Observed partial speech', diagnostics, error: 'Transcription cancelled' })
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  await expect(facade.transcribeWindowWithDiagnostics(...args)).rejects.toMatchObject({
    name: 'NativeSpeechWindowError', message: 'Transcription cancelled', transcript: 'Observed partial speech', diagnostics,
  })
  await expect(facade.transcribeWindow(...args)).rejects.toThrow('Transcription cancelled')
})

test('uses the explicit experimental backend without changing ordinary imports', async () => {
  const raw = { ...rawModule(), transcribeWindowWithBackend: jest.fn(), getSpeechCapabilities: jest.fn() }
  raw.transcribeWindow.mockResolvedValue('Legacy import speech')
  raw.transcribeWindowWithBackend.mockResolvedValue({ transcript: 'Actual analyzer speech', diagnostics: { backend: 'analyzer' } })
  raw.getSpeechCapabilities.mockResolvedValue({ version: 1, analyzerAvailable: true, supportedLocales: ['en-US'], installedLocales: ['en-US'], locales: {} })
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()!
  expect(facade).toHaveProperty('transcribeWindowWithBackend')
  const experimental = facade as typeof facade & {
    transcribeWindowWithBackend: (...values: [...typeof args, 'analyzer-if-installed']) => Promise<unknown>
    getSpeechCapabilities: () => Promise<unknown>
  }
  await expect(experimental.transcribeWindowWithBackend(...args, 'analyzer-if-installed')).resolves.toMatchObject({ transcript: 'Actual analyzer speech' })
  expect(raw.transcribeWindowWithBackend).toHaveBeenCalledWith(...args, 'analyzer-if-installed')
  expect(raw.transcribeWindowWithBackend.mock.contexts[0]).toBe(raw)
  expect(await facade.transcribeWindow(...args)).toBe('Legacy import speech')
  expect(await experimental.getSpeechCapabilities()).toMatchObject({ installedLocales: ['en-US'] })
})

test('keeps experimental support absent on older native binaries', () => {
  optionalModule.mockReturnValueOnce(rawModule())
  const facade = loadFacade()!
  expect(facade).not.toHaveProperty('transcribeWindowWithBackend')
  expect(facade).not.toHaveProperty('getSpeechCapabilities')
})

test('experimental failure retains the observed source instead of falling back to legacy speech', async () => {
  const raw = { ...rawModule(), transcribeWindowWithBackend: jest.fn() }
  raw.transcribeWindowWithBackend.mockResolvedValue({ transcript: 'Actual partial analyzer speech', diagnostics: { backend: 'analyzer' }, error: 'Analyzer interrupted' })
  optionalModule.mockReturnValueOnce(raw)
  const facade = loadFacade()! as NonNullable<ReturnType<typeof loadFacade>> & {
    transcribeWindowWithBackend: (...values: [...typeof args, 'analyzer-if-installed']) => Promise<unknown>
  }
  await expect(facade.transcribeWindowWithBackend(...args, 'analyzer-if-installed')).rejects.toMatchObject({
    name: 'NativeSpeechWindowError', transcript: 'Actual partial analyzer speech', message: 'Analyzer interrupted', diagnostics: { backend: 'analyzer' },
  })
  expect(raw.transcribeWindow).not.toHaveBeenCalled()
})

test('preserves independent installed-locale and configured-asset readiness from the actual native observation', async () => {
  const readiness = { requestedLocale: 'en-US', resolvedLocale: 'en_US', deviceAvailable: true,
    localeSupported: true, localeInstalled: true, assetStatus: 'supported', ready: false,
    fallbackReason: 'analyzer-assets-not-ready' }
  const capabilities = { version: 1, analyzerAvailable: true, supportedLocales: ['en_US'], installedLocales: ['en_US'],
    locales: { 'en-US': { recognizerAvailable: true, recognizerOnDevice: true, analyzerSupported: true,
      analyzerInstalled: false, analyzerReadiness: readiness } } }
  const raw = { ...rawModule(), getSpeechCapabilities: jest.fn(async () => capabilities) }
  optionalModule.mockReturnValueOnce(raw)
  const observed = await loadFacade()!.getSpeechCapabilities!()
  expect(observed).toBe(capabilities)
  expect(observed.locales['en-US']).toMatchObject({ analyzerInstalled: false,
    analyzerReadiness: { localeInstalled: true, assetStatus: 'supported', ready: false } })
})
