import ExpoModulesCore
import ExpoFileSystem
import Foundation
import UIKit
import UserNotifications
import CryptoKit

public final class NotatkiDownloadModule: Module {
  private let owner = ModelTransfer.shared
  private let verifier = NativeFileVerifier()
  public func definition() -> ModuleDefinition {
    Name("NotatkiDownload")
    Events("downloadState", "verificationProgress")
    OnCreate { self.owner.event = { [weak self] state in self?.sendEvent("downloadState", state) } }
    OnDestroy { self.owner.event = nil; self.verifier.cancelAll() }
    AsyncFunction("start") { (id: String, url: String, filename: String, bytes: Int64, sha256: String, language: String) in
      try self.owner.start(id: id, url: url, filename: filename, bytes: bytes, sha256: sha256, language: language)
    }
    AsyncFunction("getState") { (promise: Promise) in self.owner.attach(promise) }
    AsyncFunction("cancel") { (id: String) in try self.owner.cancel(id) }
    AsyncFunction("remove") { (filename: String) in try self.owner.remove(filename) }
    AsyncFunction("verifyFile") { (id: String, path: String, expectedBytes: Int64, expectedSha256: String, promise: Promise) in
      self.verifier.verify(id: id, path: path, expectedBytes: expectedBytes, expectedSha256: expectedSha256,
        progress: { [weak self] bytes, total in self?.sendEvent("verificationProgress", ["id": id, "bytes": bytes, "totalBytes": total]) },
        completion: { result in
          switch result {
          case .success(let value): promise.resolve(["sha256": value.sha256, "sizeBytes": value.sizeBytes, "durationMs": value.durationMs] as [String: Any])
          case .failure(let error):
            if let failure = error as? NativeFileVerificationFailure, case .cancelled = failure { promise.reject("verification-cancelled", error.localizedDescription) }
            else { promise.reject("verification-failed", error.localizedDescription) }
          }
        })
    }
    AsyncFunction("cancelVerification") { (id: String) in self.verifier.cancel(id: id) }
  }
}

public final class NotatkiDownloadAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    guard identifier == ModelTransfer.identifier else { completionHandler(); return }
    ModelTransfer.shared.backgroundEvents(completionHandler)
  }
}

