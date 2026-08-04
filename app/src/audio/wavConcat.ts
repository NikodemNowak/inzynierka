import { File } from 'expo-file-system'

const HEADER_BYTES = 44
const SAMPLE_RATE = 16000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

// A restarted recognition session writes its own file, so a recording that was
// interrupted arrives as several parts. They all share the format we request
// (16 kHz mono PCM), which makes them concatenable: one header, then the raw
// samples of every part in order.
export const buildWavHeader = (dataBytes: number): Uint8Array => {
  const header = new Uint8Array(HEADER_BYTES)
  const view = new DataView(header.buffer)
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) header[offset + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // chunk size: everything after this field
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format chunk length
  view.setUint16(20, 1, true) // audio format: 1 = PCM
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  return header
}

export const wavDurationMs = (dataBytes: number): number =>
  Math.round((dataBytes / ((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8)) * 1000)

export interface ConcatResult {
  uri: string
  durationMs: number
}

// Copies a part's samples into the writer without holding the file in memory.
// The leading header has to be dropped, and it may straddle the first chunks,
// so the skip is tracked across reads.
const pipeSamples = async (
  file: File,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> => {
  const reader = file.readableStream().getReader()
  let toSkip = HEADER_BYTES
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      if (toSkip >= value.length) {
        toSkip -= value.length
        continue
      }
      await writer.write(toSkip > 0 ? value.subarray(toSkip) : value)
      toSkip = 0
    }
  } finally {
    reader.releaseLock()
  }
}

// Streams the parts rather than reading them into memory: a long recording is
// tens of megabytes, and loading that at once is what kills an app on iOS.
export const concatWavFiles = async (
  partUris: readonly string[],
  targetUri: string,
): Promise<ConcatResult> => {
  const parts = partUris.map((uri) => new File(uri)).filter((file) => file.exists)
  if (parts.length === 0) throw new Error('Brak plików do połączenia')

  const dataBytes = parts.reduce(
    (total, file) => total + Math.max(0, (file.size ?? 0) - HEADER_BYTES),
    0,
  )

  const target = new File(targetUri)
  if (target.exists) target.delete()
  target.create()

  const writer = target.writableStream().getWriter()
  try {
    await writer.write(buildWavHeader(dataBytes))
    for (const part of parts) await pipeSamples(part, writer)
  } finally {
    await writer.close()
  }

  return { uri: targetUri, durationMs: wavDurationMs(dataBytes) }
}
