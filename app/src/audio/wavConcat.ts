import { translate } from '../i18n/translate'
import { File, FileMode } from 'expo-file-system'

const HEADER_BYTES = 44
const SAMPLE_RATE = 16000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

export const findWavData = (
  header: Uint8Array,
): { offset: number; size: number } | null => {
  if (header.length < 12) return null
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...header.subarray(offset, offset + length))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error(translate('Nieprawidłowy plik WAV', 'Invalid WAV file'))
  }

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  let offset = 12
  let validFormat = false
  while (offset + 8 <= header.length) {
    const size = view.getUint32(offset + 4, true)
    if (ascii(offset, 4) === 'fmt ') {
      if (
        size < 16 ||
        offset + 24 > header.length ||
        view.getUint16(offset + 8, true) !== 1 ||
        view.getUint16(offset + 10, true) !== CHANNELS ||
        view.getUint32(offset + 12, true) !== SAMPLE_RATE ||
        view.getUint32(offset + 16, true) !== SAMPLE_RATE * 2 ||
        view.getUint16(offset + 20, true) !== 2 ||
        view.getUint16(offset + 22, true) !== BITS_PER_SAMPLE
      )
        throw new Error(
          translate('Niezgodny format WAV', 'Mismatched WAV format'),
        )
      validFormat = true
    }
    if (ascii(offset, 4) === 'data') {
      if (!validFormat || size % 2 !== 0)
        throw new Error(
          translate('Nieprawidłowy format WAV', 'Invalid WAV format'),
        )
      return { offset: offset + 8, size }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

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
    for (let i = 0; i < text.length; i += 1)
      header[offset + i] = text.charCodeAt(i)
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
  Math.round(
    (dataBytes / ((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8)) * 1000,
  )

export interface ConcatResult {
  uri: string
  durationMs: number
}

const readWavDataInfo = (file: File): { offset: number; size: number } => {
  const handle = file.open(FileMode.ReadOnly)
  try {
    const header = handle.readBytes(Math.min(file.size ?? 0, 64 * 1024))
    const info = findWavData(header)
    if (!info || info.offset + info.size > (file.size ?? 0)) {
      throw new Error(translate('Niekompletny plik WAV', 'Incomplete WAV file'))
    }
    return info
  } finally {
    handle.close()
  }
}

// Copy only the PCM data chunk. Core Audio's WAV header can include a 4 KiB
// FLLR chunk, so skipping a fixed 44 bytes would copy header padding as audio.
const pipeSamples = async (
  file: File,
  info: { offset: number; size: number },
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> => {
  const handle = file.open(FileMode.ReadOnly)
  try {
    handle.offset = info.offset
    let remaining = info.size
    while (remaining > 0) {
      const bytes = handle.readBytes(Math.min(remaining, 64 * 1024))
      if (bytes.length === 0)
        throw new Error(
          translate('Niekompletny plik WAV', 'Incomplete WAV file'),
        )
      await writer.write(bytes)
      remaining -= bytes.length
    }
  } finally {
    handle.close()
  }
}

// Streams the parts rather than reading them into memory: a long recording is
// tens of megabytes, and loading that at once is what kills an app on iOS.
export const concatWavFiles = async (
  partUris: readonly string[],
  targetUri: string,
): Promise<ConcatResult> => {
  const parts = partUris
    .map((uri) => {
      const file = new File(uri)
      if (!file.exists)
        throw new Error(
          translate(
            'Brak części nagrania. Pliki źródłowe zachowano.',
            'A recording segment is missing. Source files have been kept.',
          ),
        )
      return { uri, file }
    })
    .map(({ uri, file }) => ({ uri, file, info: readWavDataInfo(file) }))
  if (parts.length === 0)
    throw new Error(
      translate('Brak plików do połączenia', 'No audio files to join'),
    )
  if (parts.length === 1) {
    const part = parts[0]!
    return { uri: part.uri, durationMs: wavDurationMs(part.info.size) }
  }

  const dataBytes = parts.reduce((total, part) => total + part.info.size, 0)

  const target = new File(`${targetUri}.partial`)
  if (target.exists) target.delete()
  target.create()

  const writer = target.writableStream().getWriter()
  try {
    await writer.write(buildWavHeader(dataBytes))
    for (const part of parts) await pipeSamples(part.file, part.info, writer)
    await writer.close()
  } catch (error) {
    try {
      await writer.abort()
    } catch {}
    if (target.exists) target.delete()
    throw error
  }

  const info = readWavDataInfo(target)
  if (info.size !== dataBytes)
    throw new Error('Audio finalization size mismatch')
  const destination = new File(targetUri)
  if (destination.exists) {
    const existing = readWavDataInfo(destination)
    if (existing.size !== dataBytes)
      throw new Error('Existing audio does not match this session')
    target.delete()
  } else target.move(destination)
  return { uri: targetUri, durationMs: wavDurationMs(dataBytes) }
}