struct ModelTransferJournal: Codable {
  var version = 1
  var id: String
  var url: String
  var filename: String
  var expectedBytes: Int64
  var expectedSha256: String
  var state: String
  var writtenBytes: Int64 = 0
  var language: String
  var taskIdentifier: Int?
  var error: String?
  var path: String?
}
enum ModelTransferFailure: LocalizedError {
  case message(String)
  var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

// A background system session continues an explicitly authorized transfer.
// Refresh reattaches only; a missing/failed task needs an explicit Start retry.
final class ModelTransfer: NSObject, URLSessionDownloadDelegate {
  static let shared = ModelTransfer()
  static let identifier = "pl.nikodem.notatki.model-download.v1"
  private let work = DispatchQueue(label: "notatki.model.download", qos: .utility)
  private var journal: ModelTransferJournal?
  private var activeTask: URLSessionDownloadTask?
  private var backgroundCompletion: (() -> Void)?
  private var backgroundEventsFinished = false
  private var lastCheckpoint: Int64 = 0
  private var lastCheckpointTime = Date.distantPast
  private var lastProgressTime = Date.distantPast
  private let cancellationLock = NSLock()
  private var cancelledIds: Set<String> = []
  private var loadError: Error?
  var event: (([String: Any]) -> Void)?
  private var session: URLSession!
  private func makeSession() -> URLSession {
    let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    config.sessionSendsLaunchEvents = true
    config.isDiscretionary = false
    config.waitsForConnectivity = true
    config.timeoutIntervalForResource = 7 * 24 * 60 * 60
    let delegates = OperationQueue()
    delegates.maxConcurrentOperationCount = 1
    return URLSession(configuration: config, delegate: self, delegateQueue: delegates)
  }
  private override init() {
    super.init()
    do {
      let file = try journalURL()
      if FileManager.default.fileExists(atPath: file.path) {
        journal = try JSONDecoder().decode(ModelTransferJournal.self, from: Data(contentsOf: file))
        guard journal?.version == 1 else { throw ModelTransferFailure.message("Malformed download journal") }
      }
    } catch { loadError = error }
    session = makeSession()
  }
  private func documents() -> URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  private func folder() throws -> URL {
    let folder = documents().appendingPathComponent("model-transfer", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    return folder
  }
  private func journalURL() throws -> URL { try folder().appendingPathComponent("manifest.json") }
  private func resumeURL() throws -> URL { try folder().appendingPathComponent("resume.data") }
  private func safeFilename(_ name: String) throws {
    guard name.range(of: "^[A-Za-z0-9_.-]+\\.gguf$", options: .regularExpression) != nil, !name.contains("..") else { throw ModelTransferFailure.message("Invalid model filename") }
  }
  private func target(_ value: ModelTransferJournal) -> URL { documents().appendingPathComponent(value.filename) }
  private func staging(_ value: ModelTransferJournal) -> URL { documents().appendingPathComponent(value.filename + ".part") }
  private func persist() throws {
    guard let journal = journal else { return }
    let url = try journalURL()
    try JSONEncoder().encode(journal).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
  }
  private func body() throws -> [String: Any]? {
    guard let journal = journal else { return nil }
    return try JSONSerialization.jsonObject(with: JSONEncoder().encode(journal)) as? [String: Any]
  }
  private func publish() { if let value = try? body() { event?(value) } }
  private func isCancelled(_ id: String) -> Bool { cancellationLock.lock(); defer { cancellationLock.unlock() }; return cancelledIds.contains(id) }
  private func removeIfExists(_ url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }
  func start(id: String, url: String, filename: String, bytes: Int64, sha256: String, language: String) throws -> [String: Any] {
    try safeFilename(filename)
    guard id.range(of: "^download-[A-Za-z0-9-]+$", options: .regularExpression) != nil,
          let source = URL(string: url), source.scheme == "https", bytes > 0,
          sha256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else { throw ModelTransferFailure.message("Pinned model integrity metadata is required") }
    return try work.sync {
      if let value = journal, ["running", "verifying"].contains(value.state) { throw ModelTransferFailure.message("A model download is already in progress") }
      let previous = journal
      let canResume = previous?.url == url && previous?.filename == filename && previous?.expectedBytes == bytes && previous?.expectedSha256 == sha256 && ["paused", "failed"].contains(previous?.state ?? "")
      let resumeData = canResume ? (try? Data(contentsOf: resumeURL())) : nil
      journal = ModelTransferJournal(id: id, url: url, filename: filename, expectedBytes: bytes, expectedSha256: sha256.lowercased(), state: "running", writtenBytes: canResume ? previous?.writtenBytes ?? 0 : 0, language: language == "en" ? "en" : "pl")
      lastCheckpoint = journal?.writtenBytes ?? 0
      loadError = nil
      try persist() // Authorization is durable before the task can run.
      let task = resumeData.map { session.downloadTask(withResumeData: $0) } ?? session.downloadTask(with: source)
      task.taskDescription = id
      journal?.taskIdentifier = task.taskIdentifier
      activeTask = task
      try persist(); task.resume(); publish()
      return try body()!
    }
  }
  func attach(_ promise: Promise) {
    session.getAllTasks { tasks in
      self.work.async {
        do {
          if let error = self.loadError { throw error }
          if let value = self.journal {
            try self.safeFilename(value.filename)
            guard value.expectedBytes > 0, value.expectedSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  URL(string: value.url)?.scheme == "https", value.writtenBytes >= 0,
                  ["running", "verifying", "paused", "failed", "complete", "cancelled"].contains(value.state) else {
              throw ModelTransferFailure.message("Malformed download integrity journal")
            }
            if ["running", "verifying"].contains(value.state) {
              let matching = tasks.compactMap { $0 as? URLSessionDownloadTask }.first { $0.taskDescription == value.id || $0.taskIdentifier == value.taskIdentifier }
              self.activeTask = matching
              if value.state == "verifying" && (FileManager.default.fileExists(atPath: self.staging(value).path) || FileManager.default.fileExists(atPath: self.target(value).path)) {
                try self.promote(value)
              } else if matching == nil {
                // Force quit can cancel a background transfer. Never silently
                // create a replacement task when merely refreshing state.
                self.journal?.state = "paused"
                self.journal?.error = "Download interrupted; retry to resume if the system retained resume data"
                try self.persist()
              }
            }
            if self.journal?.state == "complete" {
              let attributes = try FileManager.default.attributesOfItem(atPath: self.target(value).path)
              guard (attributes[.size] as? NSNumber)?.int64Value == value.expectedBytes else { throw ModelTransferFailure.message("The completed model file is missing or has changed") }
            }
          }
          self.publish(); promise.resolve(try self.body())
        } catch { promise.reject("download-recovery-failed", error.localizedDescription) }
      }
    }
  }
  func cancel(_ id: String) throws {
    // Set the flag before waiting on the serial file verifier, so explicit
    // cancellation can stop hashing before its publication boundary.
    cancellationLock.lock(); cancelledIds.insert(id); cancellationLock.unlock()
    try work.sync {
      guard var value = journal, value.id == id else { return }
      if value.state == "complete" { return } // Completed promotion is its commit point.
      value.state = "cancelled"; value.error = nil; value.writtenBytes = 0; journal = value
      try persist() // Cancellation receipt fences late delegate completion.
      activeTask?.cancel(); activeTask = nil
      try removeIfExists(staging(value)); try removeIfExists(resumeURL()); publish()
    }
    session.getAllTasks { tasks in tasks.filter { $0.taskDescription == id }.forEach { $0.cancel() } }
  }
  func remove(_ filename: String) throws {
    try safeFilename(filename)
    if let id = work.sync(execute: { journal?.filename == filename ? journal?.id : nil }) { try cancel(id) }
    try work.sync {
      if journal?.filename == filename { journal?.state = "cancelled"; journal?.writtenBytes = 0; journal?.path = nil; try persist() }
      try removeIfExists(documents().appendingPathComponent(filename)); try removeIfExists(documents().appendingPathComponent(filename + ".part")); try removeIfExists(resumeURL()); publish()
    }
  }
  func backgroundEvents(_ completion: @escaping () -> Void) {
    work.async {
      self.backgroundCompletion = completion
      self.completeBackgroundEventsIfReady()
    }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    work.async {
      guard self.journal?.id == downloadTask.taskDescription, self.journal?.state == "running" else { return }
      self.journal?.writtenBytes = totalBytesWritten
      let now = Date()
      if totalBytesWritten - self.lastCheckpoint >= 1024 * 1024 && now.timeIntervalSince(self.lastCheckpointTime) >= 1 {
        try? self.persist(); self.lastCheckpoint = totalBytesWritten; self.lastCheckpointTime = now
      }
      if now.timeIntervalSince(self.lastProgressTime) >= 0.25 { self.lastProgressTime = now; self.publish() }
    }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    // Move the temporary location before this delegate returns: the system is
    // free to delete it immediately afterwards. Verification is bounded I/O.
    work.sync {
      guard var value = journal, value.id == downloadTask.taskDescription, value.state == "running" else { return }
      do {
        guard let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
          throw ModelTransferFailure.message("Model download failed (HTTP \((downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0))")
        }
        let temporary = staging(value)
        try removeIfExists(temporary); try FileManager.default.moveItem(at: location, to: temporary)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
        value.state = "verifying"; journal = value; try persist(); publish()
        try? removeIfExists(resumeURL())
        try promote(value)
      } catch {
        if isCancelled(value.id) {
          journal?.state = "cancelled"; journal?.error = nil; journal?.writtenBytes = 0
          try? removeIfExists(staging(value)); try? removeIfExists(resumeURL())
        } else { journal?.state = "failed"; journal?.error = error.localizedDescription }
        try? persist(); publish()
      }
    }
  }
  private func promote(_ value: ModelTransferJournal) throws {
    let staged = staging(value)
    let file = FileManager.default.fileExists(atPath: staged.path) ? staged : target(value)
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    guard (attributes[.size] as? NSNumber)?.int64Value == value.expectedBytes else { throw ModelTransferFailure.message("Downloaded model size does not match the pinned file") }
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var hash = SHA256()
    while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty {
      guard !isCancelled(value.id) else { throw ModelTransferFailure.message("Model download cancelled") }
      hash.update(data: bytes)
    }
    let actual = hash.finalize().map { String(format: "%02x", $0) }.joined()
    guard actual == value.expectedSha256 else { throw ModelTransferFailure.message("Downloaded model SHA256 does not match the pinned file") }
    guard !isCancelled(value.id) else { throw ModelTransferFailure.message("Model download cancelled") }
    // Same-filesystem rename/replace is the publication boundary.
    let destination = target(value)
    if file == destination {
      // Recovery after rename succeeded but the completion receipt did not.
    } else if FileManager.default.fileExists(atPath: destination.path) {
      _ = try FileManager.default.replaceItemAt(destination, withItemAt: file)
    } else { try FileManager.default.moveItem(at: file, to: destination) }
    journal?.state = "complete"; journal?.writtenBytes = value.expectedBytes; journal?.path = destination.absoluteString; journal?.error = nil
    try persist(); try? removeIfExists(resumeURL()); publish(); notifyComplete(value)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    work.async {
      guard self.journal?.id == task.taskDescription, !["complete", "cancelled", "failed"].contains(self.journal?.state ?? "") else { return }
      self.activeTask = nil
      if let error = error as NSError? {
        if let resume = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data { try? resume.write(to: self.resumeURL(), options: .atomic) }
        self.journal?.state = "failed"; self.journal?.error = error.localizedDescription
      } else if self.journal?.state != "complete" { self.journal?.state = "failed"; self.journal?.error = "Download ended without a verified model" }
      try? self.persist(); self.publish()
    }
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    work.async {
      // The restored session can deliver this before UIApplication supplies its
      // completion receipt. Keep the event until both sides are present.
      self.backgroundEventsFinished = true
      self.completeBackgroundEventsIfReady()
    }
  }
  private func completeBackgroundEventsIfReady() {
    guard backgroundEventsFinished, let completion = backgroundCompletion else { return }
    backgroundEventsFinished = false
    backgroundCompletion = nil
    DispatchQueue.main.async {
      // Expo aggregates each subscriber completion. Its FileSystem subscriber
      // stores every identifier; acknowledge ours there as well, exactly once.
      ExpoAppDelegateSubscriberRepository.getSubscriberOfType(FileSystemBackgroundSessionHandler.self)?.invokeCompletionHandler(forSessionIdentifier: Self.identifier)
      completion()
    }
  }
  private func notifyComplete(_ value: ModelTransferJournal) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
      let content = UNMutableNotificationContent()
      content.title = value.language == "en" ? "Model ready" : "Model gotowy"
      content.body = value.language == "en" ? "Your local model has finished downloading and is ready to use." : "Model lokalny został pobrany i jest gotowy do użycia."
      let request = UNNotificationRequest(identifier: "notatki-model-download-" + value.id, content: content, trigger: nil)
      center.add(request) { _ in }
    }
  }
}
