import {
  normalizeRecognitionVolume,
  waveformScaleForVolume,
} from './microphoneMeter'

describe('microphone input metering', () => {
  it('normalizes the recognition event range and clamps invalid input', () => {
    expect(normalizeRecognitionVolume(-2)).toBe(0)
    expect(normalizeRecognitionVolume(0)).toBe(0)
    expect(normalizeRecognitionVolume(5)).toBe(0.5)
    expect(normalizeRecognitionVolume(10)).toBe(1)
    expect(normalizeRecognitionVolume(-20)).toBe(0)
    expect(normalizeRecognitionVolume(20)).toBe(1)
    expect(normalizeRecognitionVolume(Number.NaN)).toBe(0)
  })

  it('keeps a visible baseline at silence and scales the loud waveform clearly', () => {
    expect(waveformScaleForVolume(0)).toBe(0.08)
    expect(waveformScaleForVolume(1)).toBe(1)
    expect(waveformScaleForVolume(0.75)).toBeGreaterThan(
      waveformScaleForVolume(0.1),
    )
    expect(
      waveformScaleForVolume(0.75) - waveformScaleForVolume(0.1),
    ).toBeGreaterThan(0.5)
  })
})
