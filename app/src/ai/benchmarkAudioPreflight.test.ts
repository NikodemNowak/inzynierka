import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { AppState } from 'react-native'
import { nativeCapture, type NativeSpeechCapabilities } from '../stt/nativeCapture'
import { prepareBenchmarkAudio } from './benchmarkAudio'

jest.mock('./llm', () => ({
  GenerationCancelledError: class extends Error {
    constructor() { super('Generation cancelled') }
  },
}))
jest.mock('../stt/nativeCapture', () => ({
  nativeCapture: {
    transcribeWindowWithBackend: jest.fn(),
    getSpeechCapabilities: jest.fn(),
  },
}))
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    getSpeechRecognizerPermissionsAsync: jest.fn(),
    requestSpeechRecognizerPermissionsAsync: jest.fn(),
    supportsOnDeviceRecognition: jest.fn(),
  },
}))
jest.mock('../i18n/translate', () => ({ translate: (_pl: string, en: string) => en }))

const installedAnalyzer = (): NativeSpeechCapabilities => ({
  version: 1,
  analyzerAvailable: true,
  supportedLocales: ['en-US'],
  installedLocales: ['en-US'],
  locales: {
    'en-US': {
      recognizerAvailable: false,
      recognizerOnDevice: false,
      analyzerSupported: true,
      analyzerInstalled: true,
    },
  },
})
const permission = (granted: boolean) => ({
  granted, status: granted ? 'granted' : 'denied', canAskAgain: false, expires: 'never',
}) as Awaited<ReturnType<typeof ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync>>

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true })
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue(installedAnalyzer())
  jest.mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync).mockResolvedValue(permission(false))
  jest.mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition).mockReturnValue(false)
})

test('allows an installed analyzer when legacy speech permission was denied', async () => {
  await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).resolves.toBeUndefined()
  expect(ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync).not.toHaveBeenCalled()
})

test('allows an installed analyzer when the legacy on-device recognizer is unsupported', async () => {
  jest.mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync).mockResolvedValue(permission(true))
  await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).resolves.toBeUndefined()
})

test.each(['device-unavailable', 'locale-unsupported', 'assets-uninstalled'] as const)(
  'keeps denied legacy permission blocking fallback when analyzer is %s', async (reason) => {
    const capabilities = installedAnalyzer()
    if (reason === 'device-unavailable') capabilities.analyzerAvailable = false
    if (reason === 'locale-unsupported') capabilities.locales['en-US'].analyzerSupported = false
    if (reason === 'assets-uninstalled') capabilities.locales['en-US'].analyzerInstalled = false
    jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue(capabilities)
    await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).rejects.toThrow(/permission/i)
  },
)

test('keeps the local-only recognizer gate when analyzer assets are absent', async () => {
  const capabilities = installedAnalyzer()
  capabilities.locales['en-US'].analyzerInstalled = false
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue(capabilities)
  jest.mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync).mockResolvedValue(permission(true))
  await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).rejects.toThrow(/on-device/i)
})

test('allows legacy fallback only when its existing permission and local recognizer gates pass', async () => {
  const capabilities = installedAnalyzer()
  capabilities.locales['en-US'].analyzerInstalled = false
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockResolvedValue(capabilities)
  jest.mocked(ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync).mockResolvedValue(permission(true))
  jest.mocked(ExpoSpeechRecognitionModule.supportsOnDeviceRecognition).mockReturnValue(true)
  await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).resolves.toBeUndefined()
})

test('does not let installed analyzer assets authorize a default recognizer run', async () => {
  await expect(prepareBenchmarkAudio('en-US')).rejects.toThrow(/permission/i)
})

test('keeps legacy permission required when the native capability query fails', async () => {
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockRejectedValueOnce(new Error('Capability query failed'))
  await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).rejects.toThrow(/permission/i)
})

test('cannot authorize analyzer work on an older native binary without its backend entrypoint', async () => {
  const entrypoint = nativeCapture!.transcribeWindowWithBackend
  delete nativeCapture!.transcribeWindowWithBackend
  try {
    await expect(prepareBenchmarkAudio('en-US', undefined, 'analyzer-if-installed')).rejects.toThrow(/permission/i)
  } finally {
    nativeCapture!.transcribeWindowWithBackend = entrypoint
  }
})

test('honors cancellation that arrives while native analyzer availability is being checked', async () => {
  const controller = new AbortController()
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockImplementationOnce(async () => {
    controller.abort()
    return installedAnalyzer()
  })
  await expect(prepareBenchmarkAudio('en-US', controller.signal, 'analyzer-if-installed')).rejects.toThrow(/cancel/i)
})
