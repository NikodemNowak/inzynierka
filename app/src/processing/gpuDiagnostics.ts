import { AppState, Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { translate } from '../i18n/translate'
import { nativeCapture, type NativeSpeechCapabilities } from '../stt/nativeCapture'
import {
  nativeProcessing,
  readProcessingCapabilities,
  type ProcessingCapabilities,
  type ProcessingLeaseDiagnostic,
} from './nativeProcessing'

export interface GpuDiagnosticReport {
  version: 1
  id: string
  method: 'bgtaskscheduler-supported-resources-v1'
  trigger: 'automatic' | 'user' | 'benchmark'
  createdAt: number
  environment: {
    platform: string
    platformVersion: string
    appState: string | null
    appMode: 'development' | 'release'
  }
  capabilities: ProcessingCapabilities
  evaluation: 'unsupported' | 'signature-unverified' | 'unknown'
  signing: { gpuEntitlement: 'unverified' }
  gpuProbe: {
    status: 'not-run'
    reason: 'device-unsupported' | 'signature-unverified' | 'capability-unknown'
    leaseGranted: null
  }
  leaseDiagnostics: ProcessingLeaseDiagnostic[]
  leaseDiagnosticsError?: string
  speech?: {
    capabilities: NativeSpeechCapabilities | null
    queryError: string | null
  }
}

let diagnosticSequence = 0
const directory = (): string => {
  if (!FileSystem.documentDirectory) throw new Error('Diagnostic storage is unavailable')
  return `${FileSystem.documentDirectory}processing-diagnostics/`
}

// This is a device/OS capability observation. It neither validates a signature
// nor submits work to Metal. A missing observation must never become false.
export const createGpuDiagnosticReport = (
  trigger: GpuDiagnosticReport['trigger'],
): GpuDiagnosticReport => {
  const capabilities = readProcessingCapabilities()
  let leaseDiagnostics: ProcessingLeaseDiagnostic[] = []
  let leaseDiagnosticsError: string | undefined
  try {
    leaseDiagnostics = nativeProcessing?.getLeaseDiagnostics?.() ?? []
  } catch (error) {
    leaseDiagnosticsError = error instanceof Error ? error.message : String(error)
  }
  const createdAt = Date.now()
  return {
    version: 1,
    id: `gpu-${createdAt.toString(36)}-${++diagnosticSequence}-${Math.random().toString(36).slice(2, 10)}`,
    method: 'bgtaskscheduler-supported-resources-v1',
    trigger,
    createdAt,
    environment: {
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      appState: typeof AppState.currentState === 'string' ? AppState.currentState : null,
      appMode: __DEV__ ? 'development' : 'release',
    },
    capabilities,
    evaluation: capabilities.gpu === false ? 'unsupported'
      : capabilities.gpu === true ? 'signature-unverified' : 'unknown',
    signing: { gpuEntitlement: 'unverified' },
    gpuProbe: {
      status: 'not-run',
      reason: capabilities.gpu === false ? 'device-unsupported'
        : capabilities.gpu === true ? 'signature-unverified' : 'capability-unknown',
      leaseGranted: null,
    },
    leaseDiagnostics,
    ...(leaseDiagnosticsError ? { leaseDiagnosticsError } : {}),
  }
}

export const saveGpuDiagnosticReport = async (report: GpuDiagnosticReport): Promise<void> => {
  if (!/^gpu-[a-zA-Z0-9-]+$/.test(report.id)) throw new Error('Invalid diagnostic id')
  const folder = directory()
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true })
  const path = `${folder}${report.id}.json`
  await FileSystem.writeAsStringAsync(`${path}.part`, JSON.stringify(report))
  await FileSystem.moveAsync({ from: `${path}.part`, to: path })
}

export const captureGpuDiagnosticReport = async (
  trigger: GpuDiagnosticReport['trigger'],
): Promise<GpuDiagnosticReport> => {
  const report = createGpuDiagnosticReport(trigger)
  let speechCapabilities: NativeSpeechCapabilities | null = null
  let speechQueryError: string | null = null
  try {
    speechCapabilities = await nativeCapture?.getSpeechCapabilities?.() ?? null
  } catch (error) {
    speechQueryError = error instanceof Error ? error.message : String(error)
  }
  report.speech = { capabilities: speechCapabilities, queryError: speechQueryError }
  await saveGpuDiagnosticReport(report)
  return report
}

const isGpuDiagnosticReport = (value: unknown): value is GpuDiagnosticReport => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<GpuDiagnosticReport>
  return candidate.version === 1 &&
    candidate.method === 'bgtaskscheduler-supported-resources-v1' &&
    typeof candidate.id === 'string' && /^gpu-[a-zA-Z0-9-]+$/.test(candidate.id) &&
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) &&
    typeof candidate.capabilities === 'object' && candidate.capabilities !== null &&
    (candidate.capabilities.gpu === null || typeof candidate.capabilities.gpu === 'boolean')
}

export const listGpuDiagnosticReports = async (): Promise<GpuDiagnosticReport[]> => {
  const folder = directory()
  if (!(await FileSystem.getInfoAsync(folder)).exists) return []
  const names = (await FileSystem.readDirectoryAsync(folder)).filter((name) =>
    /^gpu-[a-zA-Z0-9-]+\.json$/.test(name),
  )
  const reports: GpuDiagnosticReport[] = []
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(await FileSystem.readAsStringAsync(`${folder}${name}`))
      if (isGpuDiagnosticReport(value)) reports.push(value)
    } catch {
      // An interrupted record does not hide other capability observations.
    }
  }
  return reports.sort((left, right) => right.createdAt - left.createdAt)
}

export const shareGpuDiagnosticReports = async (): Promise<void> => {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(translate('Udostępnianie jest niedostępne.', 'Sharing is unavailable.'))
  if (!FileSystem.cacheDirectory) throw new Error('Diagnostic export is unavailable')
  const path = `${FileSystem.cacheDirectory}notatki-background-gpu-diagnostics.json`
  await FileSystem.writeAsStringAsync(path, JSON.stringify({
    version: 1, exportedAt: Date.now(), reports: await listGpuDiagnosticReports(),
  }, null, 2))
  await Sharing.shareAsync(path, {
    mimeType: 'application/json', UTI: 'public.json',
    dialogTitle: translate('Diagnostyka GPU w tle', 'Background GPU diagnostics'),
  })
}
