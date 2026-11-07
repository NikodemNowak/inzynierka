import { createMemoryTrace } from './memoryTrace'

const MB = 1048576

jest.mock('../processing/nativeProcessing', () => ({ readMemory: () => null }))

test('keeps the peak footprint and lowest headroom of each phase', () => {
  jest.useFakeTimers()
  const readings = [
    { footprintBytes: 100 * MB, availableBytes: 5000 * MB, thermalState: 0 },
    { footprintBytes: 120 * MB, availableBytes: 4900 * MB, thermalState: 0 },
    { footprintBytes: 3100 * MB, availableBytes: 2000 * MB, thermalState: 1 },
    { footprintBytes: 2900 * MB, availableBytes: 2200 * MB, thermalState: 2 },
  ]
  let index = 0
  const trace = createMemoryTrace(() => readings[Math.min(index++, readings.length - 1)]!, 250)
  trace.phase('llm')
  jest.advanceTimersByTime(250)
  const result = trace.stop()
  jest.useRealTimers()

  expect(result.baseline).toEqual({ footprintMb: 100, availableMb: 5000 })
  expect(result.phases.start).toEqual({ peakFootprintMb: 120, minAvailableMb: 4900, samples: 1 })
  expect(result.phases.llm?.peakFootprintMb).toBe(3100)
  expect(result.phases.llm?.minAvailableMb).toBe(2000)
  expect(result.peakFootprintMb).toBe(3100)
  expect(result.minAvailableMb).toBe(2000)
  expect(result.maxThermalState).toBe(2)
})

test('records nothing where the native reading is unavailable', () => {
  const result = createMemoryTrace(() => null).stop()
  expect(result).toEqual({ baseline: null, phases: {}, peakFootprintMb: null, minAvailableMb: null, maxThermalState: null })
})
