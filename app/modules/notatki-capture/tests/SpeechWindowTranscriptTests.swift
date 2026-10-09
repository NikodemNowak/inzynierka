import Foundation

@main
struct SpeechWindowTranscriptTests {
  static func main() throws {
    var checks = 0
    func expect(_ condition: Bool, _ message: String) throws {
      if !condition { throw NSError(domain: "SpeechWindowTranscriptTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
      checks += 1
    }
    func token(_ text: String, _ start: Double, _ end: Double, first: Bool = true) -> SpeechWindowToken {
      SpeechWindowToken(text: text, start: start, end: end, beginsObservation: first)
    }
    var transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice will prepare the materials.", 0.5, 5)], isFinal: false)
    try transcript.receive([token("Bob will contact the supplier.", 7, 11)], isFinal: false)
    try transcript.receive([token("The topics are for that meeting.", 44, 49)], isFinal: true)
    try expect(transcript.text == "Alice will prepare the materials. Bob will contact the supplier. The topics are for that meeting.", "Final utterance must not discard two observed earlier utterances")
    try expect(transcript.tokens.count == 3, "All distinct source-time spans survive")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice will prepare a wrong long draft.", 0.5, 5)], isFinal: false)
    try transcript.receive([token("Alice prepares materials.", 0.5, 3)], isFinal: false)
    try transcript.receive([token("Alice prepares materials.", 0.5, 3)], isFinal: true)
    try expect(transcript.text == "Alice prepares materials.", "A shorter final-like revision must replace an interim tail and duplicate boundary callback")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Repeat this.", 1, 3)], isFinal: false)
    try transcript.receive([token("Repeat this.", 10, 12)], isFinal: true)
    try expect(transcript.text == "Repeat this. Repeat this.", "Identical words at different audio times must not deduplicate")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice ", 1, 2), token("will send the draft.", 2, 5, first: false)], isFinal: false)
    try transcript.receive([token("will send the report.", 2, 5)], isFinal: true)
    try expect(transcript.text == "Alice will send the report.", "Suffix revision must retain its earlier timed prefix")
    try transcript.receive([token("Alice will send the report. ", 1, 5), token("Bob calls tomorrow.", 9, 12, first: false)], isFinal: true)
    try expect(transcript.text == "Alice will send the report. Bob calls tomorrow.", "Cumulative replacement uses only observed text pieces and must not append old duplicate words")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("A timed utterance.", 1, 4)], isFinal: false)
    try transcript.receive([token("Bob calls.", 0, 0)], isFinal: false)
    try expect(transcript.text == "A timed utterance.", "Zero timestamps cannot overwrite prior timed evidence")
    try expect(transcript.untimedCallbackCount == 1, "Skipped untimed hypothesis remains diagnostic")
    try transcript.receive([token("Bob ", 0, 0), token("calls.", 7, 8, first: false)], isFinal: false)
    try transcript.receive([token("Bob calls.", 7, 8)], isFinal: true)
    try expect(transcript.text == "A timed utterance. Bob calls.", "A mixed placeholder interim cannot erase completed earlier timed speech")
    try expect(transcript.untimedCallbackCount == 2, "Mixed placeholder timing remains diagnostic")
    try expect(transcript.unresolvedUntimedObservationCount == 0, "Timed evidence resolves matching earlier untimed hypotheses")
    var rejected = false
    do { try transcript.receive([token("Untimed final", 0, 0)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Untimed nonempty final cannot count as successful recognition")

    // Recorded v10 first-window callbacks: the recognizer revised the name
    // before supplying usable timestamps. A task hint must not authorize
    // promoting an earlier untimed spelling over actual timed speech.
    transcript = SpeechWindowTranscript(duration: 30)
    let untimed = "These are the planning notes for the Riverside community podcast. The project is a series of short conversation conversations about local places every day experiences, and the people who live in the neighborhood. Maya will prepare the first episode outline by Thursday"
    let timed = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge."
    let terminal = "We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they show."
    try transcript.receive([token(untimed, 0, 0)], isFinal: false)
    try expect(transcript.text.isEmpty && transcript.untimedCallbackCount == 1, "Correct-looking untimed name remains diagnostic rather than accepted source")
    try transcript.receive([token(timed, 0.09, 21.36)], isFinal: false)
    try transcript.receive([token(terminal, 21.36, 30.18)], isFinal: true)
    try expect(transcript.text == timed + " " + terminal, "Recorded timed utterances survive literally, including the recognizer's malformed owner")
    try expect(!transcript.text.contains("Maya"), "No owner is promoted from an earlier untimed observation")
    try expect(transcript.unresolvedUntimedObservationCount == 0, "Ordinary cumulative name and word revisions resolve without promoting untimed wording")

    // Unrelated later speech cannot certify discarded earlier observations.
    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice will prepare the materials by Thursday.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([token("Bob will contact the supplier tomorrow morning.", 30, 34)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "A disjoint timed terminal leaves earlier untimed speech incomplete")
    try expect(transcript.text == "Bob will contact the supplier tomorrow morning.", "Incomplete recognition preserves only literal timed speech")
    try expect(transcript.unresolvedUntimedObservationCount == 1, "Discarded source remains explicit in diagnostics")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Please send the report tomorrow and call Alice before Friday.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([token("Please send the report tomorrow.", 1, 4)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "A shortened prefix cannot erase a genuinely unresolved tail")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Please send the report tomorrow.", 0, 0)], isFinal: false)
    try transcript.receive([token("Please send the report.", 1, 4)], isFinal: true)
    try expect(transcript.untimedReviewRequired, "Minor provisional-tail revisions remain explicit for review rather than falsely rejecting ordinary callbacks")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Unresolved earlier speech.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([], isFinal: true) } catch { rejected = true }
    try expect(rejected, "An empty terminal cannot certify nonempty untimed observations")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Repeat this.", 1, 4)], isFinal: false)
    try transcript.receive([token("Repeat this.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Earlier identical timed words cannot resolve a later untimed repetition")
    try expect(transcript.text == "Repeat this.", "Failure preserves existing timed observations")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([], isFinal: false, observedText: "Speech without source segments.")
    rejected = false
    do { try transcript.receive([token("Different later speech.", 30, 34)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Nonempty text with missing segments remains unresolved")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([], isFinal: false, observedText: "Speech without source segments.")
    try transcript.receive([token("Speech without source segments.", 1, 5)], isFinal: true)
    try expect(transcript.unresolvedUntimedObservationCount == 0, "A later matching timed observation can resolve text that initially lacked segments")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("We'll send Alice's draft tomorrow, tomorrow.", 0, 0)], isFinal: false)
    try transcript.receive([token("We will send Alice’s draft tomorrow.", 1, 5)], isFinal: true)
    try expect(transcript.text == "We will send Alice’s draft tomorrow.", "Contractions, punctuation and speculative repeats do not reject a resolved timed revision")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice will prepare materials by Thursday.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([token("Bob might visit friends after Sunday.", 1, 5)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "The same word count cannot resolve entirely different text")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Alice will prepare the materials by Thursday.", 0, 0)], isFinal: false)
    try transcript.receive([token("Bob will call the supplier tomorrow morning.", 0, 0)], isFinal: false)
    rejected = false
    do { try transcript.receive([token("Bob will call the supplier tomorrow morning.", 30, 34)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "A second unrelated untimed hypothesis cannot discard the first")

    var live = SpeechWindowTranscript(duration: 55, completionPolicy: .ownerTracksIncompleteness)
    try live.receive([token("Unresolved early live speech.", 0, 0)], isFinal: false)
    try live.receive([token("Valid later live speech.", 10, 12)], isFinal: true)
    try expect(live.text == "Valid later live speech." && live.untimedCallbackCount == 1, "A live owner can retain timed partial speech while independently tracking incompleteness")
    rejected = false
    do { try live.receive([token("Invalid live final timing.", 0, 0)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Delegated completeness never authorizes a nonempty untimed final")
    rejected = false
    do { try live.receive([token("Invalid live source range.", 56, 58)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Delegated completeness retains source-time validation")

    transcript = SpeechWindowTranscript(duration: 60)
    for text in ["The", "The next edit", "The next editorial review", "The next editorial review is on November 8 at two in the afternoon the episode outline the speaker and the updated guest list. Are the topics for that review"] {
      try transcript.receive([token(text, 0, 0)], isFinal: false)
    }
    try transcript.receive([token("The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review", 0.3, 11.76)], isFinal: true)
    try expect(transcript.unresolvedUntimedObservationCount == 0, "Recorded EN30 cumulative snapshots resolve through a timed final with ordinary word revisions")

    // This provisional garbled suffix is revised, not a separate utterance.
    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("The difference between a clear story and a collection of unrelated facts. The discussion began with the way of familiar place can sound different to different people a regular walker, notices birds and footsteps while a visitor notices the traffic beyond the trees. Both descriptions belong to the same landscape, the earlier examples in the archive contained ordinary observations rather than dramatic events. Their value came from the speakers attention to a small detail in the explanation detail detail in t", 0, 0)], isFinal: false)
    try transcript.receive([token("The difference between a clear story and a collection of unrelated facts the discussion began with the way a familiar place can sound different to different people a regular walker, notices birds and footsteps while a visitor notices the traffic beyond the trees. Both descriptions belong to the same landscape, the earlier examples in the archive contained ordinary observations rather than dramatic events. Their value came from the speakers attention to a small detail in the explanation of.", 0, 30.18)], isFinal: true)
    try expect(transcript.unresolvedUntimedObservationCount == 0, "A non-prefix provisional revision is compared by bounded alignment, not exact spelling")

    transcript = SpeechWindowTranscript(duration: 60)
    try transcript.receive([token("Earlier speech.", 1, 4)], isFinal: false)
    try transcript.receive([], isFinal: true)
    try expect(transcript.text == "Earlier speech.", "An empty terminal callback must not erase earlier source speech")
    rejected = false
    do { try transcript.receive([token("Outside requested audio", 61, 65)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Out-of-window timing rejects rather than inventing coverage")
    rejected = false
    do { try transcript.receive([token("Later ", 3, 4), token("backwards", 2, 3, first: false)], isFinal: true) } catch { rejected = true }
    try expect(rejected, "Nonmonotonic segments cannot authorize an overlapping replacement")

    transcript = SpeechWindowTranscript(duration: 60)
    do { try transcript.receive([token(String(repeating: "x", count: 65537), 1, 4)], isFinal: false) } catch { }
    try expect(transcript.text.isEmpty, "Oversized observations are rejected or skipped without unbounded retention")
    print("SpeechWindowTranscriptTests: \(checks) checks PASS")
  }
}

