import ExpoModulesCore
import AVFoundation
import Speech
import UIKit

public final class NotatkiCaptureModule: Module {
  private let owner = CaptureOwner.shared
  public func definition() -> ModuleDefinition {
    Name("NotatkiCapture")
    Events("captureState", "captureTranscript")
    OnCreate {
      self.owner.event = { [weak self] name, body in self?.sendEvent(name, body) }
    }
    OnDestroy { self.owner.event = nil } // Screen/JS lifetime never owns the microphone.
    AsyncFunction("start") { (id: String, language: String) in
      try self.owner.start(id: id, language: language)
    }.runOnQueue(.main)
    AsyncFunction("stop") { (id: String) in try self.owner.stop(id: id) }.runOnQueue(.main)
    AsyncFunction("resume") { (id: String) in try self.owner.resume(id: id) }.runOnQueue(.main)
    AsyncFunction("getSnapshot") { self.owner.snapshot() }
    AsyncFunction("recoverSessions") { try self.owner.recover() }
    AsyncFunction("markMaterialized") { (id: String, noteId: String) in try self.owner.acknowledge(id: id, noteId: noteId) }
    AsyncFunction("deleteCaptureAudio") { (id: String) in try self.owner.deleteAudio(id: id) }
    AsyncFunction("inspectAudio") { (uri: String) in try LocalSpeechWindows.inspect(uri) }
    AsyncFunction("transcribeWindow") { (uri: String, start: Double, duration: Double, locale: String, id: String, promise: Promise) in
      LocalSpeechWindows.shared.transcribe(uri: uri, startMs: start, durationMs: duration, locale: locale, id: id, promise: promise)
    }
    AsyncFunction("transcribeWindowWithBackend") { (uri: String, start: Double, duration: Double, locale: String, id: String, backend: String, promise: Promise) in
      LocalSpeechWindows.shared.transcribe(uri: uri, startMs: start, durationMs: duration, locale: locale, id: id, backend: backend, promise: promise)
    }
    AsyncFunction("getSpeechCapabilities") { () async -> [String: Any] in
      if #available(iOS 26.0, *) { return await LocalSpeechAnalyzer.capabilities() }
      var locales: [String: Any] = [:]
      for locale in ["pl-PL", "en-US"] {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        locales[locale] = ["recognizerAvailable": recognizer?.isAvailable ?? false,
          "recognizerOnDevice": recognizer?.supportsOnDeviceRecognition ?? false,
          "analyzerSupported": false, "analyzerInstalled": false]
      }
      return ["version": 1, "analyzerAvailable": false, "supportedLocales": [String](), "installedLocales": [String](), "locales": locales]
    }
    AsyncFunction("cancelTranscription") { (id: String) in LocalSpeechWindows.shared.cancel(id) }
  }
}

struct CaptureSegment: Codable { var key: String; var frames: Int64 }
struct CaptureGap: Codable { var atFrame: Int64; var reason: String; var startedAt: Double; var endedAt: Double? }
struct CaptureJournal: Codable {
  var version = 1
  var sessionId: String
  var language: String
  var state: String
  var sampleRate = 16000
  var channels = 1
  var bitsPerSample = 16
  var frames: Int64 = 0
  var segments: [CaptureSegment] = []
  var gaps: [CaptureGap] = []
  // Recognition coverage is never asserted from successful audio writing.
  var needsTranscription = true
  var startedAt: Double
  var error: String?
  var materializedNoteId: String?
  var partialKey: String?
  var partialFrames: Int64 = 0
  var transcriptGeneration: String?
  var transcriptionRecoveryIssue: String?
  var speechDiagnostics: CaptureSpeechDiagnostics?
}

