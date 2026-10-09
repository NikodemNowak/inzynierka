import Foundation

struct CaptureTranscriptCheckpoint: Codable {
  var version = 1
  var sessionId: String
  var generation: String
  var audioFrames: Int64
  var complete: Bool
  var finalTranscript: String
  var interimTranscript: String
}

struct RecoveredCaptureTranscript {
  let finalTranscript: String
  let interimTranscript: String
  let needsTranscription: Bool
  let checkpointIssue: String?
}

// The two files are individually atomic, not one transaction. A matching
// generation, source and completeness is required before text can be declared
// complete; either crash order between writes is therefore recoverably partial.
func recoverCaptureTranscript(_ data: Data?, sessionId: String, generation: String?, audioFrames: Int64, manifestComplete: Bool) -> RecoveredCaptureTranscript {
  guard let data = data else {
    return RecoveredCaptureTranscript(finalTranscript: "", interimTranscript: "", needsTranscription: true, checkpointIssue: "transcript-checkpoint-missing")
  }
  if let checkpoint = try? JSONDecoder().decode(CaptureTranscriptCheckpoint.self, from: data) {
    guard checkpoint.sessionId == sessionId else {
      return RecoveredCaptureTranscript(finalTranscript: "", interimTranscript: "", needsTranscription: true, checkpointIssue: "transcript-session-mismatch")
    }
    let matching = checkpoint.version == 1 && generation != nil && !checkpoint.generation.isEmpty &&
      checkpoint.generation == generation && checkpoint.audioFrames >= 0 && checkpoint.audioFrames == audioFrames
    let complete = matching && manifestComplete && checkpoint.complete
    return RecoveredCaptureTranscript(finalTranscript: checkpoint.finalTranscript, interimTranscript: checkpoint.interimTranscript,
      needsTranscription: !complete, checkpointIssue: matching
        ? (checkpoint.complete == manifestComplete ? nil : "transcript-completeness-mismatch")
        : "transcript-checkpoint-mismatch")
  }
  // Preserve useful legacy text, but it has no provenance linking it to the
  // clean final manifest. It must be backfilled from durable audio.
  if let legacy = try? JSONDecoder().decode([String].self, from: data), legacy.count == 2 {
    return RecoveredCaptureTranscript(finalTranscript: legacy[0], interimTranscript: legacy[1], needsTranscription: true, checkpointIssue: "transcript-checkpoint-legacy")
  }
  return RecoveredCaptureTranscript(finalTranscript: "", interimTranscript: "", needsTranscription: true, checkpointIssue: "transcript-checkpoint-malformed")
}
