import Foundation

@main
struct CaptureTranscriptCheckpointTests {
  static func main() throws {
    let complete = CaptureTranscriptCheckpoint(sessionId: "capture-test", generation: "generation-a", audioFrames: 16000, complete: true, finalTranscript: "Saved speech", interimTranscript: "")
    let data = try JSONEncoder().encode(complete)
    func restore(_ candidate: Data?, generation: String? = "generation-a", frames: Int64 = 16000, manifestComplete: Bool = true) -> RecoveredCaptureTranscript {
      recoverCaptureTranscript(candidate, sessionId: "capture-test", generation: generation, audioFrames: frames, manifestComplete: manifestComplete)
    }
    func require(_ description: String, _ condition: Bool) throws {
      guard condition else { throw NSError(domain: "CaptureTranscriptCheckpointTests", code: 1, userInfo: [NSLocalizedDescriptionKey: description]) }
    }
    try require("Matching committed checkpoint preserves complete text", restore(data).finalTranscript == "Saved speech" && !restore(data).needsTranscription)
    try require("Missing transcript must never recover complete", restore(nil).needsTranscription)
    try require("Corrupt JSON must never recover complete", restore(Data("{broken".utf8)).needsTranscription)
    try require("Old text after new manifest must recover partial", restore(data, generation: "generation-b").needsTranscription)
    var next = complete
    next.generation = "generation-b"; next.audioFrames = 32000; next.finalTranscript = "New speech"
    let newData = try JSONEncoder().encode(next)
    try require("New text before manifest publication must recover partial", restore(newData).needsTranscription)
    try require("Audio-frame mismatch must recover partial", restore(data, frames: 32000).needsTranscription)
    var foreign = complete; foreign.sessionId = "capture-another"
    try require("Another session's text must recover partial", restore(try JSONEncoder().encode(foreign)).needsTranscription)
    var partial = complete; partial.complete = false
    try require("Incomplete checkpoint cannot match complete manifest", restore(try JSONEncoder().encode(partial)).needsTranscription)
    try require("Manifest partial flag is never cleared by a clean checkpoint", restore(data, manifestComplete: false).needsTranscription)
    let legacy = try JSONEncoder().encode(["Legacy speech", "tail"])
    try require("Legacy text is useful but unverified", restore(legacy, generation: nil).finalTranscript == "Legacy speech" && restore(legacy, generation: nil).needsTranscription)
    print("CaptureTranscriptCheckpointTests: 10 cases passed")
  }
}