enum CaptureFailure: LocalizedError {
  case message(String)
  var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

// This singleton outlives screens and the Expo module's JS subscriptions. The
// serial writer owns the manifest, conversion and file descriptor. Its bounded
// hardware-buffer queue fails visibly rather than silently discarding audio.
final class CaptureOwner {
  static let shared = CaptureOwner()
  private let writer = DispatchQueue(label: "notatki.capture.writer", qos: .userInitiated)
  private let slots = DispatchSemaphore(value: 24)
  private let overflowSlot = DispatchSemaphore(value: 1)
  private let speechSlots = DispatchSemaphore(value: 4)
  private let speechQueue = DispatchQueue(label: "notatki.capture.speech")
  private var engine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private var journal: CaptureJournal?
  private var handle: FileHandle?
  private var directory: URL?
  private var partialURL: URL?
  private var volume: Double = 0
  private var cursor = 0
  private var audioMeter = CaptureAudioMeter()
  private var lastSyncFrames: Int64 = 0
  private var observers: [NSObjectProtocol] = []
  private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
  private var speechTask: SFSpeechRecognitionTask?
  private var speechGeneration = 0
  private var speechStartFrame: Int64 = 0
  private var speechHadGap = false
  private var speechFinalizing = false
  private var speechFailures = 0
  private var speechTranscript = CaptureSpeechTranscript()
  private var finalText: String { speechTranscript.finalText }
  private var interimText: String { speechTranscript.interimText }
  private var tapInstalled = false
  var event: ((String, [String: Any]) -> Void)?
  static let maxFrames: Int64 = 16000 * 1800
  static let segmentFrames: Int64 = 16000 * 60
  private static let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!

