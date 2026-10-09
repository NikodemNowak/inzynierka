import Foundation

struct CaptureSpeechObservation: Codable {
  var generation: Int
  var kind: String
  var segmentCount: Int
  var isFinal: Bool
  var finalLike: Bool
  var audioStartFrame: Int64
  var observedStartMs: Double?
  var observedEndMs: Double?
}

struct CaptureSpeechDiagnostics: Codable {
  var version = 1
  var requestsStarted = 0
  var callbackCount = 0
  var finalCallbackCount = 0
  var finalLikeCallbackCount = 0
  var untimedCallbackCount = 0
  var emptyFinalCallbackCount = 0
  var invalidCallbackCount = 0
  var staleCallbackCount = 0
  var observations: [CaptureSpeechObservation] = []
  var observationsTruncated = false
  var reasonCodes: [String] = []
}

// CaptureOwner remains the single recognition-task/lifecycle owner. This pure
// value owns only text observations. Each request has its own timestamp origin;
// final-like utterances do not finish a request or certify complete audio.
struct CaptureSpeechTranscript {
  private struct Request {
    var generation: Int
    var audioStartFrame: Int64
    var transcript: SpeechWindowTranscript
    var finalObserved = false
    var validTerminal = false
    var invalid = false
    var unresolvedUntimed = false
    var previewText: String?
    var previewAnchor = ""
  }
  private var committed: [String] = []
  private var request: Request?
  private(set) var needsTranscription = false
  private(set) var diagnostics = CaptureSpeechDiagnostics()
  var finalText: String { committed.joined(separator: " ") }
  var interimText: String { request?.transcript.text ?? "" }
  // Timing-free hypotheses may be shown while speaking, but never enter the
  // source transcript, checkpoint, committed requests or completeness proof.
  var livePreviewText: String {
    let live: String
    if let current = request, let preview = current.previewText {
      live = [current.previewAnchor, preview].filter { !$0.isEmpty }.joined(separator: " ")
    } else { live = interimText }
    return [finalText, live].filter { !$0.isEmpty }.joined(separator: " ")
  }

  mutating func reset() { self = CaptureSpeechTranscript() }

  mutating func beginRequest(generation: Int, audioStartFrame: Int64) {
    if let old = request {
      _ = finishRequest(generation: old.generation, clean: false, reason: "request-replaced-before-terminal")
    }
    request = Request(generation: generation, audioStartFrame: audioStartFrame,
      transcript: SpeechWindowTranscript(duration: 55, completionPolicy: .ownerTracksIncompleteness))
    diagnostics.requestsStarted += 1
    record(generation: generation, kind: "request-start", tokens: [], isFinal: false, finalLike: false, audioStartFrame: audioStartFrame)
  }

  @discardableResult
  mutating func receive(generation: Int, tokens: [SpeechWindowToken], hasText: Bool, isFinal: Bool, finalLike: Bool, observedText: String? = nil) throws -> Bool {
    guard var current = request, current.generation == generation else {
      recordStaleCallback(generation: generation)
      return false
    }
    diagnostics.callbackCount += 1
    if isFinal { diagnostics.finalCallbackCount += 1 }
    if finalLike { diagnostics.finalLikeCallbackCount += 1 }
    if isFinal && !hasText { diagnostics.emptyFinalCallbackCount += 1 }
    record(generation: generation, kind: "observation", tokens: tokens, isFinal: isFinal, finalLike: finalLike, audioStartFrame: current.audioStartFrame)
    let previousUntimed = current.transcript.untimedCallbackCount
    do {
      if isFinal && hasText && tokens.isEmpty { throw failure("terminal-without-source-segments") }
      try current.transcript.receive(tokens, isFinal: isFinal)
      let ignoredUntimed = current.transcript.untimedCallbackCount > previousUntimed
      let missingSegments = hasText && tokens.isEmpty
      diagnostics.untimedCallbackCount += current.transcript.untimedCallbackCount - previousUntimed
      if missingSegments { diagnostics.untimedCallbackCount += 1 }
      if hasText {
        if ignoredUntimed || missingSegments {
          // Only a previously timed utterance provides a source anchor. The
          // latest provisional utterance replaces its own suffix literally;
          // guessed string deduplication never changes canonical source.
          if let observedText = observedText, observedText.utf16.count <= 65536 {
            let preview = observedText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !preview.isEmpty { current.previewText = preview }
          }
        } else {
          current.previewText = nil
          if finalLike { current.previewAnchor = current.transcript.text }
        }
      }
      if ignoredUntimed || missingSegments {
        // Without source timing/utterance identity, a later timed hypothesis
        // cannot prove recovery of ignored early or late words. Keep its valid
        // literal text, but require independent full file-STT for provenance.
        current.unresolvedUntimed = true
        invalidate("unresolved-untimed-observation")
      }
      if isFinal {
        current.finalObserved = true
        // An empty terminal may retain earlier timed observations. A nonempty
        // untimed terminal throws above/in the reused validator. Valid later
        // text does not clear uncertainty from any ignored nonempty result.
        current.validTerminal = !current.transcript.tokens.isEmpty && !current.unresolvedUntimed
      }
      request = current
      return true
    } catch {
      diagnostics.untimedCallbackCount += current.transcript.untimedCallbackCount - previousUntimed
      diagnostics.invalidCallbackCount += 1
      current.invalid = true
      if isFinal { current.finalObserved = true; current.validTerminal = false }
      request = current
      invalidate(isFinal ? "invalid-terminal-observation" : "invalid-speech-observation")
      throw error
    }
  }

