import {
  buildTranscriptFrame,
  getTranscriptColorProgress,
  interpolateTranscriptColor,
  LETTER_SECONDARY_MS,
  transcriptSettleTime,
  type TranscriptLetter,
} from './liveTranscriptAnimation'

describe('live transcript reveal timing', () => {
  it('keeps times for unchanged letters and staggers only the new suffix', () => {
    const previousTail = new Map<number, TranscriptLetter>([
      [0, { index: 0, character: 'G', startedAt: 40 }],
      [1, { index: 1, character: 'o', startedAt: 52 }],
    ])

    const frame = buildTranscriptFrame('Go', previousTail, 'Gone', 1000)

    expect(frame.tail).toEqual([
      { index: 0, character: 'G', startedAt: 40 },
      { index: 1, character: 'o', startedAt: 52 },
      { index: 2, character: 'n', startedAt: 1000 },
      { index: 3, character: 'e', startedAt: 1012 },
    ])
  })

  it('starts a revised tail from now while preserving its common prefix', () => {
    const previousText = 'hello old'
    const previousTail = new Map<number, TranscriptLetter>(
      Array.from(previousText).map((character, index) => [
        index,
        { index, character, startedAt: 200 + index * 10 },
      ]),
    )

    const frame = buildTranscriptFrame(
      previousText,
      previousTail,
      'hello new',
      900,
    )

    expect(frame.tail.slice(0, 6).map((letter) => letter.startedAt)).toEqual([
      200, 210, 220, 230, 240, 250,
    ])
    expect(frame.tail.slice(6)).toEqual([
      { index: 6, character: 'n', startedAt: 900 },
      { index: 7, character: 'e', startedAt: 912 },
      { index: 8, character: 'w', startedAt: 924 },
    ])
  })

  it('bounds the animated tail to 32 letters', () => {
    const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN'
    const frame = buildTranscriptFrame('', new Map(), text, 500)

    expect(Array.from(frame.prefix)).toHaveLength(8)
    expect(frame.tail).toHaveLength(32)
    expect(frame.tail[31].startedAt).toBe(500 + 31 * 12)
  })
})

describe('live transcript color transition', () => {
  it('blends fresh blue letters smoothly into their normal text color', () => {
    expect(interpolateTranscriptColor('#286BC2', '#172131', 0)).toBe('#286bc2')
    expect(interpolateTranscriptColor('#286BC2', '#172131', 0.5)).toBe(
      '#20467a',
    )
    expect(interpolateTranscriptColor('#286BC2', '#172131', 1)).toBe('#172131')
  })

  it('clamps progress and falls back to the normal color for invalid input', () => {
    expect(interpolateTranscriptColor('#286BC2', '#172131', -1)).toBe('#286bc2')
    expect(interpolateTranscriptColor('#286BC2', '#172131', 2)).toBe('#172131')
    expect(interpolateTranscriptColor('invalid', '#172131', 0)).toBe('#172131')
  })

  it('keeps new letters secondary for 300 ms, then switches in one step', () => {
    const letter: TranscriptLetter = {
      index: 0,
      character: 'ą',
      startedAt: 100,
    }

    expect(LETTER_SECONDARY_MS).toBe(300)
    expect(getTranscriptColorProgress(letter, 100)).toBe(0)
    expect(getTranscriptColorProgress(letter, 399)).toBe(0)
    expect(getTranscriptColorProgress(letter, 400)).toBe(1)
    expect(
      getTranscriptColorProgress({ ...letter, startedAt: null }, 100),
    ).toBe(1)
  })

  it('settles once, 300 ms after the newest letter, with no fade loop', () => {
    const tail: TranscriptLetter[] = [
      { index: 0, character: 'a', startedAt: null },
      { index: 1, character: 'b', startedAt: 100 },
      { index: 2, character: 'c', startedAt: 112 },
    ]
    expect(transcriptSettleTime(tail)).toBe(412)
    expect(transcriptSettleTime([tail[0]])).toBeNull()
  })
})
