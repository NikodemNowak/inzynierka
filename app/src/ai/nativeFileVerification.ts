import {
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core'
import { Platform } from 'react-native'
import { GenerationCancelledError } from './llm'

export interface NativeFileVerificationResult {
  sha256: string
  sizeBytes: number
  durationMs: number
}

interface VerificationProgress {
  id: string
  bytes: number
  totalBytes: number
}
interface NativeFileVerificationModule {
  verifyFile?: (
    id: string,
    path: string,
    expectedBytes: number,
    expectedSha256: string,
  ) => Promise<NativeFileVerificationResult>
  cancelVerification?: (id: string) => Promise<void>
  addListener: (
    name: 'verificationProgress',
    callback: (event: VerificationProgress) => void,
  ) => EventSubscription
}
let requestSequence = 0
const isNativeCancellation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error &&
  error.code === 'verification-cancelled'

export const verifyFileNatively = async (
  path: string,
  expectedBytes: number,
  expectedSha256: string,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<NativeFileVerificationResult | null> => {
  if (signal?.aborted) throw new GenerationCancelledError()
  if (Platform.OS !== 'ios') return null
  const native = requireOptionalNativeModule<NativeFileVerificationModule>(
    'NotatkiDownload',
  )
  if (
    !native || typeof native.verifyFile !== 'function' ||
    typeof native.cancelVerification !== 'function'
  ) return null
  const id = `verification-${Date.now().toString(36)}-${(++requestSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  let finished = false
  let stop: Promise<void> | undefined
  let lastPercent = -1
  const report = (percent: number): void => {
    if (finished || signal?.aborted || percent <= lastPercent) return
    lastPercent = percent
    onProgress?.(percent)
  }
  const subscription = native.addListener('verificationProgress', (event) => {
    if (
      event.id !== id || event.totalBytes !== expectedBytes ||
      !Number.isFinite(event.bytes) || event.bytes < 0
    ) return
    report(Math.min(100, (event.bytes / expectedBytes) * 100))
  })
  const onAbort = (): void => {
    if (finished || stop) return
    stop = Promise.resolve().then(() => native.cancelVerification!(id))
    void stop.catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw new GenerationCancelledError()
    // Only absence of the capability returns null. Native failures, including
    // corruption, are propagated; never silently rehash them in JavaScript.
    const result = await native.verifyFile(id, path, expectedBytes, expectedSha256)
    if (signal?.aborted) throw new GenerationCancelledError()
    if (result.sizeBytes !== expectedBytes)
      throw new Error('Model size does not match the pinned file.')
    if (result.sha256 !== expectedSha256)
      throw new Error('Model SHA-256 checksum is invalid.')
    if (!Number.isFinite(result.durationMs) || result.durationMs < 0)
      throw new Error('Native verification returned an invalid duration.')
    report(100)
    return result
  } catch (error) {
    if (signal?.aborted || isNativeCancellation(error))
      throw new GenerationCancelledError()
    throw error
  } finally {
    finished = true
    signal?.removeEventListener('abort', onAbort)
    subscription.remove()
    // The awaited verifyFile promise has already settled. Drain its matching
    // cancellation receipt as well before the caller can start another request.
    if (stop) await Promise.allSettled([stop])
  }
}