  private init() {
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
      self?.interrupt("audio-interruption")
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            raw != AVAudioSession.RouteChangeReason.categoryChange.rawValue else {
        if AVAudioSession.sharedInstance().category != .playAndRecord { self?.interrupt("audio-session-category-changed") }
        return
      }
      self?.interrupt("audio-route-change")
    })
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in self?.interrupt("media-services-reset") })
  }

  private func root() throws -> URL {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let url = documents.appendingPathComponent("recordings/captures", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  private func now() -> Double { Date().timeIntervalSince1970 * 1000 }
  private func safeID(_ id: String) throws {
    guard id.range(of: "^capture-[A-Za-z0-9-]+$", options: .regularExpression) != nil else { throw CaptureFailure.message("Invalid capture ID") }
  }
  private func persist() throws {
    guard var value = journal, let directory = directory else { return }
    let url = directory.appendingPathComponent("manifest.json")
    let transcriptURL = directory.appendingPathComponent("transcript.json")
    let generation = UUID().uuidString
    value.transcriptGeneration = generation
    value.speechDiagnostics = speechTranscript.diagnostics
    let checkpoint = CaptureTranscriptCheckpoint(sessionId: value.sessionId, generation: generation, audioFrames: value.frames,
      complete: !value.needsTranscription, finalTranscript: finalText, interimTranscript: interimText)
    do {
      // Publish text first. A crash before the matching manifest leaves a
      // generation mismatch, never a clean manifest paired with old text.
      try JSONEncoder().encode(checkpoint).write(to: transcriptURL, options: .atomic)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: transcriptURL.path)
      try JSONEncoder().encode(value).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
      journal = value
    } catch {
      // The current process must also expose a failed checkpoint honestly.
      journal?.needsTranscription = true; journal?.transcriptGeneration = nil
      throw error
    }
  }
  private func body(includeTranscript: Bool) -> [String: Any]? {
    guard let journal = journal, let directory = directory,
          let manifest = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(journal)) else { return nil }
    var result: [String: Any] = ["manifest": manifest, "directory": directory.absoluteString + "/", "volumeLevel": volume, "cursor": cursor, "speechFinalizing": speechFinalizing]
    if includeTranscript {
      result["finalTranscript"] = finalText; result["interimTranscript"] = interimText
      result["livePreviewTranscript"] = speechTranscript.livePreviewText
    }
    return result
  }
  private func emitState() { cursor += 1; if let body = body(includeTranscript: false) { event?("captureState", body) } }
  private func emitText() {
    guard let id = journal?.sessionId else { return }
    cursor += 1
    event?("captureTranscript", ["sessionId": id, "finalTranscript": finalText, "interimTranscript": interimText,
      "livePreviewTranscript": speechTranscript.livePreviewText, "cursor": cursor])
  }
  func snapshot() -> [String: Any]? { writer.sync { body(includeTranscript: true) } }

  func start(id: String, language: String) throws -> [String: Any] {
    try safeID(id)
    guard UIApplication.shared.applicationState == .active else { throw CaptureFailure.message("Return to the app before starting the microphone") }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else { throw CaptureFailure.message("Microphone permission is missing") }
    return try writer.sync {
      if journal?.sessionId == id { return body(includeTranscript: true)! }
      guard engine == nil, journal?.state != "interrupted" else { throw CaptureFailure.message("Another recording needs Stop or Resume") }
      let folder = try root().appendingPathComponent(id, isDirectory: true)
      guard !FileManager.default.fileExists(atPath: folder.path) else { throw CaptureFailure.message("Capture ID already exists") }
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      directory = folder
      journal = CaptureJournal(sessionId: id, language: language == "en" ? "en" : "pl", state: "recording", startedAt: now())
      speechTranscript.reset(); lastSyncFrames = 0; audioMeter.reset(); volume = 0
      speechHadGap = false; speechFinalizing = false; speechFailures = 0
      try persist()
      do { try beginEngine(); emitState() }
      catch { endEngine(); journal?.state = "error"; journal?.error = error.localizedDescription; try? closeSegment(); try? persist(); emitState(); throw error }
      return body(includeTranscript: true)!
    }
  }
  func resume(id: String) throws -> [String: Any] {
    guard UIApplication.shared.applicationState == .active else { throw CaptureFailure.message("Return to the app before resuming") }
    return try writer.sync {
      guard journal?.sessionId == id, journal?.state == "interrupted", engine == nil,
            (journal?.frames ?? Self.maxFrames) < Self.maxFrames else { throw CaptureFailure.message("This session cannot resume") }
      if let index = journal?.gaps.indices.last { journal?.gaps[index].endedAt = now() }
      journal?.state = "recording"
      speechHadGap = true
      do { try beginEngine(); try persist(); emitState() }
      catch { endEngine(); journal?.state = "interrupted"; journal?.error = error.localizedDescription; try? closeSegment(); try? persist(); emitState(); throw error }
      return body(includeTranscript: true)!
    }
  }
  private func beginEngine() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    let audioEngine = AVAudioEngine()
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0, format.channelCount <= 8,
          let converter = AVAudioConverter(from: format, to: Self.pcm) else { throw CaptureFailure.message("Unsupported microphone format") }
    self.converter = converter
    try openSegment()
    engine = audioEngine
    beginSpeech()
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      guard let self = self else { return }
      // Bound hardware bytes before conversion as well as queue depth.
      let bytes = buffer.audioBufferList.pointee.mBuffers.mDataByteSize * UInt32(max(1, buffer.audioBufferList.pointee.mNumberBuffers))
      guard bytes <= 256 * 1024, self.slots.wait(timeout: .now()) == .success else {
        if self.overflowSlot.wait(timeout: .now()) == .success {
          self.writer.async { if self.engine === audioEngine { self.failCapture("audio-buffer-overflow") }; self.overflowSlot.signal() }
        }
        return
      }
      guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
        self.slots.signal(); self.writer.async { if self.engine === audioEngine { self.failCapture("audio-buffer-allocation") } }; return
      }
      copy.frameLength = buffer.frameLength
      let source = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
      let target = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
      for index in source.indices {
        if let sourceData = source[index].mData, let targetData = target[index].mData {
          memcpy(targetData, sourceData, Int(source[index].mDataByteSize))
        }
      }
      self.writer.async {
        defer { self.slots.signal() }
        guard self.engine === audioEngine, self.journal?.state == "recording" else { return }
        do { try self.consume(copy) } catch { self.failCapture(error.localizedDescription) }
      }
    }
    tapInstalled = true
    audioEngine.prepare()
    try audioEngine.start()
  }
  private func consume(_ source: AVAudioPCMBuffer) throws {
    guard let converter = converter else { throw CaptureFailure.message("Missing audio converter") }
    let capacity = AVAudioFrameCount(ceil(Double(source.frameLength) * 16000 / source.format.sampleRate)) + 32
    guard let converted = AVAudioPCMBuffer(pcmFormat: Self.pcm, frameCapacity: capacity) else { throw CaptureFailure.message("PCM allocation failed") }
    var supplied = false
    var conversionError: NSError?
    let outcome = converter.convert(to: converted, error: &conversionError) { _, status in
      if supplied { status.pointee = .noDataNow; return nil }
      supplied = true; status.pointee = .haveData; return source
    }
    if outcome == .error { throw conversionError ?? NSError(domain: "NotatkiCapture", code: 3) }
    guard let samples = converted.int16ChannelData?[0] else { throw CaptureFailure.message("Missing PCM samples") }
    let available = min(Int64(converted.frameLength), Self.maxFrames - (journal?.frames ?? Self.maxFrames))
    var offset: Int64 = 0
    while offset < available {
      if handle == nil { try openSegment() }
      let count = min(available - offset, Self.segmentFrames - (journal?.partialFrames ?? 0))
      try handle?.write(contentsOf: Data(bytes: samples.advanced(by: Int(offset)), count: Int(count * 2)))
      journal?.frames += count; journal?.partialFrames += count; offset += count
      if journal?.partialFrames == Self.segmentFrames { try closeSegment(); try persist() }
    }
    var meterEvent: Double?
    if available > 0 {
      converted.frameLength = AVAudioFrameCount(available)
      var sum = 0.0
      for index in 0..<Int(available) { let sample = Double(samples[index]) / 32768; sum += sample * sample }
      volume = min(1, sqrt(sum / Double(available)) * 5)
      meterEvent = audioMeter.observe(volume: volume, frames: available)
      feedSpeech(converted)
    }
    let total = journal?.frames ?? 0
    if total - lastSyncFrames >= 16000 * 5 { try checkpoint(); lastSyncFrames = total }
    if let peak = meterEvent { volume = peak; emitState() }
    if total >= Self.maxFrames { try finish(reason: "duration-limit") }
  }
  private func openSegment() throws {
    guard let directory = directory, var current = journal else { throw CaptureFailure.message("Missing capture journal") }
    let key = String(format: "%06d.wav", current.segments.count)
    let url = directory.appendingPathComponent(key + ".partial")
    guard !FileManager.default.fileExists(atPath: url.path) else { throw CaptureFailure.message("Capture segment already exists") }
    guard FileManager.default.createFile(atPath: url.path, contents: Self.header(0), attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw CaptureFailure.message("Cannot create audio segment") }
    handle = try FileHandle(forWritingTo: url); try handle?.seekToEnd()
    partialURL = url; current.partialKey = key; current.partialFrames = 0; journal = current
    try persist()
  }
  private func checkpoint() throws {
    guard let handle = handle else { try persist(); return }
    try handle.seek(toOffset: 0); try handle.write(contentsOf: Self.header((journal?.partialFrames ?? 0) * 2))
    try handle.synchronize(); try handle.seekToEnd(); try persist()
  }
  private func closeSegment() throws {
    guard let handle = handle, let url = partialURL, let key = journal?.partialKey else { return }
    let count = journal?.partialFrames ?? 0
    try handle.seek(toOffset: 0); try handle.write(contentsOf: Self.header(count * 2)); try handle.synchronize(); try handle.close()
    self.handle = nil; partialURL = nil
    if count > 0 {
      try FileManager.default.moveItem(at: url, to: url.deletingLastPathComponent().appendingPathComponent(key))
      journal?.segments.append(CaptureSegment(key: key, frames: count))
    } else { try FileManager.default.removeItem(at: url) }
    journal?.partialKey = nil; journal?.partialFrames = 0
  }
  private func endEngine(flushSpeech: Bool = false) {
    engine?.stop()
    if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
    engine = nil; converter = nil; volume = 0; audioMeter.reset()
    if flushSpeech, let request = speechRequest, speechTask != nil {
      speechFinalizing = true
      // Serial append queue drains before endAudio, including the last buffer.
      speechQueue.async { request.endAudio() }
      let generation = speechGeneration
      writer.asyncAfter(deadline: .now() + 2) { [weak self] in
        guard let self = self, self.speechGeneration == generation, self.speechFinalizing else { return }
        self.speechHadGap = true; self.endSpeech(reason: "stop-flush-timeout"); try? self.persist(); self.emitState()
      }
    } else { speechHadGap = true; endSpeech() }
  }
  private func endSpeech(reason: String = "speech-cancelled") {
    let hadText = !interimText.isEmpty || speechTranscript.livePreviewText != finalText
    _ = speechTranscript.finishRequest(generation: speechGeneration, clean: false, reason: reason)
    speechTranscript.invalidate(reason); journal?.needsTranscription = true
    speechGeneration += 1; speechRequest?.endAudio(); speechTask?.cancel(); speechRequest = nil; speechTask = nil; speechFinalizing = false
    if hadText { emitText() }
  }
  private func finish(reason: String) throws {
    endEngine(flushSpeech: true); try closeSegment(); journal?.state = "stopped"
    if reason == "duration-limit" { journal?.error = "duration-limit" }
    try persist(); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation); emitState()
  }
  func stop(id: String) throws -> [String: Any] {
    try writer.sync {
      guard journal?.sessionId == id else { throw CaptureFailure.message("Stale capture session") }
      if journal?.state == "recording" || journal?.state == "interrupted" || journal?.state == "error" { try finish(reason: "user-stop") }
      return body(includeTranscript: true)!
    }
  }
  private func interrupt(_ reason: String) {
    writer.async {
      guard self.journal?.state == "recording" else { return }
      self.endEngine()
      do { try self.closeSegment() } catch { self.journal?.error = error.localizedDescription }
      self.journal?.state = "interrupted"
      let gap = CaptureGap(atFrame: self.journal?.frames ?? 0, reason: reason, startedAt: self.now())
      self.journal?.gaps.append(gap)
      try? self.persist(); self.emitState()
    }
  }
  private func failCapture(_ reason: String) {
    guard journal?.state == "recording" else { return }
    endEngine(); try? closeSegment(); journal?.state = "error"; journal?.error = reason
    let gap = CaptureGap(atFrame: journal?.frames ?? 0, reason: reason, startedAt: now())
    journal?.gaps.append(gap)
    try? persist(); emitState()
  }
  private func beginSpeech() {
    speechGeneration += 1
    let generation = speechGeneration
    speechStartFrame = journal?.frames ?? 0
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
          let recognizer = SFSpeechRecognizer(locale: Locale(identifier: journal?.language == "en" ? "en-US" : "pl-PL")),
          recognizer.isAvailable, recognizer.supportsOnDeviceRecognition,
          speechFailures < 5 else { speechHadGap = true; speechTranscript.invalidate("recognizer-unavailable"); return }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true; request.shouldReportPartialResults = true; request.addsPunctuation = true
    speechRequest = request
    speechTranscript.beginRequest(generation: generation, audioStartFrame: speechStartFrame)
    speechTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      self?.writer.async {
        guard let self = self else { return }
        guard self.speechGeneration == generation, self.speechRequest === request else { self.speechTranscript.recordStaleCallback(generation: generation); return }
        var observationValid = true
        if let result = result {
          let transcription = result.bestTranscription
          let formatted = transcription.formattedString as NSString
          let finalLike = result.isFinal || (result.speechRecognitionMetadata?.speechDuration ?? 0) > 0
          var parsed = false
          do {
            let segments = transcription.segments
            guard segments.count <= 4096, formatted.length <= 65536 else { throw CaptureFailure.message("Speech result exceeded its bounded transcript capacity") }
            var tokens: [SpeechWindowToken] = []
            for (index, segment) in segments.enumerated() {
              guard CaptureSpeechTranscript.isValidSourceRange(segment.substringRange, utf16Length: formatted.length) else {
                throw CaptureFailure.message("Speech result has invalid text ranges")
              }
              let begin = index == 0 ? 0 : segment.substringRange.location
              let end = index + 1 < segments.count ? segments[index + 1].substringRange.location : formatted.length
              guard begin >= 0, end >= begin, end <= formatted.length else { throw CaptureFailure.message("Speech result has invalid text ranges") }
              tokens.append(SpeechWindowToken(text: formatted.substring(with: NSRange(location: begin, length: end - begin)),
                start: segment.timestamp, end: segment.timestamp + segment.duration, beginsObservation: index == 0))
            }
            parsed = true
            _ = try self.speechTranscript.receive(generation: generation, tokens: tokens,
              hasText: formatted.length > 0, isFinal: result.isFinal, finalLike: finalLike,
              observedText: transcription.formattedString)
          } catch {
            observationValid = false; self.speechHadGap = true; self.journal?.needsTranscription = true
            if !parsed { self.speechTranscript.rejectObservation(generation: generation, isFinal: result.isFinal, finalLike: finalLike) }
          }
          self.emitText()
        }
        if result?.isFinal == true || error != nil {
          let expectedFinal = self.speechFinalizing && result?.isFinal == true && error == nil && observationValid
          if !expectedFinal { self.speechHadGap = true }
          if error != nil { self.speechFailures += 1 }
          else if !(result?.bestTranscription.formattedString.isEmpty ?? true) { self.speechFailures = 0 }
          _ = self.speechTranscript.finishRequest(generation: generation, clean: expectedFinal,
            reason: error == nil ? (expectedFinal ? "final" : "request-boundary") : "recognizer-error")
          self.speechRequest = nil; self.speechTask = nil
          // A recognizer boundary may omit audio; keep provenance incomplete.
          self.journal?.needsTranscription = self.speechHadGap || !expectedFinal || self.speechTranscript.needsTranscription
          self.speechFinalizing = false
          self.emitText(); try? self.persist()
          if self.journal?.state == "recording" { self.beginSpeech() } else { self.emitState() }
        }
      }
    }
  }
  private func feedSpeech(_ buffer: AVAudioPCMBuffer) {
    guard let request = speechRequest else { return }
    if (journal?.frames ?? 0) - speechStartFrame >= 16000 * 55 {
      speechHadGap = true; request.endAudio(); return // Writer continues; task callback rotates Speech.
    }
    guard speechSlots.wait(timeout: .now()) == .success else {
      _ = speechTranscript.finishRequest(generation: speechGeneration, clean: false, reason: "speech-queue-overflow")
      speechTranscript.invalidate("speech-queue-overflow"); speechHadGap = true; emitText()
      speechGeneration += 1; request.endAudio(); speechTask?.cancel(); speechRequest = nil; speechTask = nil
      journal?.needsTranscription = true; return
    }
    speechQueue.async { [weak self] in request.append(buffer); self?.speechSlots.signal() }
  }

  func acknowledge(id: String, noteId: String) throws {
    try safeID(id)
    try writer.sync {
      let folder = try root().appendingPathComponent(id, isDirectory: true)
      let url = folder.appendingPathComponent("manifest.json")
      var value = try JSONDecoder().decode(CaptureJournal.self, from: Data(contentsOf: url))
      guard value.state != "recording" else { throw CaptureFailure.message("Active recording cannot be acknowledged") }
      value.materializedNoteId = noteId
      try JSONEncoder().encode(value).write(to: url, options: .atomic)
      if journal?.sessionId == id { journal?.materializedNoteId = noteId }
    }
  }
  func recover() throws -> [[String: Any]] {
    try writer.sync {
      let rootURL = try root()
      var results: [[String: Any]] = []
      if journal?.state == "stopped", !speechFinalizing, journal?.materializedNoteId == nil, let current = body(includeTranscript: true) {
        results.append(current)
      }
      for folder in try FileManager.default.contentsOfDirectory(at: rootURL, includingPropertiesForKeys: [.isDirectoryKey]) {
        let id = folder.lastPathComponent
        guard id.range(of: "^capture-[A-Za-z0-9-]+$", options: .regularExpression) != nil else { continue }
        if journal?.sessionId == id { continue } // Current interrupted session supports manual Resume.
        let url = folder.appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: url), var value = try? JSONDecoder().decode(CaptureJournal.self, from: data) else {
          let malformed = CaptureJournal(sessionId: id, language: "pl", state: "error", startedAt: now(), error: "Malformed capture journal; source files retained")
          let manifest = try JSONSerialization.jsonObject(with: JSONEncoder().encode(malformed))
          results.append(["manifest": manifest, "directory": folder.absoluteString + "/", "volumeLevel": 0, "cursor": 0]); continue
        }
        if value.materializedNoteId != nil { continue }
        do {
          guard value.sessionId == id, value.version == 1, value.sampleRate == 16000, value.channels == 1, value.bitsPerSample == 16 else { throw CaptureFailure.message("Malformed capture journal: " + id) }
          // Validate every published reference first; absent published audio is
          // an error, even when other files could produce a shorter recording.
          for (index, segment) in value.segments.enumerated() {
            guard segment.key == String(format: "%06d.wav", index), try Self.validateWav(folder.appendingPathComponent(segment.key), repair: false) == segment.frames else { throw CaptureFailure.message("Missing or malformed segment: " + segment.key) }
          }
          let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
          if let key = value.partialKey, value.partialFrames > 0 {
            guard key == String(format: "%06d.wav", value.segments.count),
                  FileManager.default.fileExists(atPath: folder.appendingPathComponent(key).path) ||
                    FileManager.default.fileExists(atPath: folder.appendingPathComponent(key + ".partial").path) else {
              throw CaptureFailure.message("Missing checkpointed partial audio segment")
            }
          }
          let audio = files.filter { $0.lastPathComponent.range(of: "^[0-9]{6}\\.wav(\\.partial)?$", options: .regularExpression) != nil }.sorted { $0.lastPathComponent < $1.lastPathComponent }
          var recovered: [CaptureSegment] = []
          for file in audio {
            let expected = String(format: "%06d.wav", recovered.count)
            guard file.lastPathComponent == expected || file.lastPathComponent == expected + ".partial" else { throw CaptureFailure.message("Noncontiguous capture segments") }
            let partial = file.pathExtension == "partial"
            let count = try Self.validateWav(file, repair: partial)
            if count == 0 {
              guard partial, file == audio.last else { throw CaptureFailure.message("Empty published audio segment") }
              try FileManager.default.removeItem(at: file); continue
            }
            if partial { try FileManager.default.moveItem(at: file, to: folder.appendingPathComponent(expected)) }
            recovered.append(CaptureSegment(key: expected, frames: count))
          }
          let total = recovered.reduce(Int64(0)) { $0 + $1.frames }
          guard total <= Self.maxFrames else { throw CaptureFailure.message("Recovered audio exceeds duration limit") }
          if ["recording", "interrupted", "error"].contains(value.state) {
            value.state = "recovered"; value.needsTranscription = true
            value.gaps.append(CaptureGap(atFrame: total, reason: "process-ended-tail-unknown", startedAt: now()))
          }
          if total < value.frames {
            value.needsTranscription = true
            value.gaps.append(CaptureGap(atFrame: total, reason: "recovered-tail-loss-\(value.frames - total)-frames", startedAt: now()))
          }
          value.segments = recovered; value.frames = total; value.partialKey = nil; value.partialFrames = 0
        } catch { value.state = "error"; value.error = error.localizedDescription }
        let transcriptURL = folder.appendingPathComponent("transcript.json")
        let text = recoverCaptureTranscript(try? Data(contentsOf: transcriptURL), sessionId: id,
          generation: value.transcriptGeneration, audioFrames: value.frames, manifestComplete: !value.needsTranscription)
        if text.needsTranscription { value.needsTranscription = true }
        value.transcriptionRecoveryIssue = text.checkpointIssue
        // Persist the partial marker before offering materialization. A later
        // relaunch cannot forget that this transcript checkpoint was invalid.
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        let manifest = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
        results.append(["manifest": manifest, "directory": folder.absoluteString + "/", "finalTranscript": text.finalTranscript, "interimTranscript": text.interimTranscript, "volumeLevel": 0, "cursor": 0])
      }
      return results
    }
  }
  func deleteAudio(id: String) throws {
    try safeID(id)
    try writer.sync {
      guard journal?.sessionId != id || (journal?.state != "recording" && journal?.state != "interrupted") else { throw CaptureFailure.message("Active capture cannot be deleted") }
      let folder = try root().appendingPathComponent(id, isDirectory: true)
      let manifestURL = folder.appendingPathComponent("manifest.json")
      var value = try JSONDecoder().decode(CaptureJournal.self, from: Data(contentsOf: manifestURL))
      // Persist the deletion receipt BEFORE removing data so recovery will never
      // resurrect a deliberately removed note after a crash during cleanup.
      value.materializedNoteId = value.materializedNoteId ?? id
      try JSONEncoder().encode(value).write(to: manifestURL, options: .atomic)
      for file in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
        if file.lastPathComponent != "manifest.json" { try FileManager.default.removeItem(at: file) }
      }
      if journal?.sessionId == id { journal?.materializedNoteId = value.materializedNoteId; speechTranscript.reset() }
    }
  }
  static func header(_ bytes: Int64) -> Data {
    var data = Data()
    func text(_ value: String) { data.append(value.data(using: .ascii)!) }
    func u32(_ value: UInt32) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    text("RIFF"); u32(UInt32(36 + bytes)); text("WAVEfmt "); u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16); text("data"); u32(UInt32(bytes))
    return data
  }
  private static func validateWav(_ url: URL, repair: Bool) throws -> Int64 {
    let reader = try FileHandle(forReadingFrom: url)
    defer { try? reader.close() }
    let size = try reader.seekToEnd()
    try reader.seek(toOffset: 0)
    guard let header = try reader.read(upToCount: 44), header.count == 44,
          header.prefix(4) == Data("RIFF".utf8), header.subdata(in: 8..<40) == Self.header(0).subdata(in: 8..<40), size >= 44 else { throw CaptureFailure.message("Malformed own PCM segment") }
    let physical = Int64(size - 44) / 2 * 2
    guard physical <= segmentFrames * 2 else { throw CaptureFailure.message("Oversized own PCM segment") }
    if repair {
      let handle = try FileHandle(forWritingTo: url)
      defer { try? handle.close() }
      try handle.truncate(atOffset: UInt64(44 + physical)); try handle.seek(toOffset: 0); try handle.write(contentsOf: Self.header(physical)); try handle.synchronize()
    } else {
      guard header == Self.header(physical), Int64(size) == physical + 44, physical > 0 else { throw CaptureFailure.message("Incomplete published PCM segment") }
    }
    return physical / 2
  }
}
