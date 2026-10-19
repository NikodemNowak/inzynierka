import { File, FileMode } from 'expo-file-system'
import { LevelAccumulator, levelWindowMs } from '../domain/audioTimeline'
import { readWavDataInfo, wavDurationMs } from './wavConcat'

const SAMPLE_RATE = 16000
const CHUNK_BYTES = 64 * 1024

/** Duration of a recorded 16 kHz mono PCM part, from its data chunk. */
export const wavPartDurationMs = (uri: string): number =>
  wavDurationMs(readWavDataInfo(new File(uri)).size)

const yieldToUi = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Loudness per window of a recorded WAV, streamed in small chunks. */
export const readWavLevels = async (uri: string): Promise<{ levelMs: number; levels: number[] }> => {
  const file = new File(uri)
  const info = readWavDataInfo(file)
  const levelMs = levelWindowMs(wavDurationMs(info.size))
  const accumulator = new LevelAccumulator(SAMPLE_RATE, levelMs)
  const handle = file.open(FileMode.ReadOnly)
  try {
    handle.offset = info.offset
    let remaining = info.size
    let chunks = 0
    while (remaining > 0) {
      const bytes = handle.readBytes(Math.min(remaining, CHUNK_BYTES))
      if (bytes.length === 0) break
      const even = bytes.length - (bytes.length % 2)
      // Copy keeps the view aligned whatever offset the native buffer has.
      accumulator.push(new Int16Array(bytes.slice(0, even).buffer))
      remaining -= bytes.length
      // A long recording is tens of megabytes; keep the stopping UI responsive.
      chunks += 1
      if (chunks % 16 === 0) await yieldToUi()
    }
  } finally {
    handle.close()
  }
  return { levelMs, levels: accumulator.finish() }
}
