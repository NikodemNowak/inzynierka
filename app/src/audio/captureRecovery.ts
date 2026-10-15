import { nativeCapture, type CaptureSnapshot } from '../stt/nativeCapture'
import { validateCaptureManifest, CAPTURE_SAMPLE_RATE } from './captureManifest'
import { concatWavFiles } from './wavConcat'
import type { Language } from '../i18n/language'
import { translate } from '../i18n/translate'

export interface CapturedAudioResult {
  sessionId: string
  language: Language
  transcript: string
  audioUri: string | null
  durationMs: number
  needsTranscription: boolean
  autoTranscribeAudio?: boolean
  notice?: string
}

const finalizations = new Map<string, Promise<CapturedAudioResult>>()
const finalize = async (
  snapshot: CaptureSnapshot,
): Promise<CapturedAudioResult> => {
  const manifest = validateCaptureManifest(snapshot.manifest)
  if (manifest.state === 'recording')
    throw new Error('Capture is still recording')
  if (manifest.state === 'error')
    throw new Error(
      manifest.error ?? 'Capture recovery failed; source audio is retained',
    )
  if (manifest.segments.length === 0)
    throw new Error('No recorded audio frames')
  const result = await concatWavFiles(
    manifest.segments.map((segment) => `${snapshot.directory}${segment.key}`),
    `${snapshot.directory}full.wav`,
  )
  const durationMs = Math.round((manifest.frames * 1000) / CAPTURE_SAMPLE_RATE)
  if (result.durationMs !== durationMs)
    throw new Error('Capture manifest does not match audio length')
  return {
    sessionId: manifest.sessionId,
    language: manifest.language,
    transcript: [snapshot.finalTranscript, snapshot.interimTranscript]
      .filter(Boolean)
      .join(' ')
      .trim(),
    audioUri: result.uri,
    durationMs,
    needsTranscription: manifest.needsTranscription,
    // A complete recording can be verified by transcribing the entire file.
    // This does not certify the live transcript or erase journal interruptions.
    ...(manifest.needsTranscription && manifest.state === 'stopped' &&
    manifest.gaps.length === 0 && !manifest.error && !manifest.transcriptionRecoveryIssue
      ? { autoTranscribeAudio: true }
      : {}),
    ...(manifest.needsTranscription ||
    manifest.gaps.length > 0 ||
    manifest.state === 'recovered'
      ? {
          notice: translate(
            'Zachowano audio. Transkrypcja może być niepełna; wymaga uzupełnienia z nagrania. Przerwy systemowe pozostają w dzienniku sesji.',
            'Audio has been kept. The transcript may be incomplete and needs transcription from the recording. System interruptions are recorded in the session journal.',
          ),
        }
      : {}),
  }
}

export const finalizeCapture = (
  snapshot: CaptureSnapshot,
): Promise<CapturedAudioResult> => {
  const id = snapshot.manifest.sessionId
  const pending = finalizations.get(id)
  if (pending) return pending
  const work = finalize(snapshot)
  finalizations.set(id, work)
  void work
    .finally(() => {
      if (finalizations.get(id) === work) finalizations.delete(id)
    })
    .catch(() => undefined)
  return work
}

// Materialize with sessionId as the note ID; acknowledge only after SQLite
// commits. A crash between these steps safely retries the same ID. A receipt
// survives note deletion and prevents intentionally deleted notes resurfacing.
export const recoverCapturedSessions = async (
  materialize: (result: CapturedAudioResult) => Promise<void>,
): Promise<{ recovered: number; errors: string[] }> => {
  if (!nativeCapture) return { recovered: 0, errors: [] }
  const snapshots = await nativeCapture.recoverSessions()
  const errors: string[] = []
  let recovered = 0
  for (const snapshot of snapshots) {
    if (
      snapshot.manifest.materializedNoteId ||
      snapshot.manifest.state === 'recording'
    )
      continue
    try {
      const result = await finalizeCapture(snapshot)
      await materialize(result)
      await nativeCapture.markMaterialized(result.sessionId, result.sessionId)
      recovered += 1
    } catch (error) {
      errors.push(
        `${snapshot.manifest.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { recovered, errors }
}

export const acknowledgeCapture = async (sessionId?: string): Promise<void> => {
  if (sessionId && nativeCapture)
    await nativeCapture.markMaterialized(sessionId, sessionId)
}
