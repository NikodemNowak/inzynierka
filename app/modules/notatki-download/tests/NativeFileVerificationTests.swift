import Foundation
import CryptoKit

@main
struct NativeFileVerificationTests {
  static func main() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("notatki-verify-tests-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("test.gguf")
    let abc = Data("abc".utf8)
    let sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    try abc.write(to: file)
    func require(_ message: String, _ value: Bool) throws {
      guard value else { throw NSError(domain: "NativeFileVerificationTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    func rejected(_ operation: () throws -> Void) -> Bool {
      do { try operation(); return false } catch { return true }
    }
    var progress: [(Int64, Int64)] = []
    let result = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: 3, expectedSha256: sha,
      isCancelled: { false }, progress: { progress.append(($0, $1)) })
    try require("Known SHA256 matches and final progress is emitted", result.sha256 == sha && result.sizeBytes == 3 && progress.last?.0 == 3)
    try require("Digest mismatch rejects", rejected {
      _ = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: 3, expectedSha256: String(repeating: "0", count: 64), isCancelled: { false }, progress: { _, _ in })
    })
    try require("Pinned size mismatch rejects before hashing", rejected {
      _ = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: 4, expectedSha256: sha, isCancelled: { false }, progress: { _, _ in })
    })
    let large = Data(repeating: 0x61, count: 8 * 1024 * 1024 + 3)
    try large.write(to: file)
    let largeSha = SHA256.hash(data: large).map { String(format: "%02x", $0) }.joined()
    let largeResult = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: Int64(large.count), expectedSha256: largeSha,
      isCancelled: { false }, progress: { _, _ in })
    try require("Successful verification crosses two 4 MiB boundaries and a short tail", largeResult.sha256 == largeSha && largeResult.sizeBytes == Int64(large.count))
    var cancelled = false
    var firstRead: Int64 = 0
    try require("Cancellation after one bounded read stops hashing", rejected {
      _ = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: Int64(large.count), expectedSha256: largeSha,
        isCancelled: { cancelled }, progress: { bytes, _ in firstRead = bytes; cancelled = true })
    } && firstRead == 4 * 1024 * 1024)
    try require("File mutation during hashing rejects", rejected {
      _ = try verifyLocalFile(path: file.absoluteString, documentsURL: directory, expectedBytes: Int64(large.count), expectedSha256: largeSha,
        isCancelled: { false }, progress: { _, _ in try? abc.write(to: file) })
    })
    let outside = directory.deletingLastPathComponent().appendingPathComponent("notatki-outside-" + UUID().uuidString)
    try abc.write(to: outside)
    defer { try? FileManager.default.removeItem(at: outside) }
    let link = directory.appendingPathComponent("escape.gguf")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
    try require("Symlink escape is rejected", rejected {
      _ = try verifyLocalFile(path: link.absoluteString, documentsURL: directory, expectedBytes: 3, expectedSha256: sha, isCancelled: { false }, progress: { _, _ in })
    })
    let insideLink = directory.appendingPathComponent("inside-link.gguf")
    try FileManager.default.createSymbolicLink(at: insideLink, withDestinationURL: file)
    try require("Final symlink inside Documents is rejected before hashing", rejected {
      _ = try verifyLocalFile(path: insideLink.absoluteString, documentsURL: directory, expectedBytes: 3, expectedSha256: sha, isCancelled: { false }, progress: { _, _ in })
    })
    let parentAlias = directory.deletingLastPathComponent().appendingPathComponent("notatki-parent-alias-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createSymbolicLink(at: parentAlias, withDestinationURL: directory)
    defer { try? FileManager.default.removeItem(at: parentAlias) }
    let aliasedResult = try verifyLocalFile(path: parentAlias.appendingPathComponent("test.gguf").absoluteString, documentsURL: directory, expectedBytes: 3, expectedSha256: sha,
      isCancelled: { false }, progress: { _, _ in })
    try require("A parent directory alias preserves regular source identity", aliasedResult.sha256 == sha && aliasedResult.sizeBytes == 3)
    let verifier = NativeFileVerifier(documentsURL: directory)
    let id = "verification-before-registration"
    verifier.cancel(id: id)
    verifier.cancel(id: id)
    let completed = DispatchSemaphore(value: 0)
    var wasCancelled = false
    verifier.verify(id: id, path: file.absoluteString, expectedBytes: 3, expectedSha256: sha, progress: { _, _ in }) { result in
      if case .failure(let error) = result, let failure = error as? NativeFileVerificationFailure, case .cancelled = failure { wasCancelled = true }
      completed.signal()
    }
    try require("Cancel before registration is retained and idempotent", completed.wait(timeout: .now() + 5) == .success && wasCancelled)
    verifier.cancelAll()
    let destroyed = DispatchSemaphore(value: 0)
    var rejectedAfterDestroy = false
    verifier.verify(id: "verification-after-destroy", path: file.absoluteString, expectedBytes: 3, expectedSha256: sha, progress: { _, _ in }) { result in
      if case .failure(let error) = result, let failure = error as? NativeFileVerificationFailure, case .cancelled = failure { rejectedAfterDestroy = true }
      destroyed.signal()
    }
    try require("Destroyed verifier never starts new work", destroyed.wait(timeout: .now() + 5) == .success && rejectedAfterDestroy)
    print("NativeFileVerificationTests: 11 cases passed")
  }
}
