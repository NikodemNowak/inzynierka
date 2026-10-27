import { useState } from 'react'

// Live recording readings that change many times a second. They live outside
// React state so only the components that draw them update, not the screen.
export interface RecorderMeter {
  readonly volume: number
  readonly durationMs: number
  subscribeDuration: (listener: (durationMs: number) => void) => () => void
}

export class RecorderMeterStore implements RecorderMeter {
  volume = 0
  durationMs = 0
  private readonly listeners = new Set<(durationMs: number) => void>()

  readonly setVolume = (value: number): void => {
    this.volume = value
  }

  readonly setDuration = (ms: number): void => {
    if (ms === this.durationMs) return
    this.durationMs = ms
    for (const listener of this.listeners) listener(ms)
  }

  readonly subscribeDuration = (listener: (durationMs: number) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const useRecorderMeterStore = (): RecorderMeterStore =>
  useState(() => new RecorderMeterStore())[0]
