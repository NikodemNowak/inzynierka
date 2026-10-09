import AVFoundation
import Foundation

struct DecodedSpeechWindow {
  let frames: Int64
  let sampleRate: Double
  let path: String
  var durationMs: Double { Double(frames) * 1000 / sampleRate }
}

enum SpeechWindowDecoder {
  // The same bounded converter loop used by imports, isolated so a Mac probe
  // can verify the exact PCM source and prefix without speech permissions.
  static func decode(sourceURL: URL, startMs: Double, durationMs: Double, outputURL: URL,
                     isCancelled: () -> Bool) throws -> DecodedSpeechWindow {
    let source = try AVAudioFile(forReading: sourceURL)
    // Capture files and bundled benchmarks already match Speech's bounded
    // PCM format. Copy their exact samples instead of converting PCM to float
    // and back for every request. Codec and format changes keep the converter.
    let stored = source.fileFormat
    if stored.commonFormat == .pcmFormatInt16, stored.sampleRate == 16000, stored.channelCount == 1 {
      return try copyPCM(sourceURL: sourceURL, startMs: startMs, durationMs: durationMs,
                         outputURL: outputURL, isCancelled: isCancelled)
    }
    let input = source.processingFormat
    guard input.sampleRate > 0,
          let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: input, to: output),
          let buffer = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: 4096),
          let converted = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: AVAudioFrameCount(ceil(4096 * 16000 / input.sampleRate)) + 32) else {
      throw failure("Cannot decode audio")
    }
    source.framePosition = AVAudioFramePosition(floor(startMs * input.sampleRate / 1000))
    let sourceFrames = min(source.length - source.framePosition, AVAudioFramePosition(ceil(durationMs * input.sampleRate / 1000)))
    guard sourceFrames > 0 else { throw failure("Invalid speech window") }
    var written: Int64 = 0
    do {
      let target = try AVAudioFile(forWriting: outputURL, settings: output.settings, commonFormat: .pcmFormatInt16, interleaved: false)
      var remaining = sourceFrames
      while remaining > 0 {
        if isCancelled() { throw failure("Transcription cancelled") }
        try source.read(into: buffer, frameCount: AVAudioFrameCount(min(4096, remaining)))
        guard buffer.frameLength > 0 else { throw failure("Unexpected end of audio source") }
        remaining -= AVAudioFramePosition(buffer.frameLength)
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: converted, error: &error) { _, state in
          if supplied { state.pointee = .noDataNow; return nil }
          supplied = true; state.pointee = .haveData; return buffer
        }
        if status == .error { throw error ?? failure("Audio conversion failed") }
        if converted.frameLength > 0 {
          try target.write(from: converted)
          written += Int64(converted.frameLength)
        }
      }
      var error: NSError?
      let status = converter.convert(to: converted, error: &error) { _, state in state.pointee = .endOfStream; return nil }
      if status == .error { throw error ?? failure("Audio conversion tail failed") }
      if converted.frameLength > 0 {
        try target.write(from: converted)
        written += Int64(converted.frameLength)
      }
    } // Closing the writer is required before inspecting or recognizing its URL.
    if isCancelled() { throw failure("Transcription cancelled") }
    let actual = try AVAudioFile(forReading: outputURL)
    let decoded = DecodedSpeechWindow(frames: actual.length, sampleRate: actual.processingFormat.sampleRate, path: "converter")
    let expectedMs = Double(sourceFrames) * 1000 / input.sampleRate
    guard decoded.frames == written, decoded.sampleRate == 16000,
          abs(decoded.durationMs - expectedMs) <= 20 else {
      throw failure("Decoded speech window did not retain the requested audio duration")
    }
    return decoded
  }
  private static func copyPCM(sourceURL: URL, startMs: Double, durationMs: Double, outputURL: URL,
                              isCancelled: () -> Bool) throws -> DecodedSpeechWindow {
    let source = try AVAudioFile(forReading: sourceURL, commonFormat: .pcmFormatInt16, interleaved: false)
    let format = source.processingFormat
    guard format.commonFormat == .pcmFormatInt16, format.sampleRate == 16000, format.channelCount == 1,
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw failure("Cannot copy PCM audio") }
    source.framePosition = AVAudioFramePosition(floor(startMs * 16))
    let sourceFrames = min(source.length - source.framePosition, AVAudioFramePosition(ceil(durationMs * 16)))
    guard sourceFrames > 0 else { throw failure("Invalid speech window") }
    var written: Int64 = 0
    do {
      let target = try AVAudioFile(forWriting: outputURL, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
      while written < sourceFrames {
        if isCancelled() { throw failure("Transcription cancelled") }
        try source.read(into: buffer, frameCount: AVAudioFrameCount(min(4096, sourceFrames - written)))
        guard buffer.frameLength > 0 else { throw failure("Unexpected end of audio source") }
        try target.write(from: buffer)
        written += Int64(buffer.frameLength)
      }
    }
    if isCancelled() { throw failure("Transcription cancelled") }
    let actual = try AVAudioFile(forReading: outputURL)
    let decoded = DecodedSpeechWindow(frames: actual.length, sampleRate: actual.processingFormat.sampleRate, path: "pcm-copy")
    guard decoded.frames == written, written == sourceFrames, decoded.sampleRate == 16000 else {
      throw failure("Copied speech window did not retain the requested audio duration")
    }
    return decoded
  }
  private static func failure(_ message: String) -> NSError {
    NSError(domain: "NotatkiSpeechWindow", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
