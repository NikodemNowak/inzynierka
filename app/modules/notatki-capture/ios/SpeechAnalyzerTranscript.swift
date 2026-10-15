import Foundation

// Final phrases have disjoint, ordered ranges. Completion is a separate event
// after all input is analyzed and its results stream is drained.
struct SpeechAnalyzerTranscript {
  let duration: Double
  private(set) var tokens: [SpeechWindowToken] = []
  private(set) var completed = false
  var text: String { tokens.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines) }
  mutating func receive(text: String, start: Double, end: Double, isFinal: Bool) throws {
    guard !completed else { throw failure("Analyzer result arrived after completion") }
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return }
    guard isFinal else { throw failure("Final-only analyzer produced a volatile result") }
    guard start.isFinite, end.isFinite, start >= 0, end > start, end <= duration + 0.25,
          start >= (tokens.last?.end ?? 0) - 0.001 else { throw failure("Analyzer final results have invalid or overlapping audio ranges") }
    guard tokens.count < 4096, text.utf16.count + tokens.reduce(0, { $0 + $1.text.utf16.count }) <= 65536 else {
      throw failure("Analyzer result exceeded its bounded transcript capacity")
    }
    tokens.append(SpeechWindowToken(text: text, start: start, end: end, beginsObservation: true))
  }
  mutating func complete(finalizedThrough: Double) throws {
    guard finalizedThrough.isFinite, abs(finalizedThrough - duration) <= 0.02 else {
      throw failure("Analyzer did not finalize the entire requested audio window")
    }
    completed = true
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "NotatkiSpeechAnalyzer", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
