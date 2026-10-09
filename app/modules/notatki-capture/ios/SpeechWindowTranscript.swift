import Foundation

struct SpeechWindowToken {
  let text: String
  let start: Double
  let end: Double
  let beginsObservation: Bool
}

// Speech results can describe a new utterance instead of the entire request.
// Only observed audio timestamps establish which words a new snapshot revises.
// Never concatenate whole partial strings or deduplicate by matching words.
struct SpeechWindowTranscript {
  enum CompletionPolicy {
    case requireResolvedUntimed
    case ownerTracksIncompleteness
  }
  let duration: Double
  private let completionPolicy: CompletionPolicy
  private(set) var tokens: [SpeechWindowToken] = []
  private(set) var untimedCallbackCount = 0
  private var unresolvedUntimed: [[String]] = []
  private(set) var ambiguousUntimedRevisionCount = 0
  var unresolvedUntimedObservationCount: Int { unresolvedUntimed.count }
  var untimedReviewRequired: Bool { ambiguousUntimedRevisionCount > 0 }
  init(duration: Double, completionPolicy: CompletionPolicy = .requireResolvedUntimed) {
    self.duration = duration
    self.completionPolicy = completionPolicy
  }
  var text: String {
    var result = ""
    for token in tokens {
      if token.beginsObservation && !result.isEmpty &&
        result.last?.isWhitespace == false && token.text.first?.isWhitespace == false { result += " " }
      result += token.text
    }
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
  }
  mutating func receive(_ incoming: [SpeechWindowToken], isFinal: Bool, observedText: String? = nil) throws {
    let observed = observedText ?? incoming.map { $0.text }.joined(separator: " ")
    guard observed.utf16.count <= 65536 else { throw failure("Speech result exceeded its bounded transcript capacity") }
    if incoming.isEmpty {
      if !observed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        untimedCallbackCount += 1
        try retainUntimed(observed)
        if isFinal { throw failure("Final speech result has no source segments") }
      }
      // An empty terminal cannot erase speech or resolve an ignored hypothesis.
      if isFinal { try certifyUntimedResolved() }
      return
    }
    guard incoming.count <= 4096, incoming.reduce(0, { $0 + $1.text.utf16.count }) <= 65536 else {
      throw failure("Speech result exceeded its bounded transcript capacity")
    }
    guard incoming.allSatisfy({ $0.start.isFinite && $0.end.isFinite && $0.start >= 0 && $0.end >= $0.start && $0.end <= duration + 0.25 }),
      zip(incoming, incoming.dropFirst()).allSatisfy({ pair in pair.0.start <= pair.1.start }) else {
      throw failure("Speech result has invalid audio timestamps")
    }
    guard incoming.allSatisfy({ $0.end > $0.start }) else {
      untimedCallbackCount += 1
      // Even one placeholder can falsely reset the whole snapshot to zero.
      // Untimed/mixed interim words cannot erase earlier fully timed speech;
      // a nonempty final with such timing cannot certify the request.
      try retainUntimed(observed)
      if isFinal { throw failure("Final speech result has no usable audio timestamps") }
      return
    }
    let start = incoming[0].start
    let prefix = tokens.filter { $0.end <= start + 0.001 && $0.start < start }
    let merged = prefix + incoming
    guard merged.count <= 4096, merged.reduce(0, { $0 + $1.text.utf16.count }) <= 65536 else {
      throw failure("Speech result exceeded its bounded transcript capacity")
    }
    // Replace the whole observed suffix, including a shortened hypothesis.
    // A cumulative result starting at zero replaces every older observation;
    // a later disjoint utterance preserves its timed prefix, even if identical.
    tokens = merged
    // Only a newer fully timed observation can account for ignored content.
    // Earlier identical words cannot resolve a later untimed repetition.
    try resolveUntimed(observed)
    if isFinal { try certifyUntimedResolved() }
  }
  private mutating func retainUntimed(_ text: String) throws {
    // Live capture owns its sticky incomplete marker and must retain valid
    // later speech even when a request cannot certify its earlier hypotheses.
    if case .ownerTracksIncompleteness = completionPolicy { return }
    let words = Self.hypothesisWords(text)
    guard !words.isEmpty else { return }
    guard words.count <= 1024 else { throw failure("Untimed speech exceeded its bounded hypothesis capacity") }
    var retained: [[String]] = []
    for old in unresolvedUntimed {
      if let edits = Self.alignmentEdits(old, words) {
        if edits > 0 { ambiguousUntimedRevisionCount += 1 }
      } else if old.count <= 2 && words.count > old.count {
        // One or two provisional words frequently change before the recognizer
        // has a complete phrase. Keep the growing hypothesis and flag review.
        ambiguousUntimedRevisionCount += 1
      } else { retained.append(old) }
    }
    retained.append(words)
    guard retained.reduce(0, { $0 + $1.count }) <= 1024,
          retained.reduce(0, { total, words in total + words.reduce(0, { $0 + $1.utf16.count }) }) <= 65536 else {
      throw failure("Untimed speech exceeded its bounded hypothesis capacity")
    }
    unresolvedUntimed = retained
  }
  private mutating func resolveUntimed(_ text: String) throws {
    guard !unresolvedUntimed.isEmpty else { return }
    let words = Self.hypothesisWords(text)
    guard words.count <= 4096 else { throw failure("Speech exceeded its bounded hypothesis alignment capacity") }
    var retained: [[String]] = []
    for old in unresolvedUntimed {
      if let edits = Self.alignmentEdits(old, words) {
        if edits > 0 { ambiguousUntimedRevisionCount += 1 }
      } else { retained.append(old) }
    }
    unresolvedUntimed = retained
  }
  private func certifyUntimedResolved() throws {
    if case .ownerTracksIncompleteness = completionPolicy { return }
    guard unresolvedUntimed.isEmpty else { throw failure("Speech result left unresolved untimed observations; audio has been kept") }
  }
  private static func equivalentWord(_ left: String, _ right: String) -> Bool {
    left == right || (min(left.count, right.count) >= 3 && (left.hasPrefix(right) || right.hasPrefix(left)))
  }
  private static func hypothesisWords(_ text: String) -> [String] {
    // Punctuation/case and speculative adjacent repeats are irrelevant to
    // hypothesis identity; only fully timed tokens supply accepted source text.
    let normalized = text.lowercased().replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "’", with: "")
    var words: [String] = []
    for word in normalized.components(separatedBy: CharacterSet.alphanumerics.inverted) where !word.isEmpty {
      if let last = words.last, equivalentWord(last, word) { continue }
      words.append(word)
    }
    return words
  }
  private struct AlignmentCell {
    var edits: Int
    var matches: Int
  }
  private static func preferred(_ left: AlignmentCell, _ right: AlignmentCell) -> AlignmentCell {
    if left.edits != right.edits { return left.edits < right.edits ? left : right }
    return left.matches >= right.matches ? left : right
  }
  private static func alignmentEdits(_ observed: [String], _ replacement: [String]) -> Int? {
    guard !observed.isEmpty, !replacement.isEmpty else { return nil }
    // This is a bounded provenance heuristic, not a semantic quality test.
    // At most 20% (rounded up) of a provisional phrase may be revised, with
    // at least half its words matched. A substantial missing tail or unrelated
    // utterance remains unresolved; minor revisions explicitly require review.
    let budget = (observed.count + 4) / 5
    guard replacement.count >= observed.count - budget else { return nil }
    let minimumMatches = (observed.count + 1) / 2
    // Zero initial costs allow a cumulative timed result to contain the
    // provisional utterance after already observed earlier speech.
    var previous = Array(repeating: AlignmentCell(edits: 0, matches: 0), count: replacement.count + 1)
    for (offset, old) in observed.enumerated() {
      var current = [AlignmentCell(edits: offset + 1, matches: 0)]
      current.reserveCapacity(replacement.count + 1)
      for index in 1...replacement.count {
        let same = equivalentWord(old, replacement[index - 1])
        let deletion = AlignmentCell(edits: previous[index].edits + 1, matches: previous[index].matches)
        let insertion = AlignmentCell(edits: current[index - 1].edits + 1, matches: current[index - 1].matches)
        let revision = AlignmentCell(edits: previous[index - 1].edits + (same ? 0 : 1), matches: previous[index - 1].matches + (same ? 1 : 0))
        current.append(preferred(preferred(deletion, insertion), revision))
      }
      previous = current
    }
    return previous.dropFirst(max(1, observed.count - budget))
      .filter { $0.edits <= budget && $0.matches >= minimumMatches }.map { $0.edits }.min()
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "NotatkiSpeechWindow", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
