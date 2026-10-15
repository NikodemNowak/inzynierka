import {
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core'

export interface NativeDownloadState {
  version: 1
  id: string
  url: string
  filename: string
  expectedBytes: number
  expectedSha256?: string
  state:
    | 'running'
    | 'verifying'
    | 'paused'
    | 'failed'
    | 'complete'
    | 'cancelled'
  writtenBytes: number
  language: 'pl' | 'en'
  error?: string
  path?: string
}
export interface NativeModelDownloadModule {
  start(
    id: string,
    url: string,
    filename: string,
    expectedBytes: number,
    sha256: string,
    language: string,
  ): Promise<NativeDownloadState>
  getState(): Promise<NativeDownloadState | null>
  cancel(id: string): Promise<void>
  remove(filename: string): Promise<void>
  addListener(
    name: 'downloadState',
    listener: (state: NativeDownloadState) => void,
  ): EventSubscription
}
export const nativeModelDownload =
  requireOptionalNativeModule<NativeModelDownloadModule>('NotatkiDownload')

export const downloadStateMatches = (
  state: NativeDownloadState,
  expected: {
    url: string
    filename: string
    sizeBytes?: number
    sha256?: string
  },
): boolean =>
  state.version === 1 &&
  state.url === expected.url &&
  state.filename === expected.filename &&
  state.expectedBytes === expected.sizeBytes &&
  state.expectedSha256 === expected.sha256

export const downloadStateProgress = (state: NativeDownloadState): number =>
  state.state === 'complete'
    ? 100
    : state.expectedBytes > 0
      ? Math.min(
          99.9,
          Math.max(0, (state.writtenBytes / state.expectedBytes) * 100),
        )
      : 0
