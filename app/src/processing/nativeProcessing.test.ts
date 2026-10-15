import { requireOptionalNativeModule } from 'expo-modules-core'

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}))
const optionalModule = jest.mocked(requireOptionalNativeModule)
const loadFacade = () => {
  let facade: typeof import('./nativeProcessing') | undefined
  jest.isolateModules(() => {
    facade = jest.requireActual<typeof import('./nativeProcessing')>('./nativeProcessing')
  })
  if (!facade) throw new Error('Facade did not load')
  return facade
}

test('does not advertise a background lease when actual task registration failed', () => {
  optionalModule.mockReturnValueOnce({ getCapabilities: () => ({
    continuedProcessing: true, thermalState: 0, configurationStatus: 'configured',
    registrationStatus: 'registration-failed', gpu: false,
  }) })
  expect(loadFacade().supportsBackgroundProcessing()).toBe(false)
})

test('keeps a configured older native module usable for existing CPU processing', () => {
  optionalModule.mockReturnValueOnce({ getCapabilities: () => ({
    continuedProcessing: true, thermalState: 0, configurationStatus: 'configured',
  }) })
  expect(loadFacade().supportsBackgroundProcessing()).toBe(true)
})

test('does not advertise background processing when the native module is absent', () => {
  optionalModule.mockReturnValueOnce(null)
  expect(loadFacade().supportsBackgroundProcessing()).toBe(false)
})

test('preserves actual GPU support independently of CPU registration failure', () => {
  optionalModule.mockReturnValueOnce({ getCapabilities: () => ({
    continuedProcessing: false, thermalState: 1, gpu: true,
    configurationStatus: 'identifier-mismatch', registrationStatus: 'not-configured',
    supportedResourcesRawValue: 1, osVersion: '27.0.0', appBuild: '6', hardwareModel: 'iPhone18,1',
  }) })
  expect(loadFacade().readProcessingCapabilities()).toMatchObject({
    continuedProcessing: false, gpu: true, gpuUnavailableReason: null,
    osVersion: '27.0.0', appBuild: '6', hardwareModel: 'iPhone18,1',
  })
})

test('reports an absent field in an older module as unknown, not a negative GPU observation', () => {
  optionalModule.mockReturnValueOnce({ getCapabilities: () => ({ continuedProcessing: true, thermalState: 0 }) })
  expect(loadFacade().readProcessingCapabilities()).toMatchObject({
    gpu: null, gpuUnavailableReason: 'native-capability-unavailable', queryError: null,
  })
})

test('a failed native capability query cannot advertise GPU or CPU support', () => {
  optionalModule.mockReturnValueOnce({ getCapabilities: () => { throw new Error('Native unavailable') } })
  expect(loadFacade().readProcessingCapabilities()).toMatchObject({
    continuedProcessing: false, gpu: null, gpuUnavailableReason: 'native-query-failed',
    queryError: 'Native unavailable',
  })
})
