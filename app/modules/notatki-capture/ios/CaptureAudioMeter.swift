import Foundation

// Audio-frame-driven, bounded telemetry only. It never modifies, delays or
// drops captured PCM and has no timer or synthetic activity in silence.
struct CaptureAudioMeter {
  private var pendingFrames: Int64 = 0
  private var pendingPeak = 0.0
  private let intervalFrames: Int64 = 1600

  mutating func reset() { pendingFrames = 0; pendingPeak = 0 }

  mutating func observe(volume: Double, frames: Int64) -> Double? {
    guard frames > 0 else { return nil }
    if volume.isFinite { pendingPeak = max(pendingPeak, min(1, max(0, volume))) }
    pendingFrames += min(intervalFrames, frames)
    guard pendingFrames >= intervalFrames else { return nil }
    let peak = pendingPeak
    reset()
    return peak
  }
}
