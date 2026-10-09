import AVFoundation
import Speech

@available(iOS 26.0, macOS 26.0, *)
enum LocalSpeechAnalyzer {
  static func identifier(_ locale: Locale) -> String { locale.identifier.replacingOccurrences(of: "_", with: "-").lowercased() }
  static func configuration(locale: String) async -> (SpeechTranscriber?, String?) {
    guard SpeechTranscriber.isAvailable else { return (nil, "analyzer-device-unavailable") }
    guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: locale)) else {
      return (nil, "analyzer-locale-unsupported")
    }
    let installed = await SpeechTranscriber.installedLocales
    guard installed.contains(where: { identifier($0) == identifier(supported) }) else {
      return (nil, "analyzer-assets-not-installed")
    }
    // Assets are checked only. Downloading/installing models requires a
    // separate user choice; this experiment never requests network assets.
    let transcriber = SpeechTranscriber(locale: supported, transcriptionOptions: [],
      reportingOptions: [], attributeOptions: [.audioTimeRange])
    guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
      return (nil, "analyzer-assets-not-ready")
    }
    return (transcriber, nil)
  }
  static func capabilities() async -> [String: Any] {
    let available = SpeechTranscriber.isAvailable
    let supported = available ? await SpeechTranscriber.supportedLocales : []
    let installed = available ? await SpeechTranscriber.installedLocales : []
    var locales: [String: Any] = [:]
    for requested in ["pl-PL", "en-US"] {
      let recognizer = SFSpeechRecognizer(locale: Locale(identifier: requested))
      let equivalent = available ? await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: requested)) : nil
      let (readyTranscriber, _) = await configuration(locale: requested)
      locales[requested] = [
        "recognizerAvailable": recognizer?.isAvailable ?? false,
        "recognizerOnDevice": recognizer?.supportsOnDeviceRecognition ?? false,
        "analyzerSupported": equivalent != nil,
        // Match backend selection, including readiness of every module asset.
        "analyzerInstalled": readyTranscriber != nil,
      ]
    }
    return ["version": 1, "analyzerAvailable": available,
      "supportedLocales": supported.map(\.identifier), "installedLocales": installed.map(\.identifier), "locales": locales]
  }
  static func transcribe(url: URL, transcriber: SpeechTranscriber,
                         onResult: @escaping @Sendable (String, Double, Double, Bool) throws -> Void) async throws -> Double {
    // Adjacent windows can reuse the system model without retaining it for
    // the whole process or overriding system resource limits.
    let analyzer = SpeechAnalyzer(modules: [transcriber],
      options: SpeechAnalyzer.Options(priority: .userInitiated, modelRetention: .lingering))
    let results = Task {
      do {
        for try await result in transcriber.results {
          try Task.checkCancellation()
          try onResult(String(result.text.characters), CMTimeGetSeconds(result.range.start),
                       CMTimeGetSeconds(CMTimeRangeGetEnd(result.range)), result.isFinal)
        }
      } catch {
        await analyzer.cancelAndFinishNow()
        throw error
      }
    }
    return try await withTaskCancellationHandler(operation: {
      do {
        try Task.checkCancellation()
        let file = try AVAudioFile(forReading: url)
        guard let lastSample = try await analyzer.analyzeSequence(from: file) else {
          throw NSError(domain: "NotatkiSpeechAnalyzer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Analyzer received an empty audio window"])
        }
        try Task.checkCancellation()
        // Input consumption and one phrase's isFinal are not file completion.
        try await analyzer.finalizeAndFinish(through: lastSample)
        try await results.value
        try Task.checkCancellation()
        return CMTimeGetSeconds(lastSample)
      } catch {
        await analyzer.cancelAndFinishNow()
        results.cancel()
        _ = try? await results.value
        throw error
      }
    }, onCancel: { Task { await analyzer.cancelAndFinishNow() } })
  }
}
