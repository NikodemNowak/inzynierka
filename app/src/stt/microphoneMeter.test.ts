import {
  normalizeRecognitionVolume,
  normalizeCaptureVolume,
  waveformScaleForVolume,
} from './microphoneMeter'

describe('microphone input metering', () => {
  it('maps real capture RMS to visible speech without lifting quiet noise or invalid readings', () => {
    expect(normalizeCaptureVolume(0.010875)).toBe(0)
    expect(normalizeCaptureVolume(0.230935)).toBeCloseTo(0.6774, 3)
    expect(normalizeCaptureVolume(0.4195)).toBeCloseTo(0.8695, 3)
    expect(normalizeCaptureVolume(0)).toBe(0)
    expect(normalizeCaptureVolume(-0.3)).toBe(0)
    expect(normalizeCaptureVolume(Number.NaN)).toBe(0)
    expect(normalizeCaptureVolume(Number.POSITIVE_INFINITY)).toBe(0)
    expect(normalizeCaptureVolume(1)).toBe(1)
    expect(normalizeCaptureVolume(2)).toBe(1)
  })
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
