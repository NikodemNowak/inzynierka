import Foundation
import CryptoKit
import Darwin

enum NativeFileVerificationFailure: LocalizedError {
  case cancelled
  case invalid(String)
  var errorDescription: String? {
    switch self {
    case .cancelled: return "File verification cancelled"
    case .invalid(let message): return message
    }
  }
}

struct NativeFileVerificationResult {
  let sha256: String
  let sizeBytes: Int64
  let durationMs: Double
}

private struct VerificationFileIdentity: Equatable {
  let device: Int64
  let inode: UInt64
  let size: Int64
  let modifiedSeconds: Int64
  let modifiedNanoseconds: Int64
  let changedSeconds: Int64
  let changedNanoseconds: Int64
  init(_ value: stat) throws {
    guard (value.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG) else {
      throw NativeFileVerificationFailure.invalid("Verification requires a regular file")
    }
    device = Int64(value.st_dev); inode = UInt64(value.st_ino); size = value.st_size
    modifiedSeconds = Int64(value.st_mtimespec.tv_sec); modifiedNanoseconds = Int64(value.st_mtimespec.tv_nsec)
    changedSeconds = Int64(value.st_ctimespec.tv_sec); changedNanoseconds = Int64(value.st_ctimespec.tv_nsec)
  }
}

private func verificationIdentity(path: String) throws -> VerificationFileIdentity {
  var value = stat()
  guard lstat(path, &value) == 0 else { throw NativeFileVerificationFailure.invalid("Cannot inspect verification file") }
  return try VerificationFileIdentity(value)
}

private func verificationIdentity(handle: FileHandle) throws -> VerificationFileIdentity {
  var value = stat()
  guard fstat(handle.fileDescriptor, &value) == 0 else { throw NativeFileVerificationFailure.invalid("Cannot inspect open verification file") }
  return try VerificationFileIdentity(value)
}

private func verificationInsideDocuments(_ file: URL, documents: URL) -> Bool {
  let root = documents.standardizedFileURL.resolvingSymlinksInPath().path
  let path = file.standardizedFileURL.resolvingSymlinksInPath().path
  return path.hasPrefix(root.hasSuffix("/") ? root : root + "/")
}

private func verificationDescriptorURL(_ handle: FileHandle) throws -> URL {
  let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: Int(MAXPATHLEN))
  defer { buffer.deallocate() }
  guard fcntl(handle.fileDescriptor, F_GETPATH, buffer) != -1 else {
    throw NativeFileVerificationFailure.invalid("Cannot resolve open verification file")
  }
  return URL(fileURLWithPath: String(cString: buffer))
}

// Pure local I/O: no network, rename, cache writes or source file mutations.
// One autorelease pool per 4 MiB read prevents retained NSData growth on iOS.
func verifyLocalFile(path: String, documentsURL: URL, expectedBytes: Int64, expectedSha256: String,
  isCancelled: () -> Bool, progress: (Int64, Int64) -> Void) throws -> NativeFileVerificationResult {
  let started = ProcessInfo.processInfo.systemUptime
  func checkCancellation() throws { if isCancelled() { throw NativeFileVerificationFailure.cancelled } }
  try checkCancellation()
  guard expectedBytes > 0, expectedSha256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil,
        let source = URL(string: path), source.isFileURL, verificationInsideDocuments(source, documents: documentsURL) else {
    throw NativeFileVerificationFailure.invalid("Verification requires pinned integrity metadata and an app Documents file URL")
  }
  // Keep the caller's path bound to the same regular file that will later be
  // loaded. lstat rejects a final symlink; directory aliases such as /var are
  // still followed normally and retain their underlying file identity.
  let original = source.standardizedFileURL
  let originalIdentity = try verificationIdentity(path: original.path)
  let file = original.resolvingSymlinksInPath()
  let before = try verificationIdentity(path: file.path)
  guard originalIdentity == before, before.size == expectedBytes else { throw NativeFileVerificationFailure.invalid("Model size or source identity does not match the pinned file") }
  let handle = try FileHandle(forReadingFrom: file)
  defer { try? handle.close() }
  guard try verificationIdentity(handle: handle) == before,
        verificationInsideDocuments(try verificationDescriptorURL(handle), documents: documentsURL) else {
    throw NativeFileVerificationFailure.invalid("Verification file changed or escaped app Documents while opening")
  }
  var hash = SHA256()
  var bytesRead: Int64 = 0
  var lastProgress = -Double.infinity
  while true {
    try checkCancellation()
    let count: Int = try autoreleasepool {
      guard let data = try handle.read(upToCount: 4 * 1024 * 1024), !data.isEmpty else { return 0 }
      try checkCancellation()
      hash.update(data: data)
      return data.count
    }
    if count == 0 { break }
    bytesRead += Int64(count)
    guard bytesRead <= expectedBytes else { throw NativeFileVerificationFailure.invalid("Verification file grew during hashing") }
    let now = ProcessInfo.processInfo.systemUptime
    if bytesRead < expectedBytes && now - lastProgress >= 0.25 {
      lastProgress = now; progress(bytesRead, expectedBytes)
    }
  }
  try checkCancellation()
  func checkUnchanged() throws {
    guard bytesRead == expectedBytes, try verificationIdentity(handle: handle) == before,
          try verificationIdentity(path: original.path) == originalIdentity,
          try verificationIdentity(path: file.path) == before,
          verificationInsideDocuments(try verificationDescriptorURL(handle), documents: documentsURL) else {
      throw NativeFileVerificationFailure.invalid("Verification file changed during hashing")
    }
  }
  try checkUnchanged()
  let actual = hash.finalize().map { String(format: "%02x", $0) }.joined()
  guard actual == expectedSha256.lowercased() else { throw NativeFileVerificationFailure.invalid("Model SHA-256 does not match the pinned file") }
  try checkCancellation()
  progress(bytesRead, expectedBytes)
  try checkCancellation()
  try checkUnchanged()
  return NativeFileVerificationResult(sha256: actual, sizeBytes: bytesRead,
    durationMs: (ProcessInfo.processInfo.systemUptime - started) * 1000)
}

