export const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const

export type PlaybackRate = (typeof playbackRates)[number]

export function nextPlaybackRate(currentRate: number): PlaybackRate {
  const index = playbackRates.findIndex(
    (rate) => Math.abs(rate - currentRate) < 0.01,
  )
  return playbackRates[(index + 1) % playbackRates.length] ?? playbackRates[0]
}
