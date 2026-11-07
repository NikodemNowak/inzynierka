import { readMemory, type MemorySnapshot } from '../processing/nativeProcessing'

// Samples process memory while the suite runs. The model generates in native
// code, so the JS thread is mostly idle and the timer keeps ticking; the peak
// of each phase then includes the loaded model and its context.

export interface MemoryPhase {
  peakFootprintMb: number | null
  minAvailableMb: number | null
  samples: number
}

export interface MemoryTraceResult {
  baseline: { footprintMb: number | null; availableMb: number } | null
  phases: Record<string, MemoryPhase>
  peakFootprintMb: number | null
  minAvailableMb: number | null
  maxThermalState: number | null
}

const mb = (bytes: number): number => Math.round(bytes / 1048576)

export const createMemoryTrace = (read: () => MemorySnapshot | null = readMemory, intervalMs = 250) => {
  const first = read()
  const phases: Record<string, MemoryPhase> = {}
  let phase = 'start'
  let maxThermalState: number | null = null

  const sample = (): void => {
    const now = read()
    if (!now) return
    const entry = (phases[phase] ??= { peakFootprintMb: null, minAvailableMb: null, samples: 0 })
    entry.samples += 1
    if (now.footprintBytes !== null) entry.peakFootprintMb = Math.max(entry.peakFootprintMb ?? 0, mb(now.footprintBytes))
    entry.minAvailableMb = Math.min(entry.minAvailableMb ?? Infinity, mb(now.availableBytes))
    maxThermalState = Math.max(maxThermalState ?? 0, now.thermalState)
  }
  const timer = first ? setInterval(sample, intervalMs) : null

  return {
    phase(name: string): void {
      sample()
      phase = name
      sample()
    },
    stop(): MemoryTraceResult {
      if (timer) clearInterval(timer)
      sample()
      const all = Object.values(phases)
      const peaks = all.map((entry) => entry.peakFootprintMb).filter((value): value is number => value !== null)
      const lows = all.map((entry) => entry.minAvailableMb).filter((value): value is number => value !== null)
      return {
        baseline: first ? { footprintMb: first.footprintBytes === null ? null : mb(first.footprintBytes), availableMb: mb(first.availableBytes) } : null,
        phases,
        peakFootprintMb: peaks.length ? Math.max(...peaks) : null,
        minAvailableMb: lows.length ? Math.min(...lows) : null,
        maxThermalState,
      }
    },
  }
}
