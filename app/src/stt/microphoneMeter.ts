const clamp = (value: number): number => Math.max(0, Math.min(1, value))

/** Map expo-speech-recognition's -2..10 range; values below 0 are inaudible. */
export function normalizeRecognitionVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return clamp(value / 10)
}

/** Native capture sends linear PCM RMS multiplied by five, not loudness. */
export function normalizeCaptureVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const decibels = 20 * Math.log10(clamp(value) / 5)
  // The physical capture's quiet floor is below -45 dBFS. Give speech a
  // useful visual range without turning that quiet floor into a signal.
  return clamp((decibels + 45) / 27)
}

/** Keep a thin baseline at silence and let live input expand bars to full size. */
export function waveformScaleForVolume(volume: number): number {
  const baseline = 0.08
  const normalized = Number.isFinite(volume) ? clamp(volume) : 0
  return baseline + (1 - baseline) * normalized
}
