import Foundation

@main
struct CaptureSpeechTranscriptTests {
  static func main() throws {
    var checks = 0
    func expect(_ value: Bool, _ message: String) throws {
      guard value else { throw NSError(domain: "CaptureSpeechTranscriptTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
      checks += 1
    }
    func token(_ text: String, _ start: Double, _ end: Double) -> SpeechWindowToken {
      SpeechWindowToken(text: text, start: start, end: end, beginsObservation: true)
    }
    func observe(_ state: inout CaptureSpeechTranscript, _ words: [SpeechWindowToken], generation: Int = 1, final: Bool = false, finalLike: Bool = false) throws {
      _ = try state.receive(generation: generation, tokens: words, hasText: !words.isEmpty, isFinal: final, finalLike: finalLike)
    }

    var state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Iga przygotuje opis.", 0.5, 5)], finalLike: true)
    try observe(&state, [token("Bruno zadzwoni jutro.", 8, 12)], finalLike: true)
    try expect(state.finalText.isEmpty, "Final-like observations do not finish the whole request")
    try observe(&state, [token("Kwota wynosi 120 zł.", 35, 48)], final: true)
    try expect(state.finishRequest(generation: 1, clean: true, reason: "final"), "Active request finishes once")
    try expect(state.finalText == "Iga przygotuje opis. Bruno zadzwoni jutro. Kwota wynosi 120 zł.", "Disjoint utterances survive one request")
    try expect(!state.needsTranscription, "A validated terminal can finish the request; this does not assert all spoken-word accuracy")
    try expect(!state.finishRequest(generation: 1, clean: true, reason: "duplicate"), "Duplicate finish cannot append speech twice")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Iga przygotuje błędny długi opis.", 0.5, 5)])
    try observe(&state, [token("Iga sprawdzi opis.", 0.5, 3)])
    try observe(&state, [token("Iga sprawdzi opis.", 0.5, 3), token("Bruno zadzwoni.", 8, 12)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Iga sprawdzi opis. Bruno zadzwoni.", "Shortened/cumulative revisions replace prior false wording without duplicate concatenation")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Powtórz pomiar.", 1, 3)], finalLike: true)
    try observe(&state, [token("Powtórz pomiar.", 10, 12)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Powtórz pomiar. Powtórz pomiar.", "Equal words at different source times remain distinct")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Zachowany początek.", 1, 4)], finalLike: true)
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "empty-final")
    try expect(state.finalText == "Zachowany początek.", "Empty terminal callback cannot erase validated earlier speech")
    try expect(!state.needsTranscription, "Empty terminal retains already validated timed observations")
    try expect(state.diagnostics.emptyFinalCallbackCount == 1, "Empty terminal remains observable")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Niepotwierdzona hipoteza.", 0, 0)])
    try expect(state.interimText.isEmpty, "Untimed placeholder cannot become source proof")
    try observe(&state, [token("Zweryfikowany pełny tekst.", 0.1, 5)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Zweryfikowany pełny tekst." && state.needsTranscription, "Later fully timed text survives, but cannot prove recovery of the ignored early nonempty observation")
    try expect(state.diagnostics.untimedCallbackCount == 1, "Skipped placeholder remains diagnostic")
    try expect(state.diagnostics.invalidCallbackCount == 0 && !state.diagnostics.reasonCodes.contains("invalid-terminal-observation"), "A valid timed live terminal is retained as incomplete rather than rejected by the file-import certification policy")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    var rejected = false
    do { try observe(&state, [token("Niepotwierdzony finał.", 0, 0)], final: true) } catch { rejected = true }
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(rejected && state.needsTranscription && state.finalText.isEmpty, "Untimed nonempty terminal rejects clean completeness")
    try expect(state.diagnostics.untimedCallbackCount == 1 && state.diagnostics.invalidCallbackCount == 1, "Rejected placeholder terminal remains counted")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsze żądanie.", 1, 5)], final: true)
    _ = state.finishRequest(generation: 1, clean: false, reason: "rotation")
    state.beginRequest(generation: 2, audioStartFrame: 880000)
    try observe(&state, [token("Drugie żądanie.", 0.1, 4)], generation: 2, final: true)
    _ = state.finishRequest(generation: 2, clean: true, reason: "final")
    try expect(state.finalText == "Pierwsze żądanie. Drugie żądanie.", "New request timestamp zero cannot overwrite earlier committed request")
    try expect(state.needsTranscription, "Rotation remains an explicit coverage gap")
    try expect(state.diagnostics.requestsStarted == 2, "Request resets are counted")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 3, audioStartFrame: 160000)
    try observe(&state, [token("Aktualny tekst.", 1, 4)], generation: 3)
    let stale = try state.receive(generation: 2, tokens: [token("Stary tekst.", 1, 4)], hasText: true, isFinal: true, finalLike: true)
    try expect(!stale && state.interimText == "Aktualny tekst.", "Stale callbacks cannot mutate a newer request")
    _ = state.finishRequest(generation: 3, clean: false, reason: "stop-flush-timeout")
    try expect(state.finalText == "Aktualny tekst." && state.needsTranscription, "Timed partial speech survives bounded stop timeout with incomplete provenance")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Wcześniejszy poprawny tekst.", 1, 4)])
    rejected = false
    do { try observe(&state, [token("Nieprawidłowy czas.", -1, 2)], final: true) } catch { rejected = true }
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(rejected && state.finalText == "Wcześniejszy poprawny tekst." && state.needsTranscription, "Invalid terminal timing preserves prior source but rejects completeness")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Granica wypowiedzi.", 1, 4)], finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "Final-like metadata alone cannot certify terminal completion")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Wcześniejsza wypowiedź.", 1, 4)], finalLike: true)
    try observe(&state, [token("Późniejsza wypowiedź bez czasu.", 0, 0)], finalLike: true)
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Wcześniejsza wypowiedź." && state.needsTranscription, "Empty terminal must not certify omission of an unresolved late untimed utterance")
    try expect(state.diagnostics.reasonCodes.contains("unresolved-untimed-observation"), "The ignored utterance has a precise durable reason")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)], finalLike: true)
    try observe(&state, [token("Niepotwierdzona druga wypowiedź.", 0, 0)], finalLike: true)
    try observe(&state, [token("Trzecia wypowiedź.", 15, 18)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Pierwsza wypowiedź. Trzecia wypowiedź." && state.needsTranscription, "A later disjoint timed result does not prove recovery of missing middle speech")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)])
    try observe(&state, [token("Późniejszy placeholder.", 0, 0)])
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4), token("Druga wypowiedź.", 6, 10)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Pierwsza wypowiedź. Druga wypowiedź." && state.needsTranscription, "Cumulative timed text is retained without claiming every ignored late word was recovered")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)])
    _ = try state.receive(generation: 1, tokens: [], hasText: true, isFinal: false, finalLike: true)
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "A nonempty observation without segments is also a pending late utterance")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)])
    try observe(&state, [token("Placeholder ", 0, 0), token("z częściowym czasem.", 6, 9)])
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Pierwsza wypowiedź." && state.needsTranscription, "Mixed late placeholders and a same-ending cumulative snapshot cannot certify missing speech")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwsza wypowiedź.", 1, 4)])
    try observe(&state, [token("Późniejszy placeholder.", 0, 0)], finalLike: true)
    try observe(&state, [token("Pierwsza wypowiedź po korekcie.", 1, 4)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "A cumulative revision ending at the old timed end cannot resolve a late utterance")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Zachowany tekst.", 1, 4)])
    rejected = false
    do { try observe(&state, [token("Błędne skrajne sekundy.", Double.greatestFiniteMagnitude, Double.greatestFiniteMagnitude)], final: true) } catch { rejected = true }
    let extremeDiagnostics = try JSONEncoder().encode(state.diagnostics)
    try expect(rejected && !extremeDiagnostics.isEmpty, "Rejected extreme finite seconds must not poison durable JSON with infinite milliseconds")
    try expect(state.diagnostics.observations.last?.observedStartMs == nil && state.diagnostics.observations.last?.observedEndMs == nil, "Out-of-request diagnostic times are omitted")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Prawidłowy brzeg czasu.", 55, 55.25)], final: true)
    try expect(state.diagnostics.observations.last?.observedStartMs == 55000 && state.diagnostics.observations.last?.observedEndMs == 55250, "Valid request-bound timestamps remain exact finite milliseconds")

    try expect(!CaptureSpeechTranscript.isValidSourceRange(NSRange(location: NSNotFound, length: 1), utf16Length: 10), "A missing first/single source location cannot bypass validation")
    try expect(!CaptureSpeechTranscript.isValidSourceRange(NSRange(location: 0, length: Int.max), utf16Length: 10), "Malformed first/single range length is rejected without addition overflow")
    try expect(!CaptureSpeechTranscript.isValidSourceRange(NSRange(location: 9, length: 2), utf16Length: 10), "Each source range must fit the formatted UTF16 text")
    try expect(CaptureSpeechTranscript.isValidSourceRange(NSRange(location: 0, length: 10), utf16Length: 10) && CaptureSpeechTranscript.isValidSourceRange(NSRange(location: 10, length: 0), utf16Length: 10), "Valid whole-text and terminal-empty source ranges remain accepted")
    let punctuated = "«Żółć 😀», jutro." as NSString
    try expect(CaptureSpeechTranscript.isValidSourceRange(NSRange(location: 0, length: punctuated.length), utf16Length: punctuated.length) && punctuated.substring(with: NSRange(location: 0, length: punctuated.length)) == "«Żółć 😀», jutro.", "Range bounds preserve exact UTF16 source punctuation and Unicode")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Wcześniejsza wypowiedź bez czasu.", 0, 0)], finalLike: true)
    try observe(&state, [token("Późniejsza oddzielna wypowiedź.", 10, 12)])
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Późniejsza oddzielna wypowiedź." && state.needsTranscription, "Early untimed speech cannot be certified by later disjoint speech and an empty final")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Wcześniejsza wypowiedź bez czasu.", 0, 0)], finalLike: true)
    try observe(&state, [token("Późniejsza oddzielna wypowiedź.", 10, 12)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "A nonempty disjoint final also cannot certify ignored early speech")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    _ = try state.receive(generation: 1, tokens: [], hasText: true, isFinal: false, finalLike: true)
    try observe(&state, [token("Późniejszy tekst.", 10, 12)])
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "Early nonempty speech without segments remains unresolved through an empty final")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    _ = try state.receive(generation: 1, tokens: [], hasText: true, isFinal: false, finalLike: false)
    try observe(&state, [token("Późniejszy tekst.", 10, 12)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "Early nonempty speech without segments remains unresolved through a nonempty final")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Placeholder ", 0, 0), token("fragment z czasem.", 0.1, 1)])
    try observe(&state, [token("Późniejszy tekst.", 10, 12)])
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: true, finalLike: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "Ignored early mixed timing remains unresolved through an empty final")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Placeholder ", 0, 0), token("fragment z czasem.", 0.1, 1)])
    try observe(&state, [token("Późniejszy tekst.", 10, 12)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.needsTranscription, "Ignored early mixed timing remains unresolved through a nonempty final")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Powtórz pomiar.", 0, 0)])
    try observe(&state, [token("Powtórz pomiar.", 0.1, 3), token("Dalszy tekst.", 5, 8)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Powtórz pomiar. Dalszy tekst." && state.needsTranscription, "Matching literal words and near-origin timing do not prove an ignored observation was the same utterance")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    _ = try state.receive(generation: 1, tokens: [], hasText: false, isFinal: false, finalLike: false)
    try observe(&state, [token("Poprawny tekst z czasem.", 0.1, 5)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Poprawny tekst z czasem." && !state.needsTranscription, "An empty no-text callback does not create missing-source uncertainty")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Pierwszy zachowany fragment.", 1, 4)])
    state.beginRequest(generation: 2, audioStartFrame: 880000)
    try observe(&state, [token("Nowe żądanie.", 0.5, 4)], generation: 2, final: true)
    _ = state.finishRequest(generation: 2, clean: true, reason: "final")
    try expect(state.finalText == "Pierwszy zachowany fragment. Nowe żądanie." && state.needsTranscription, "Replacing a request preserves validated partial speech with incomplete provenance")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    rejected = false
    do { try observe(&state, [token("Poza zakresem.", 56, 58)], final: true) } catch { rejected = true }
    try expect(rejected && state.needsTranscription, "Out-of-request source time cannot certify speech")

    // A wholly synthetic late utterance keeps its literal source while an
    // independently timed earlier utterance survives in the same request.
    let syntheticTail = "Skorygowany parametr to 275 litrów dziś zamontowałem nowy zawór w szklarni dostawa sadzonek nastąpi 7 marca o godzinie szesnastej trzydzieści Lena przetestuje sterownik nawadniania a Hubert przygotuje instrukcję montażu następnie porównamy odczyty czujników wilgotności podłoża i sprawdzimy szczelność całej instalacji"
    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    try observe(&state, [token("Serwis szklarni obejmuje sprawdzenie filtrów.", 0.5, 5)], finalLike: true)
    try observe(&state, [token(syntheticTail, 25, 48.58)], final: true)
    _ = state.finishRequest(generation: 1, clean: true, reason: "final")
    try expect(state.finalText == "Serwis szklarni obejmuje sprawdzenie filtrów. " + syntheticTail, "Synthetic late utterance remains literal while an independently timed prefix survives")

    state = CaptureSpeechTranscript()
    state.beginRequest(generation: 1, audioStartFrame: 0)
    for index in 0..<100 { try observe(&state, [token("Tekst \(index).", 1, 4)]) }
    try expect(state.diagnostics.observations.count <= 64 && state.diagnostics.observationsTruncated, "Privacy-preserving diagnostics remain bounded")
    let encoded = try JSONEncoder().encode(state.diagnostics)
    try expect(!String(decoding: encoded, as: UTF8.self).contains("Tekst"), "Diagnostic receipts never duplicate recognized raw text")
    print("CaptureSpeechTranscriptTests: \(checks) checks PASS")
  }
}
