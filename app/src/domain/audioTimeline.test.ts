import {
  LevelAccumulator,
  barsFromLevels,
  buildAudioSpans,
  levelFromRms,
  levelWindowMs,
  parseAudioTimeline,
  relativeBarHeights,
  timeForRanges,
  MAX_TIMELINE_LEVELS,
} from './audioTimeline'

describe('levels', () => {
  it('maps RMS onto a 60 dB scale', () => {
    expect(levelFromRms(0)).toBe(0)
    expect(levelFromRms(1)).toBe(100)
    expect(levelFromRms(0.001)).toBe(0)
    expect(levelFromRms(0.1)).toBe(67)
    expect(levelFromRms(Number.NaN)).toBe(0)
  })

  it('widens the window so 30 minutes stays under the cap', () => {
    expect(levelWindowMs(10_000)).toBe(100)
    expect(levelWindowMs(30 * 60_000)).toBe(600)
    expect(Math.ceil((30 * 60_000) / levelWindowMs(30 * 60_000))).toBeLessThanOrEqual(MAX_TIMELINE_LEVELS)
  })

  it('emits one level per window across chunk boundaries', () => {
    const accumulator = new LevelAccumulator(1000, 100, 1)
    const loud = new Int16Array(150).fill(16384)
    accumulator.push(loud)
    accumulator.push(new Int16Array(100))
    const levels = accumulator.finish()
    expect(levels).toHaveLength(3)
    expect(levels[0]).toBe(levelFromRms(0.5))
    expect(levels[1]).toBeGreaterThan(0)
    expect(levels[2]).toBe(0)
  })

  it('keeps each bar group peak and scales against the note itself', () => {
    expect(barsFromLevels([10, 50, 20, 30], 2)).toEqual([50, 30])
    expect(barsFromLevels([40], 3)).toEqual([40, 40, 40])
    expect(relativeBarHeights([20, 20, 60, 40])).toEqual([0, 0, 1, 0.5])
    expect(relativeBarHeights([30, 30])).toEqual([0, 0])
  })
})

describe('buildAudioSpans', () => {
  it('places word timestamps after the earlier sessions audio', () => {
    const { transcript, spans, timing } = buildAudioSpans(
      [
        { session: 1, text: 'Kup mleko.', arrivedMs: 1500, words: [{ text: 'Kup', startMs: 200 }, { text: 'mleko.', startMs: 600 }] },
        { session: 2, text: 'Zadzwoń do Ani', arrivedMs: 2000, words: [{ text: 'Zadzwoń', startMs: 100 }, { text: 'do', startMs: 700 }, { text: 'Ani', startMs: 900 }] },
      ],
      [{ session: 1, durationMs: 3000 }, { session: 2, durationMs: 2500 }],
    )
    expect(transcript).toBe('Kup mleko. Zadzwoń do Ani')
    expect(timing).toBe('words')
    expect(spans[0]).toEqual({ start: 0, end: 3, startMs: 200, endMs: 600 })
    expect(spans[1]).toEqual({ start: 4, end: 10, startMs: 600, endMs: 1500 })
    expect(spans[2]).toEqual({ start: 11, end: 18, startMs: 3100, endMs: 3700 })
    expect(spans[4]).toEqual({ start: 22, end: 25, startMs: 3900, endMs: 5000 })
  })

  it('falls back to arrival times and skips sessions that left no audio', () => {
    const { transcript, spans, timing } = buildAudioSpans(
      [
        { session: 1, text: 'pierwsze', arrivedMs: 1200, words: [] },
        { session: 1, text: 'drugie', arrivedMs: 9000, words: [] },
        { session: 2, text: 'bez pliku', arrivedMs: 500, words: [] },
        { session: 3, text: 'końcówka', arrivedMs: null, words: [] },
      ],
      [{ session: 1, durationMs: 4000 }, { session: 3, durationMs: 1000 }],
    )
    expect(transcript).toBe('pierwsze drugie bez pliku końcówka')
    expect(timing).toBe('utterances')
    expect(spans).toEqual([
      { start: 0, end: 8, startMs: 0, endMs: 1200 },
      { start: 9, end: 15, startMs: 1200, endMs: 4000 },
      { start: 26, end: 34, startMs: 4000, endMs: 5000 },
    ])
  })

  it('does not trust words that are not in the transcript', () => {
    const { spans } = buildAudioSpans(
      [{ session: 1, text: 'dwa koty', arrivedMs: 800, words: [{ text: '2', startMs: 0 }, { text: 'koty', startMs: 300 }] }],
      [{ session: 1, durationMs: 1000 }],
    )
    expect(spans).toEqual([{ start: 0, end: 8, startMs: 0, endMs: 800 }])
  })
})

describe('parseAudioTimeline', () => {
  const stored = {
    version: 1, levelMs: 100, levels: [0, 40, 100], source: 'Kup mleko', timing: 'words',
    spans: [{ start: 0, end: 3, startMs: 0, endMs: 300 }],
  }

  it('keeps spans only for the transcript they index', () => {
    expect(parseAudioTimeline(JSON.stringify(stored), 'Kup mleko')?.spans).toHaveLength(1)
    const edited = parseAudioTimeline(stored, 'Kup mleko i chleb')
    expect(edited?.levels).toEqual([0, 40, 100])
    expect(edited?.spans).toEqual([])
  })

  it('rejects malformed data', () => {
    expect(parseAudioTimeline('{', 'x')).toBeNull()
    expect(parseAudioTimeline({ ...stored, levels: [101] }, 'Kup mleko')).toBeNull()
    expect(parseAudioTimeline({ ...stored, levels: [] }, 'Kup mleko')).toBeNull()
    expect(parseAudioTimeline({ ...stored, spans: [{ start: 0, end: 30, startMs: 0, endMs: 1 }] }, 'Kup mleko')).toBeNull()
  })
})

describe('timeForRanges', () => {
  const spans = [
    { start: 0, end: 10, startMs: 0, endMs: 1000 },
    { start: 11, end: 20, startMs: 1000, endMs: 2500 },
    { start: 21, end: 30, startMs: 2500, endMs: 4000 },
  ]

  it('covers every span a source range touches', () => {
    expect(timeForRanges(spans, [{ start: 12, end: 25 }])).toEqual({ startMs: 1000, endMs: 4000 })
    expect(timeForRanges(spans, [{ start: 0, end: 5 }, { start: 22, end: 23 }])).toEqual({ startMs: 0, endMs: 4000 })
  })

  it('returns null when nothing is timed', () => {
    expect(timeForRanges(spans, [{ start: 10, end: 11 }])).toBeNull()
    expect(timeForRanges([], [{ start: 0, end: 5 }])).toBeNull()
  })
})