  @discardableResult
  mutating func finishRequest(generation: Int, clean: Bool, reason: String) -> Bool {
    guard let current = request, current.generation == generation else { return false }
    let text = current.transcript.text
    if !text.isEmpty { committed.append(text) }
    if !clean || !current.finalObserved || !current.validTerminal || current.invalid {
      invalidate(reason == "final" ? "unverified-terminal" : reason)
    }
    record(generation: generation, kind: "request-end", tokens: current.transcript.tokens,
      isFinal: current.finalObserved, finalLike: false, audioStartFrame: current.audioStartFrame)
    request = nil
    return true
  }

  mutating func rejectObservation(generation: Int, isFinal: Bool, finalLike: Bool) {
    guard var current = request, current.generation == generation else {
      recordStaleCallback(generation: generation)
      return
    }
    diagnostics.callbackCount += 1
    diagnostics.invalidCallbackCount += 1
    if isFinal { diagnostics.finalCallbackCount += 1 }
    if finalLike { diagnostics.finalLikeCallbackCount += 1 }
    current.invalid = true
    if isFinal { current.finalObserved = true; current.validTerminal = false }
    request = current
    record(generation: generation, kind: "invalid-result", tokens: [], isFinal: isFinal,
      finalLike: finalLike, audioStartFrame: current.audioStartFrame)
    invalidate(isFinal ? "invalid-terminal-observation" : "invalid-speech-observation")
  }

  mutating func recordStaleCallback(generation: Int) {
    diagnostics.staleCallbackCount += 1
    record(generation: generation, kind: "stale-result", tokens: [], isFinal: false,
      finalLike: false, audioStartFrame: request?.audioStartFrame ?? 0)
  }

  mutating func invalidate(_ reason: String) {
    needsTranscription = true
    if !diagnostics.reasonCodes.contains(reason) && diagnostics.reasonCodes.count < 16 {
      diagnostics.reasonCodes.append(reason)
    }
  }

  static func isValidSourceRange(_ range: NSRange, utf16Length: Int) -> Bool {
    // Subtract only after checking location, so malformed lengths cannot
    // overflow a location + length expression.
    range.location >= 0 && range.location <= utf16Length &&
      range.length >= 0 && range.length <= utf16Length - range.location
  }

  private func diagnosticMilliseconds(_ seconds: Double?) -> Double? {
    guard let seconds = seconds, seconds.isFinite, seconds >= 0, seconds <= 55.25 else { return nil }
    let milliseconds = seconds * 1000
    return milliseconds.isFinite ? milliseconds : nil
  }

  private mutating func record(generation: Int, kind: String, tokens: [SpeechWindowToken], isFinal: Bool, finalLike: Bool, audioStartFrame: Int64) {
    let first = tokens.first?.start
    let last = tokens.last?.end
    let observation = CaptureSpeechObservation(generation: generation, kind: kind,
      segmentCount: tokens.count, isFinal: isFinal, finalLike: finalLike, audioStartFrame: audioStartFrame,
      observedStartMs: diagnosticMilliseconds(first),
      observedEndMs: diagnosticMilliseconds(last))
    if diagnostics.observations.count == 64 {
      diagnostics.observations.removeFirst()
      diagnostics.observationsTruncated = true
    }
    diagnostics.observations.append(observation)
  }

  private func failure(_ reason: String) -> NSError {
    NSError(domain: "NotatkiCaptureSpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: reason])
  }
}