private final class VerificationCancellation {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func isCancelled() -> Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
}

// Per-module owner. Registration/cancellation use only this short lock; disk
// work runs on an independent utility queue, never an Expo or JS queue.
final class NativeFileVerifier {
  private let work = DispatchQueue(label: "notatki.model.file-verification", qos: .utility)
  private let lock = NSLock()
  private let documentsURL: URL
  private var active: [String: VerificationCancellation] = [:]
  private var pendingCancelled: Set<String> = []
  private var destroyed = false
  init(documentsURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]) {
    self.documentsURL = documentsURL
  }
  func cancel(id: String) {
    guard id.range(of: "^verification-[A-Za-z0-9-]+$", options: .regularExpression) != nil, id.count <= 160 else { return }
    lock.lock(); defer { lock.unlock() }
    if let token = active[id] { token.cancel() }
    else if !destroyed { pendingCancelled.insert(id) }
  }
  func cancelAll() {
    lock.lock(); defer { lock.unlock() }
    destroyed = true; pendingCancelled.removeAll()
    active.values.forEach { $0.cancel() }
  }
  func verify(id: String, path: String, expectedBytes: Int64, expectedSha256: String,
    progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<NativeFileVerificationResult, Error>) -> Void) {
    guard id.range(of: "^verification-[A-Za-z0-9-]+$", options: .regularExpression) != nil, id.count <= 160 else {
      completion(.failure(NativeFileVerificationFailure.invalid("Invalid verification ID"))); return
    }
    lock.lock()
    if destroyed || pendingCancelled.remove(id) != nil {
      lock.unlock(); completion(.failure(NativeFileVerificationFailure.cancelled)); return
    }
    if active[id] != nil {
      lock.unlock(); completion(.failure(NativeFileVerificationFailure.invalid("Verification ID is already active"))); return
    }
    let token = VerificationCancellation()
    active[id] = token
    lock.unlock()
    work.async {
      let result: Result<NativeFileVerificationResult, Error>
      do {
        result = .success(try verifyLocalFile(path: path, documentsURL: self.documentsURL, expectedBytes: expectedBytes,
          expectedSha256: expectedSha256, isCancelled: token.isCancelled, progress: progress))
      } catch { result = .failure(error) }
      // Keep cancellation and the small promise-resolution commit ordered.
      // This callback only schedules Expo promise completion; it must not
      // synchronously re-enter this owner. Progress callbacks hold no lock.
      self.lock.lock()
      self.active.removeValue(forKey: id)
      completion(token.isCancelled() ? .failure(NativeFileVerificationFailure.cancelled) : result)
      self.lock.unlock()
    }
  }
}
