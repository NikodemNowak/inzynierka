import AVFoundation
import Speech
import ExpoModulesCore

// Decode one bounded window directly from the original codec. There is no
// whole-file PCM allocation or mandatory second permanent audio copy.
final class LocalSpeechWindows {
  static let shared = LocalSpeechWindows()
  private let decoder = DispatchQueue(label: "notatki.import.decoder", qos: .userInitiated)
  private let timeoutQueue = DispatchQueue(label: "notatki.import.timeout", qos: .utility)
  private let lock = NSLock()
  private var jobs: [String: WindowJob] = [:]
  // Accessed only on decoder. Speech itself still runs one request at a time.
  private var recognizers: [String: SFSpeechRecognizer] = [:]
  private let callbackQueue: OperationQueue = {
    let queue = OperationQueue(); queue.name = "notatki.import.speech.callbacks"
    queue.maxConcurrentOperationCount = 1; queue.qualityOfService = .userInitiated
    return queue
  }()
  private final class WindowJob {
    let promise: Promise
    var cancelled = false
    var done = false
    var finalizing = false
    var task: SFSpeechRecognitionTask?
    var analyzerTask: Task<Void, Never>?
    var recognizer: SFSpeechRecognizer?
    var file: URL?
    let startMs: Double
    let durationMs: Double
    var decoded: DecodedSpeechWindow?
    var requestTaskHintRawValue: Int?
    var transcript: SpeechWindowTranscript
    var analyzerTranscript: SpeechAnalyzerTranscript
    let requestedBackend: String
    let locale: String
    let began = ProcessInfo.processInfo.systemUptime
    var backend = "recognizer"
    var fallbackReason: String?
    var recognizerReused = false
    var setupMs: Double = 0
    var decodeMs: Double = 0
    var recognitionBegan: Double?
    var firstResultMs: Double?
    var finalizedThroughMs: Double?
    var cancellationReason: String?
    var callbackCount = 0
    var finalCallbackCount = 0
    var finalLikeCallbackCount = 0
    var callbackLog: [[String: Any]] = []
    var callbacksTruncated = false
    init(_ promise: Promise, startMs: Double, durationMs: Double, locale: String, backend: String) {
      self.promise = promise; self.startMs = startMs; self.durationMs = durationMs
      self.locale = locale; requestedBackend = backend
      transcript = SpeechWindowTranscript(duration: durationMs / 1000)
      analyzerTranscript = SpeechAnalyzerTranscript(duration: durationMs / 1000)
    }
    var text: String { backend == "analyzer" ? analyzerTranscript.text : transcript.text }
    var tokens: [SpeechWindowToken] { backend == "analyzer" ? analyzerTranscript.tokens : transcript.tokens }
    func diagnostics() -> [String: Any] {
      var result: [String: Any] = [
        "version": 1, "requestedStartMs": startMs, "requestedDurationMs": durationMs,
        "decodedFrames": decoded?.frames ?? 0, "decodedDurationMs": decoded?.durationMs ?? 0,
        "decodedSampleRate": decoded?.sampleRate ?? 16000, "callbackCount": callbackCount,
        "finalCallbackCount": finalCallbackCount, "finalLikeCallbackCount": finalLikeCallbackCount,
        "untimedCallbackCount": transcript.untimedCallbackCount, "mergedSegmentCount": tokens.count,
        "unresolvedUntimedObservationCount": transcript.unresolvedUntimedObservationCount,
        "ambiguousUntimedRevisionCount": transcript.ambiguousUntimedRevisionCount,
        "untimedReviewRequired": transcript.untimedReviewRequired,
        "untimedResolutionMethod": "bounded-hypothesis-alignment-v1",
        "callbacksTruncated": callbacksTruncated, "callbacks": callbackLog,
        "requestedBackend": requestedBackend, "backend": backend,
        "recognizerReused": recognizerReused, "setupMs": setupMs, "decodeMs": decodeMs,
        "totalMs": (ProcessInfo.processInfo.systemUptime - began) * 1000,
      ]
      if let decoded = decoded { result["decodePath"] = decoded.path }
      if let recognitionBegan = recognitionBegan { result["recognitionMs"] = (ProcessInfo.processInfo.systemUptime - recognitionBegan) * 1000 }
      if let firstResultMs = firstResultMs { result["firstResultMs"] = firstResultMs }
      if let finalizedThroughMs = finalizedThroughMs { result["finalizedThroughMs"] = finalizedThroughMs }
      if let fallbackReason = fallbackReason { result["fallbackReason"] = fallbackReason }
      if let hint = requestTaskHintRawValue { result["requestTaskHintRawValue"] = hint }
      if let first = tokens.first { result["observedStartMs"] = first.start * 1000 }
      if let last = tokens.last { result["observedEndMs"] = last.end * 1000 }
      return result
    }
  }
  static func source(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else { throw CaptureFailure.message("Only local audio files are accepted") }
    return url
  }
  static func inspect(_ uri: String) throws -> [String: Any] {
    let file = try AVAudioFile(forReading: source(uri))
    let format = file.processingFormat
    let duration = Double(file.length) * 1000 / format.sampleRate
    guard format.sampleRate > 0, file.length > 0, duration.isFinite,
          duration <= 1800000, format.channelCount > 0, format.channelCount <= 8 else {
      throw CaptureFailure.message(duration > 1800000 ? "audio-duration-limit" : "invalid-audio-duration")
    }
    return ["durationMs": duration, "sampleRate": format.sampleRate, "channels": format.channelCount]
  }
  func transcribe(uri: String, startMs: Double, durationMs: Double, locale: String, id: String,
                  backend: String = "recognizer", promise: Promise) {
    guard backend == "recognizer" || backend == "analyzer-if-installed" else {
      promise.reject("speech-backend", "Unknown speech backend"); return
    }
    lock.lock()
    guard jobs.isEmpty else { lock.unlock(); promise.reject("speech-busy", "Another audio transcription is active"); return }
    let job = WindowJob(promise, startMs: startMs, durationMs: durationMs, locale: locale, backend: backend); jobs[id] = job; lock.unlock()
    // A blocked file read/conversion must not prevent the stop request itself.
    // The decoder still owns its file until it acknowledges cancellation.
    timeoutQueue.asyncAfter(deadline: .now() + 120) { [weak job] in
      guard let job = job else { return }
      self.requestStop(id, job: job, reason: "On-device transcription timed out")
    }
    decoder.async {
      do {
        let inspection = try Self.inspect(uri)
        let total = inspection["durationMs"] as! Double
        guard startMs.isFinite, startMs >= 0, durationMs.isFinite, durationMs > 0,
              durationMs <= 60000, startMs < total, startMs + durationMs <= total + 1 else {
          throw CaptureFailure.message("Invalid speech window")
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("notatki-speech-windows", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let url = folder.appendingPathComponent(UUID().uuidString + ".wav")
        self.lock.lock(); job.file = url; self.lock.unlock()
        let decodeBegan = ProcessInfo.processInfo.systemUptime
        let decoded = try SpeechWindowDecoder.decode(sourceURL: Self.source(uri), startMs: startMs, durationMs: durationMs, outputURL: url) {
          self.lock.lock(); let cancelled = job.cancelled || job.done; self.lock.unlock(); return cancelled
        }
        self.lock.lock()
        job.decoded = decoded
        job.decodeMs = (ProcessInfo.processInfo.systemUptime - decodeBegan) * 1000
        if job.cancelled || job.done { self.lock.unlock(); self.finish(id, job: job, text: nil, error: "Transcription cancelled"); return }
        self.lock.unlock()
        if backend == "analyzer-if-installed", #available(iOS 26.0, macOS 26.0, *) {
          self.startAnalyzer(id, job: job, url: url)
        } else {
          if backend == "analyzer-if-installed" { self.lock.lock(); job.fallbackReason = "analyzer-os-unavailable"; self.lock.unlock() }
          self.startRecognizer(id, job: job, url: url)
        }
      } catch { self.finish(id, job: job, text: nil, error: error.localizedDescription) }
    }
  }
  private func startRecognizer(_ id: String, job: WindowJob, url: URL) {
    lock.lock(); let stopped = job.cancelled || job.done; lock.unlock()
    if stopped { finish(id, job: job, text: nil, error: "Transcription cancelled"); return }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      finish(id, job: job, text: nil, error: "Speech recognition permission is missing"); return
    }
    let cached = recognizers[job.locale]
    guard let recognizer = cached ?? SFSpeechRecognizer(locale: Locale(identifier: job.locale)),
          recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
      finish(id, job: job, text: nil, error: "On-device speech for this language is unavailable"); return
    }
    if cached == nil {
      if recognizers.count >= 2 { recognizers.removeAll() }
      recognizer.queue = callbackQueue; recognizers[job.locale] = recognizer
    }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true; request.shouldReportPartialResults = true; request.addsPunctuation = true
    request.taskHint = .dictation
    lock.lock()
    job.recognizer = recognizer; job.recognizerReused = cached != nil
    job.requestTaskHintRawValue = request.taskHint.rawValue
    job.setupMs = (ProcessInfo.processInfo.systemUptime - job.began) * 1000 - job.decodeMs
    job.recognitionBegan = ProcessInfo.processInfo.systemUptime
    lock.unlock()
    // Handlers can execute immediately; never create/cancel under state lock.
    let task = recognizer.recognitionTask(with: request) { [weak job] result, error in
      guard let job = job else { return }
      self.receive(id, job: job, result: result, error: error)
    }
    lock.lock(); let cancelled = job.cancelled || job.done
    if !cancelled { job.task = task }
    lock.unlock()
    if cancelled { task.cancel(); finish(id, job: job, text: nil, error: "Transcription cancelled") }
  }
  @available(iOS 26.0, macOS 26.0, *)
  private func startAnalyzer(_ id: String, job: WindowJob, url: URL) {
    // Worker creation and publication are protected so cancellation cannot
    // delete its input while the analyzer is still reading it.
    lock.lock()
    if job.cancelled || job.done { lock.unlock(); finish(id, job: job, text: nil, error: "Transcription cancelled"); return }
    job.analyzerTask = Task {
      let (transcriber, fallback) = await LocalSpeechAnalyzer.configuration(locale: job.locale)
      let stopped = self.withState {
        let stopped = job.cancelled || job.done
        if !stopped { job.fallbackReason = fallback }
        return stopped
      }
      if stopped { self.finish(id, job: job, text: nil, error: "Transcription cancelled"); return }
      guard let transcriber = transcriber else {
        self.decoder.async { self.startRecognizer(id, job: job, url: url) }; return
      }
      self.withState {
        job.backend = "analyzer"; job.setupMs = (ProcessInfo.processInfo.systemUptime - job.began) * 1000 - job.decodeMs
        job.recognitionBegan = ProcessInfo.processInfo.systemUptime
      }
      do {
        let through = try await LocalSpeechAnalyzer.transcribe(url: url, transcriber: transcriber) { text, start, end, final in
          try self.receiveAnalyzer(id, job: job, text: text, start: start, end: end, isFinal: final)
        }
        let text = try self.withState {
          try job.analyzerTranscript.complete(finalizedThrough: through)
          job.finalizedThroughMs = through * 1000
          return job.text
        }
        self.finish(id, job: job, text: text, error: nil)
      } catch { self.finish(id, job: job, text: nil, error: error.localizedDescription) }
    }
    lock.unlock()
  }
  private func withState<T>(_ operation: () throws -> T) rethrows -> T {
    lock.lock(); defer { lock.unlock() }
    return try operation()
  }
  func cancel(_ id: String) {
    lock.lock(); let job = jobs[id]; lock.unlock()
    if let job = job { requestStop(id, job: job, reason: "Transcription cancelled") }
  }
  private func requestStop(_ id: String, job: WindowJob, reason: String) {
    lock.lock()
    guard jobs[id] === job, !job.done else { lock.unlock(); return }
    job.cancelled = true; job.cancellationReason = job.cancellationReason ?? reason
    let task = job.task; let analyzer = job.analyzerTask; lock.unlock()
    analyzer?.cancel(); task?.cancel()
    // Decoder/analyzer owns cleanup until its worker acknowledges cancellation.
    if task != nil { finish(id, job: job, text: nil, error: reason) }
  }
  private func receiveAnalyzer(_ id: String, job: WindowJob, text: String, start: Double, end: Double, isFinal: Bool) throws {
    lock.lock(); defer { lock.unlock() }
    guard jobs[id] === job, !job.done, !job.cancelled else { throw CancellationError() }
    try job.analyzerTranscript.receive(text: text, start: start, end: end, isFinal: isFinal)
    recordFirstResult(job)
    job.callbackCount += 1
    if isFinal { job.finalCallbackCount += 1; job.finalLikeCallbackCount += 1 }
    appendCallback(job, record: ["index": job.callbackCount, "isFinal": isFinal, "finalLike": isFinal,
      "text": String(text.prefix(512)), "segmentCount": text.isEmpty ? 0 : 1, "startMs": start * 1000, "endMs": end * 1000])
  }
  private func recordFirstResult(_ job: WindowJob) {
    if job.firstResultMs == nil, let start = job.recognitionBegan {
      job.firstResultMs = (ProcessInfo.processInfo.systemUptime - start) * 1000
    }
  }
  private func appendCallback(_ job: WindowJob, record: [String: Any]) {
    if job.callbackLog.count == 96 { job.callbackLog.remove(at: 48); job.callbacksTruncated = true }
    job.callbackLog.append(record)
  }
  private func receive(_ id: String, job: WindowJob, result: SFSpeechRecognitionResult?, error: Error?) {
    lock.lock()
    guard jobs[id] === job, !job.done, !job.cancelled, !job.finalizing else { lock.unlock(); return }
    if let error = error { lock.unlock(); finish(id, job: job, text: nil, error: error.localizedDescription); return }
    guard let result = result else { lock.unlock(); return }
    do {
      let transcription = result.bestTranscription
      let formatted = transcription.formattedString as NSString
      let segments = transcription.segments
      guard segments.count <= 4096, formatted.length <= 65536 else { throw CaptureFailure.message("Speech result exceeded its bounded transcript capacity") }
      var tokens: [SpeechWindowToken] = []
      for (index, segment) in segments.enumerated() {
        let begin = index == 0 ? 0 : segment.substringRange.location
        let end = index + 1 < segments.count ? segments[index + 1].substringRange.location : formatted.length
        guard begin >= 0, end >= begin, end <= formatted.length else { throw CaptureFailure.message("Speech result has invalid text ranges") }
        tokens.append(SpeechWindowToken(text: formatted.substring(with: NSRange(location: begin, length: end - begin)),
          start: segment.timestamp, end: segment.timestamp + segment.duration, beginsObservation: index == 0))
      }
      let metadata = result.speechRecognitionMetadata
      // Same final-like boundary signal used by pinned expo-speech-recognition.
      // It records an utterance boundary, never completion of the entire file.
      let finalLike = result.isFinal || (metadata?.speechDuration ?? 0) > 0
      recordFirstResult(job)
      job.callbackCount += 1
      if result.isFinal { job.finalCallbackCount += 1 }
      if finalLike { job.finalLikeCallbackCount += 1 }
      var record: [String: Any] = ["index": job.callbackCount, "isFinal": result.isFinal, "finalLike": finalLike,
        "text": String(transcription.formattedString.prefix(512)), "segmentCount": segments.count]
      if let first = tokens.first, first.start.isFinite { record["startMs"] = first.start * 1000 }
      if let last = tokens.last, last.end.isFinite { record["endMs"] = last.end * 1000 }
      if let metadata = metadata {
        if metadata.speechStartTimestamp.isFinite { record["metadataStartMs"] = metadata.speechStartTimestamp * 1000 }
        if metadata.speechDuration.isFinite { record["metadataDurationMs"] = metadata.speechDuration * 1000 }
      }
      appendCallback(job, record: record)
      try job.transcript.receive(tokens, isFinal: result.isFinal, observedText: transcription.formattedString)
      if !transcription.formattedString.isEmpty && tokens.isEmpty && result.isFinal { throw CaptureFailure.message("Final speech result has no source segments") }
      let text = job.transcript.text
      if result.isFinal { job.finalizing = true }
      lock.unlock()
      if result.isFinal { finish(id, job: job, text: text, error: nil) }
    } catch { lock.unlock(); finish(id, job: job, text: nil, error: error.localizedDescription) }
  }
  private func finish(_ id: String, job expected: WindowJob, text: String?, error: String?) {
    lock.lock()
    guard let job = jobs[id], job === expected, !job.done else { lock.unlock(); return }
    job.done = true; jobs.removeValue(forKey: id)
    let task = job.task; let file = job.file; let recognizer = job.recognizer
    // Detach the callback owner deterministically, including successful tasks.
    // Speech task handlers can retain this job after the request completes.
    job.task = nil; job.analyzerTask = nil; job.recognizer = nil; job.file = nil
    let diagnostics = job.diagnostics()
    let failure = job.cancelled ? (job.cancellationReason ?? "Transcription cancelled") : error
    let actualText = text ?? job.text
    lock.unlock()
    if failure != nil { task?.cancel() }
    if failure != nil, let recognizer = recognizer {
      decoder.async { if self.recognizers[job.locale] === recognizer { self.recognizers.removeValue(forKey: job.locale) } }
    }
    if let file = file { try? FileManager.default.removeItem(at: file) }
    // The facade turns a failure envelope back into a rejected public promise,
    // retaining observed partial speech and diagnostics for durable reporting.
    var result: [String: Any] = ["transcript": actualText, "diagnostics": diagnostics]
    if let failure = failure { result["error"] = failure }
    job.promise.resolve(result)
  }
}
