import Foundation

@main
struct SpeechAnalyzerTranscriptTests {
  static func main() throws {
    var checks = 0
    func expect(_ condition: Bool, _ message: String) throws {
      checks += 1
      if !condition { throw NSError(domain: "SpeechAnalyzerTranscriptTests", code: checks, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    func rejects(_ operation: () throws -> Void) -> Bool {
      do { try operation(); return false } catch { return true }
    }
    var transcript = SpeechAnalyzerTranscript(duration: 60)
    try transcript.receive(text: "First commitment.", start: 1, end: 4, isFinal: true)
    try transcript.receive(text: "Later correction.", start: 52, end: 59, isFinal: true)
    try expect(transcript.text == "First commitment. Later correction.", "Every final phrase must survive until the whole input is finalized")
    try expect(!transcript.completed, "One or several phrase finals cannot finish a file")
    try expect(rejects { try transcript.complete(finalizedThrough: 59) }, "A partial audio prefix cannot authorize completion")
    try transcript.complete(finalizedThrough: 60 - 1.0 / 16000)
    try expect(transcript.completed, "The final sample and drained phrase results authorize completion")
    try expect(rejects { try transcript.receive(text: "Late callback", start: 59, end: 60, isFinal: true) }, "No callbacks may mutate completed output")

    transcript = SpeechAnalyzerTranscript(duration: 60)
    try transcript.receive(text: "Kept source.", start: 2, end: 5, isFinal: true)
    try expect(rejects { try transcript.receive(text: "Volatile guess", start: 6, end: 9, isFinal: false) }, "An experimental final-only transcriber must not silently accept volatile results")
    try expect(rejects { try transcript.receive(text: "Overlapping final", start: 4, end: 7, isFinal: true) }, "Final ranges cannot overwrite or duplicate earlier speech")
    try expect(rejects { try transcript.receive(text: "Backwards final", start: 1, end: 2, isFinal: true) }, "Out-of-order final ranges reject")
    try expect(rejects { try transcript.receive(text: "Outside audio", start: 61, end: 63, isFinal: true) }, "A final range outside source audio rejects")
    try expect(rejects { try transcript.receive(text: "Invalid timing", start: .nan, end: 7, isFinal: true) }, "Nonfinite timing rejects")
    try expect(rejects { try transcript.receive(text: String(repeating: "x", count: 65537), start: 6, end: 9, isFinal: true) }, "Final text remains bounded")
    try transcript.receive(text: "", start: 0, end: 0, isFinal: true)
    try expect(transcript.text == "Kept source.", "Rejected or empty observations must preserve actual earlier speech")
    print("SpeechAnalyzerTranscriptTests: \(checks) checks PASS")
  }
}
