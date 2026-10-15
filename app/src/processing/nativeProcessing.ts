import { requireOptionalNativeModule } from 'expo-modules-core'

export interface ProcessingNativeCapabilities {
    continuedProcessing: boolean
    thermalState: number
    configurationStatus?:
      | 'configured'
      | 'identifier-mismatch'
      | 'missing-bundle-identifier'
    taskIdentifierPattern?: string
    gpu?: boolean | null
    gpuUnavailableReason?: string | null
    supportedResourcesRawValue?: number | null
    registrationStatus?: string
    osVersion?: string
    appVersion?: string
    appBuild?: string
    bundleIdentifier?: string
    hardwareModel?: string
}

export interface ProcessingCapabilities {
  continuedProcessing: boolean
  gpu: boolean | null
  gpuUnavailableReason: string | null
  supportedResourcesRawValue: number | null
  thermalState: number | null
  configurationStatus: string | null
  registrationStatus: string | null
  taskIdentifierPattern: string | null
  osVersion: string | null
  appVersion: string | null
  appBuild: string | null
  bundleIdentifier: string | null
  hardwareModel: string | null
  queryError: string | null
}

export interface ProcessingLeaseDiagnostic {
  timestampMs: number
  event: string
  attemptId?: string
  reason?: string
  identifier?: string
  errorDomain?: string
  errorCode?: number
  success?: boolean
  requiredResources?: string
}

interface ProcessingNativeModule {
  getCapabilities(): ProcessingNativeCapabilities
  getLeaseDiagnostics?(): ProcessingLeaseDiagnostic[]
  begin(attemptId: string, title: string, subtitle: string): Promise<boolean>
  update(
    attemptId: string,
    completed: number,
    title: string,
    subtitle: string,
  ): Promise<void>
  finish(attemptId: string, success: boolean): Promise<void>
  prepareProtectedFiles(): Promise<void>
  requestNotifications(): Promise<boolean>
  notifyCompleted(
    identifier: string,
    title: string,
    body: string,
  ): Promise<void>
  addListener(
    event: 'onProcessingExpired',
    callback: (event: { attemptId: string; reason: string }) => void,
  ): { remove(): void }
}

export const nativeProcessing =
  requireOptionalNativeModule<ProcessingNativeModule>('NotatkiProcessing')

export const readProcessingCapabilities = (): ProcessingCapabilities => {
  let raw: ProcessingNativeCapabilities | undefined
  let queryError: string | null = null
  try {
    raw = nativeProcessing?.getCapabilities()
  } catch (error) {
    queryError = error instanceof Error ? error.message : String(error)
  }
  const gpu = typeof raw?.gpu === 'boolean' ? raw.gpu : null
  return {
    continuedProcessing:
      raw?.continuedProcessing === true &&
      (raw.registrationStatus === undefined || raw.registrationStatus === 'registered'),
    gpu,
    gpuUnavailableReason: gpu !== null ? null
      : queryError ? 'native-query-failed'
        : !nativeProcessing ? 'native-module-unavailable'
          : raw?.gpuUnavailableReason ?? 'native-capability-unavailable',
    supportedResourcesRawValue: raw?.supportedResourcesRawValue ?? null,
    thermalState: raw?.thermalState ?? null,
    configurationStatus: raw?.configurationStatus ?? null,
    registrationStatus: raw?.registrationStatus ?? null,
    taskIdentifierPattern: raw?.taskIdentifierPattern ?? null,
    osVersion: raw?.osVersion ?? null,
    appVersion: raw?.appVersion ?? null,
    appBuild: raw?.appBuild ?? null,
    bundleIdentifier: raw?.bundleIdentifier ?? null,
    hardwareModel: raw?.hardwareModel ?? null,
    queryError,
  }
}

export const supportsBackgroundProcessing = (): boolean =>
  readProcessingCapabilities().continuedProcessing

export const requestCompletionNotifications = async (): Promise<boolean> =>
  (await nativeProcessing?.requestNotifications()) ?? false

export const notifyModelDownloaded = async (
  title: string,
  body: string,
): Promise<void> => {
  await nativeProcessing?.notifyCompleted('model-download', title, body)
}
