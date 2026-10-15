import { nextPlaybackRate } from './playbackRate'

describe('audio playback rate cycle', () => {
  it('moves through every supported speed and loops back to 0.75×', () => {
    expect(nextPlaybackRate(1)).toBe(1.25)
    expect(nextPlaybackRate(1.25)).toBe(1.5)
    expect(nextPlaybackRate(1.5)).toBe(2)
    expect(nextPlaybackRate(2)).toBe(0.75)
    expect(nextPlaybackRate(0.75)).toBe(1)
  })
})
