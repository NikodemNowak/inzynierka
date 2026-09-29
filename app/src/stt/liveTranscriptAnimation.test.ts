import {
  buildTranscriptFrame,
  getTranscriptLetterAlpha,
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

  it('bounds the animated tail and fully reveals its last letter by the deadline', () => {
    const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN'
    const frame = buildTranscriptFrame('', new Map(), text, 500)
    const lastLetter = frame.tail[31]

    expect(Array.from(frame.prefix)).toHaveLength(8)
    expect(frame.tail).toHaveLength(32)
    expect(lastLetter.startedAt).toBe(500 + 31 * 12)
    expect(
      getTranscriptLetterAlpha(lastLetter, lastLetter.startedAt! + 169),
    ).toBeLessThan(1)
    expect(
      getTranscriptLetterAlpha(lastLetter, lastLetter.startedAt! + 170),
    ).toBe(1)
  })
})
