import AVFoundation
import Foundation

@main
struct SpeechWindowDecoderTests {
  // Compare the stored PCM bytes independently of AVAudioFile's processing
  // reads, which can return a shorter converted buffer than the file length.
  static func samples(_ url: URL) throws -> [Int16] {
    let bytes = [UInt8](try Data(contentsOf: url))
    func word(_ offset: Int) -> UInt16 { UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8 }
    func dword(_ offset: Int) -> Int { Int(word(offset)) | Int(word(offset + 2)) << 16 }
    func tag(_ offset: Int) -> String { String(decoding: bytes[offset..<offset + 4], as: UTF8.self) }
    guard bytes.count >= 12, tag(0) == "RIFF", tag(8) == "WAVE", dword(4) + 8 == bytes.count else {
      fatalError("Expected a complete little-endian RIFF WAV")
    }
    var offset = 12
    var pcmFormat = false
    var data: Range<Int>?
    while offset + 8 <= bytes.count {
      let count = dword(offset + 4)
      let begin = offset + 8
      guard count <= bytes.count - begin else { fatalError("Truncated WAV chunk") }
      if tag(offset) == "fmt " {
        guard count >= 16 else { fatalError("Invalid WAV format chunk") }
        let format = word(begin)
        let pcm = format == 1 || (format == 65534 && count >= 40 && word(begin + 24) == 1)
        pcmFormat = pcm && word(begin + 2) == 1 && dword(begin + 4) == 16000 &&
          word(begin + 12) == 2 && word(begin + 14) == 16
      }
      if tag(offset) == "data" { data = begin..<begin + count }
      offset = begin + count + count % 2
    }
    guard pcmFormat, let data = data, data.count % 2 == 0 else { fatalError("Expected PCM16 mono 16 kHz WAV data") }
    return stride(from: data.lowerBound, to: data.upperBound, by: 2).map { Int16(bitPattern: word($0)) }
  }
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { fatalError("Pass the exact benchmark WAV path") }
    let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let original = try samples(sourceURL)
    guard original.count == 796320 else { fatalError("Unexpected benchmark fixture frame count") }
    let fullURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-speech-full.wav")
    let windowURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-speech-window.wav")
    let cancelledURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-speech-cancel.wav")
    let convertedSourceURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-speech-stereo.wav")
    let convertedURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-speech-converted.wav")
    defer { for url in [fullURL, windowURL, cancelledURL, convertedSourceURL, convertedURL] { try? FileManager.default.removeItem(at: url) } }
    let decoded = try SpeechWindowDecoder.decode(sourceURL: sourceURL, startMs: 0, durationMs: 49770, outputURL: fullURL, isCancelled: { false })
    let actual = try samples(fullURL)
    guard decoded.frames == 796320, decoded.durationMs == 49770, decoded.path == "pcm-copy", actual == original else {
      fatalError("Converter did not preserve the entire exact PCM fixture including its prefix")
    }
    let window = try SpeechWindowDecoder.decode(sourceURL: sourceURL, startMs: 17000, durationMs: 8000, outputURL: windowURL, isCancelled: { false })
    guard window.frames == 128000, window.path == "pcm-copy", try samples(windowURL) == Array(original[272000..<400000]) else {
      fatalError("Converter did not retain the exact requested middle source window")
    }
    var rejected = false
    do { _ = try SpeechWindowDecoder.decode(sourceURL: sourceURL, startMs: 0, durationMs: 49770, outputURL: cancelledURL, isCancelled: { true }) } catch { rejected = true }
    guard rejected else { fatalError("Cancellation must reject before a speech-ready window is returned") }
    var reads = 0
    rejected = false
    do {
      _ = try SpeechWindowDecoder.decode(sourceURL: sourceURL, startMs: 0, durationMs: 49770, outputURL: cancelledURL, isCancelled: {
        reads += 1; return reads >= 3
      })
    } catch { rejected = true }
    guard rejected, reads == 3 else { fatalError("Cancellation during PCM copy cannot return a shorter successful window") }
    let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 32000, channels: 2, interleaved: false)!
    do {
      let file = try AVAudioFile(forWriting: convertedSourceURL, settings: stereo.settings)
      let buffer = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: 32000)!
      buffer.frameLength = 32000
      for channel in 0..<2 {
        for index in 0..<32000 { buffer.floatChannelData![channel][index] = 0 }
      }
      try file.write(from: buffer)
    }
    let converted = try SpeechWindowDecoder.decode(sourceURL: convertedSourceURL, startMs: 0, durationMs: 1000,
      outputURL: convertedURL, isCancelled: { false })
    guard converted.path == "converter", converted.sampleRate == 16000, abs(converted.durationMs - 1000) <= 20,
          try samples(convertedURL).allSatisfy({ $0 == 0 }) else {
      fatalError("Other rates/channel counts must retain the validated converter path")
    }
    let report: [String: Any] = ["checks": 5, "sourceFrames": original.count, "decodedFrames": decoded.frames, "comparedSamples": actual.count,
      "decodedDurationMs": decoded.durationMs, "entirePCMIdentical": actual == original,
      "prefixPCMIdentical": Array(actual.prefix(160000)) == Array(original.prefix(160000)),
      "middleWindowIdentical": true, "cancellationRejected": rejected, "midCopyCancellationRejected": true,
      "otherFormatConverterPreserved": true, "decodePath": decoded.path]
    print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), as: UTF8.self))
  }
}
