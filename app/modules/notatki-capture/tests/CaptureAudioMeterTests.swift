import Foundation

@main
struct CaptureAudioMeterTests {
  static func main() throws {
    var checks = 0
    func expect(_ value: Bool, _ message: String) throws {
      guard value else { throw NSError(domain: "CaptureAudioMeterTests", code: 1,
        userInfo: [NSLocalizedDescriptionKey: message]) }
      checks += 1
    }
    var meter = CaptureAudioMeter()
    try expect(meter.observe(volume: 0.7, frames: 800) == nil, "Small audio buffers cannot emit too many meter events")
    try expect(meter.observe(volume: 0.01, frames: 800) == 0.7,
      "A short spoken peak survives the quieter last buffer and appears after 100ms of PCM")
    try expect(meter.observe(volume: 0, frames: 1600) == 0, "Fresh silence clears the previous interval's speech peak")
    try expect(meter.observe(volume: 0.4, frames: 800) == nil, "A new interval starts with no previous frame debt")
    meter.reset()
    try expect(meter.observe(volume: 0.02, frames: 1600) == 0.02, "Pause/resume resets the older measured speech peak")
    try expect(meter.observe(volume: .nan, frames: 1600) == 0, "Invalid telemetry cannot display an invented signal")
    try expect(meter.observe(volume: .infinity, frames: 1600) == 0, "Infinite telemetry cannot display an invented signal")
    try expect(meter.observe(volume: -1, frames: 1600) == 0, "Negative levels are silent")
    try expect(meter.observe(volume: 2, frames: 1600) == 1, "Actual level is bounded at the native normalized maximum")
    try expect(meter.observe(volume: 1, frames: 0) == nil && meter.observe(volume: 1, frames: -1) == nil,
      "Non-audio callbacks cannot advance the meter or create activity")
    try expect(meter.observe(volume: 0, frames: 1600) == 0, "Ignored invalid frame lengths cannot retain a peak")
    var events = 0
    for _ in 0..<160 { if meter.observe(volume: 0.2, frames: 100) != nil { events += 1 } }
    try expect(events == 10, "One second of PCM emits at most ten measured meter updates")
    print("CaptureAudioMeterTests: \(checks) checks PASS")
  }
}
