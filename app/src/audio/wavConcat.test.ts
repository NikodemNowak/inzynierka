import { buildWavHeader, findWavData, wavDurationMs } from './wavConcat'

const ascii = (header: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...header.subarray(offset, offset + length))

const uint32 = (header: Uint8Array, offset: number): number =>
  new DataView(header.buffer).getUint32(offset, true)

const uint16 = (header: Uint8Array, offset: number): number =>
  new DataView(header.buffer).getUint16(offset, true)

describe('buildWavHeader', () => {
  // Byte values verified against a real concatenation on the device: two parts
  // of 3 631 660 B and 6 990 380 B produced a 10 621 996 B file.
  const DATA_BYTES = 10_621_952
  const header = buildWavHeader(DATA_BYTES)

  it('is exactly 44 bytes', () => {
    expect(header.length).toBe(44)
  })

  it('carries the RIFF/WAVE chunk markers', () => {
    expect(ascii(header, 0, 4)).toBe('RIFF')
    expect(ascii(header, 8, 4)).toBe('WAVE')
    expect(ascii(header, 12, 4)).toBe('fmt ')
    expect(ascii(header, 36, 4)).toBe('data')
  })

  it('declares the RIFF size as everything after that field', () => {
    expect(uint32(header, 4)).toBe(36 + DATA_BYTES)
  })

  it('declares the recorded format: 16 kHz mono 16-bit PCM', () => {
    expect(uint32(header, 16)).toBe(16) // fmt chunk length
    expect(uint16(header, 20)).toBe(1) // PCM
    expect(uint16(header, 22)).toBe(1) // channels
    expect(uint32(header, 24)).toBe(16000) // sample rate
    expect(uint32(header, 28)).toBe(32000) // byte rate
    expect(uint16(header, 32)).toBe(2) // block align
    expect(uint16(header, 34)).toBe(16) // bits per sample
  })

  it('declares the data size it was given', () => {
    expect(uint32(header, 40)).toBe(DATA_BYTES)
  })

  it('handles an empty recording without producing a malformed header', () => {
    const empty = buildWavHeader(0)
    expect(uint32(empty, 4)).toBe(36)
    expect(uint32(empty, 40)).toBe(0)
  })
})

describe('wavDurationMs', () => {
  it('converts byte count to milliseconds at the recorded rate', () => {
    expect(wavDurationMs(32000)).toBe(1000)
    expect(wavDurationMs(10_621_952)).toBe(331_936)
  })

  it('reports zero for an empty recording', () => {
    expect(wavDurationMs(0)).toBe(0)
  })
})

describe('findWavData', () => {
  it('finds audio after the 4 KiB filler used by iOS recordings', () => {
    const header = new Uint8Array(4096)
    header.set(buildWavHeader(4).subarray(0, 36))
    header.set([70, 76, 76, 82], 36) // FLLR
    new DataView(header.buffer).setUint32(40, 4044, true)
    header.set([100, 97, 116, 97], 4088) // data
    new DataView(header.buffer).setUint32(4092, 4, true)

    expect(findWavData(header)).toEqual({ offset: 4096, size: 4 })
  })

  it('finds audio in a standard 44-byte WAV header', () => {
    expect(findWavData(buildWavHeader(32000))).toEqual({
      offset: 44,
      size: 32000,
    })
  })

  it('rejects a mismatched sample format instead of labeling it as PCM16k', () => {
    const wrongRate = buildWavHeader(32000)
    new DataView(wrongRate.buffer).setUint32(24, 48000, true)
    expect(() => findWavData(wrongRate)).toThrow()
    const truncatedFrame = buildWavHeader(3)
    expect(() => findWavData(truncatedFrame)).toThrow()
  })
})
