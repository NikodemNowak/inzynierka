export const formatAudioTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`
}
