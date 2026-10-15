import Foundation

@main
struct CaptureLivePreviewTests {
  static func main() throws {
    var checks = 0
    func expect(_ value: Bool, _ message: String) throws {
      guard value else { throw NSError(domain: "CaptureLivePreviewTests", code: 1,
        userInfo: [NSLocalizedDescriptionKey: message]) }
      checks += 1
    }
    func token(_ text: String, _ start: Double, _ end: Double) -> SpeechWindowToken {
      SpeechWindowToken(text: text, start: start, end: end, beginsObservation: true)
    }
    func observe(_ state: inout CaptureSpeechTranscript, _ text: String,
      _ tokens: [SpeechWindowToken], generation: Int = 1, final: Bool = false, finalLike: Bool = false) throws {
      _ = try state.receive(generation: generation, tokens: tokens, hasText: !text.isEmpty,
        isFinal: final, finalLike: final || finalLike, observedText: text)
    }

    var state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, "Jutro sprawdzę raport.", [token("Jutro sprawdzę raport.", 0, 0)])
    try expect(state.livePreviewText == "Jutro sprawdzę raport.", "Untimed partial words appear immediately in the live preview")
    try expect(state.interimText.isEmpty && state.finalText.isEmpty && state.needsTranscription,
      "A visible hypothesis cannot become source text or prove completeness")
    try observe(&state, "Jutro sprawdzę.", [token("Jutro sprawdzę.", 0, 0)])
    try expect(state.livePreviewText == "Jutro sprawdzę.", "A shortened hypothesis replaces the old display without concatenation")
    try observe(&state, "Jutro sprawdzę raport.", [token("Jutro sprawdzę raport.", 1, 5)], final: true)
    try expect(state.livePreviewText == "Jutro sprawdzę raport." && state.interimText == "Jutro sprawdzę raport.",
      "Fully timed speech replaces its provisional display without duplication")
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Jutro sprawdzę raport." && state.needsTranscription,
      "A later timed final preserves the existing sticky incomplete provenance policy")
    state.beginRequest(generation: 2, audioStartFrame: 880000)
    try observe(&state, "Then prepare the slides.", [token("Then prepare the slides.", 0, 0)], generation: 2)
    try expect(state.livePreviewText == "Jutro sprawdzę raport. Then prepare the slides.",
      "A new request preview retains committed earlier requests")
    try observe(&state, "Stale callback.", [token("Stale callback.", 0, 0)], generation: 1)
    try expect(state.livePreviewText == "Jutro sprawdzę raport. Then prepare the slides.",
      "A stale callback cannot replace the new request preview")
    _ = state.finishRequest(generation: 2, clean: false, reason: "stop-flush-timeout")
    try expect(state.livePreviewText == "Jutro sprawdzę raport." && state.finalText == "Jutro sprawdzę raport.",
      "An unverified display hypothesis is never committed at stop")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, "Żółć 😀, jutro.", [])
    try expect(state.livePreviewText == "Żółć 😀, jutro." && state.interimText.isEmpty && state.needsTranscription,
      "A bounded literal hypothesis without segments is display-only")
    try observe(&state, "", [])
    try expect(state.livePreviewText == "Żółć 😀, jutro.", "An empty partial cannot blank the current preview")
    try observe(&state, String(repeating: "a", count: 65537), [])
    try expect(state.livePreviewText == "Żółć 😀, jutro." && state.interimText.isEmpty,
      "Oversized display-only hypotheses are discarded while the bounded prior preview survives")
    let encoded = try JSONEncoder().encode(state.diagnostics)
    try expect(!String(decoding: encoded, as: UTF8.self).contains("Żółć"),
      "Durable diagnostic receipts never contain preview text")
    state.reset()
    try expect(state.livePreviewText.isEmpty, "A new capture cannot inherit an older provisional display")

    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, "Pierwsza wypowiedź.", [token("Pierwsza wypowiedź.", 1, 5)], finalLike: true)
    try observe(&state, "Druga", [token("Druga", 0, 0)])
    try expect(state.livePreviewText == "Pierwsza wypowiedź. Druga",
      "A new untimed utterance keeps the earlier confirmed source anchor in the same request")
    try observe(&state, "Druga wypowiedź.", [token("Druga wypowiedź.", 0, 0)])
    try expect(state.livePreviewText == "Pierwsza wypowiedź. Druga wypowiedź.",
      "Only the latest hypothesis replaces the provisional suffix of the confirmed anchor")
    try observe(&state, "Druga wypowiedź.", [token("Druga wypowiedź.", 8, 12)], finalLike: true)
    try expect(state.livePreviewText == "Pierwsza wypowiedź. Druga wypowiedź.",
      "Timed multi-utterance source replaces its provisional suffix without duplication")

    state.reset()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, String(repeating: "a", count: 65537), [token("Zweryfikowane słowa.", 1, 5)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Zweryfikowane słowa." && !state.needsTranscription && state.diagnostics.invalidCallbackCount == 0,
      "A display capacity guard cannot invalidate separately valid canonical source or completeness")
    print("CaptureLivePreviewTests: \(checks) checks PASS")
  }
}
