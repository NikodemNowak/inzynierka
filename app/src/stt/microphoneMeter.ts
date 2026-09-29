const clamp = (value: number): number => Math.max(0, Math.min(1, value))

/** Map expo-speech-recognition's -2..10 range; values below 0 are inaudible. */
export function normalizeRecognitionVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return clamp(value / 10)
}

/** Keep a thin baseline at silence and let live input expand bars to full size. */
export function waveformScaleForVolume(volume: number): number {
  const baseline = 0.08
  const normalized = Number.isFinite(volume) ? clamp(volume) : 0
  return baseline + (1 - baseline) * normalized
}
