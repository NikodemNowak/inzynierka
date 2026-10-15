import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import {
  createGpuDiagnosticReport,
  captureGpuDiagnosticReport,
  listGpuDiagnosticReports,
  saveGpuDiagnosticReport,
  shareGpuDiagnosticReports,
} from './gpuDiagnostics'
import { readProcessingCapabilities } from './nativeProcessing'
import { nativeCapture } from '../stt/nativeCapture'

jest.mock('../stt/nativeCapture', () => ({ nativeCapture: {
  getSpeechCapabilities: jest.fn(async () => ({
    version: 1, analyzerAvailable: true, supportedLocales: ['en-US', 'pl-PL'],
    installedLocales: ['en-US'], locales: {
      'en-US': { recognizerAvailable: true, recognizerOnDevice: true, analyzerSupported: true, analyzerInstalled: true },
      'pl-PL': { recognizerAvailable: true, recognizerOnDevice: true, analyzerSupported: true, analyzerInstalled: false },
    },
  })),
} }))

jest.mock('./nativeProcessing', () => ({
  nativeProcessing: null,
  readProcessingCapabilities: jest.fn(() => ({
    continuedProcessing: true, gpu: false, gpuUnavailableReason: null,
    thermalState: 0, configurationStatus: 'configured', registrationStatus: 'registered',
    taskIdentifierPattern: 'com.nowak.notatki.processing.*',
    supportedResourcesRawValue: 0, osVersion: '27.0', appVersion: '1.0.0', appBuild: '6',
    bundleIdentifier: 'com.nowak.notatki', hardwareModel: 'iPhone18,1', queryError: null,
  })),
}))
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  readDirectoryAsync: jest.fn(async () => []),
  readAsStringAsync: jest.fn(),
}))
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined),
}))

beforeEach(() => { jest.clearAllMocks() })

test('records an actual unsupported device separately from an untested GPU workload', () => {
  const report = createGpuDiagnosticReport('user')
  expect(report).toMatchObject({
    version: 1, method: 'bgtaskscheduler-supported-resources-v1', trigger: 'user',
    capabilities: { gpu: false, osVersion: '27.0', appBuild: '6', hardwareModel: 'iPhone18,1' },
    evaluation: 'unsupported',
    gpuProbe: { status: 'not-run', reason: 'device-unsupported', leaseGranted: null },
    signing: { gpuEntitlement: 'unverified' },
  })
})

test('reported support does not pretend that signing was verified or GPU work was executed', () => {
  jest.mocked(readProcessingCapabilities).mockReturnValueOnce({
    ...readProcessingCapabilities(), gpu: true, supportedResourcesRawValue: 1,
  })
  const report = createGpuDiagnosticReport('user')
  expect(report).toMatchObject({
    evaluation: 'signature-unverified', capabilities: { gpu: true },
    signing: { gpuEntitlement: 'unverified' },
    gpuProbe: { status: 'not-run', reason: 'signature-unverified', leaseGranted: null },
  })
})

test('a missing capability observation stays unknown instead of becoming unsupported', () => {
  jest.mocked(readProcessingCapabilities).mockReturnValueOnce({
    ...readProcessingCapabilities(), gpu: null, gpuUnavailableReason: 'unsupported-build',
  })
  expect(createGpuDiagnosticReport('automatic')).toMatchObject({
    evaluation: 'unknown', capabilities: { gpu: null, gpuUnavailableReason: 'unsupported-build' },
    gpuProbe: { status: 'not-run', reason: 'capability-unknown' },
  })
})

test('persists an automatic observation atomically and returns the saved report', async () => {
  const report = await captureGpuDiagnosticReport('automatic')
  const target = `file:///documents/processing-diagnostics/${report.id}.json`
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(`${target}.part`, JSON.stringify(report))
  expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: `${target}.part`, to: target })
  expect(report.trigger).toBe('automatic')
})

test('propagates a failed durable write instead of claiming the diagnostic was saved', async () => {
  jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error('Storage full'))
  await expect(captureGpuDiagnosticReport('user')).rejects.toThrow('Storage full')
  expect(FileSystem.moveAsync).not.toHaveBeenCalled()
})

test('rejects report names that escape the diagnostic directory before writing', async () => {
  const report = { ...createGpuDiagnosticReport('user'), id: '../notes' }
  await expect(saveGpuDiagnosticReport(report)).rejects.toThrow('Invalid diagnostic id')
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
})

test('skips incomplete and corrupt reports while preserving valid saved diagnostics', async () => {
  const older = { ...createGpuDiagnosticReport('user'), id: 'gpu-old', createdAt: 10 }
  const newer = { ...createGpuDiagnosticReport('automatic'), id: 'gpu-new', createdAt: 20 }
  jest.mocked(FileSystem.readDirectoryAsync).mockResolvedValueOnce([
    'gpu-old.json', 'gpu-new.json', 'gpu-broken.json', 'gpu-write.json.part', 'other.json',
  ])
  jest.mocked(FileSystem.readAsStringAsync).mockImplementation(async (path) =>
    path.includes('gpu-old') ? JSON.stringify(older)
      : path.includes('gpu-new') ? JSON.stringify(newer) : '{invalid',
  )
  expect(await listGpuDiagnosticReports()).toEqual([newer, older])
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(3)
})

test('exports capability evidence even when no LLM benchmark has completed', async () => {
  jest.mocked(FileSystem.readDirectoryAsync).mockResolvedValueOnce([])
  await shareGpuDiagnosticReports()
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    'file:///cache/notatki-background-gpu-diagnostics.json',
    expect.stringContaining('"reports": []'),
  )
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///cache/notatki-background-gpu-diagnostics.json',
    expect.objectContaining({ mimeType: 'application/json' }),
  )
})

test('does not invoke a system share sheet when sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false)
  await expect(shareGpuDiagnosticReports()).rejects.toThrow(/niedostępne|unavailable/)
  expect(Sharing.shareAsync).not.toHaveBeenCalled()
})

test('captures installed speech locales without making an asset download request', async () => {
  expect(await captureGpuDiagnosticReport('user')).toMatchObject({
    speech: { capabilities: {
      analyzerAvailable: true, installedLocales: ['en-US'],
      locales: { 'pl-PL': { analyzerSupported: true, analyzerInstalled: false } },
    }, queryError: null },
  })
  expect(nativeCapture?.getSpeechCapabilities).toHaveBeenCalledTimes(1)
})

test('a failed speech capability query does not hide the GPU observation', async () => {
  jest.mocked(nativeCapture!.getSpeechCapabilities!).mockRejectedValueOnce(new Error('Speech query unavailable'))
  expect(await captureGpuDiagnosticReport('user')).toMatchObject({
    capabilities: { gpu: false },
    speech: { capabilities: null, queryError: 'Speech query unavailable' },
  })
})
