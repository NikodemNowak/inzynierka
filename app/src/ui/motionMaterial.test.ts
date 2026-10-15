import { buildRevealLayout, buildWordRevealPlan, buildWordRevealRects, buildSoftWords, softTextBlur, softInkEdgeStops, waitingInkKeyframes, motionPalette, skeletonLineCount, skeletonTextRows, textRevealEligible, wordRevealTiming, focusRevealTiming, focusMorphDuration, focusInkBands } from './motionMaterial'
import { LETTER_FADE_MS, LETTER_BLUE_HOLD_MS, LETTER_COLOR_SETTLE_MS } from '../stt/liveTranscriptAnimation'
const line = (text: string, y = 0) => ({ text, x: 0, y, width: 260, height: 25, ascender: 18, descender: 4 })

test.each([false, true])('ink feather stays finite, ordered, transparent at both sides and visible inside (vertical=%s)', vertical => {
  for (const width of [1, 8, 25, 300, 600, NaN]) for (const font of [14, 28, 48, NaN]) {
    const stops = softInkEdgeStops(width, font, vertical)
    expect(stops[0]).toEqual({ offset: 0, opacity: 0 })
    expect(stops.at(-1)).toEqual({ offset: 1, opacity: 0 })
    expect(stops.every(stop => Number.isFinite(stop.offset) && stop.offset >= 0 && stop.offset <= 1 && stop.opacity >= 0 && stop.opacity <= 1)).toBe(true)
    expect(stops.every((stop, index) => index === 0 || stop.offset > stops[index - 1].offset)).toBe(true)
    expect(stops.some(stop => stop.opacity === 1)).toBe(true)
    expect(stops.filter(stop => stop.opacity > 0 && stop.opacity < 1)).toHaveLength(4)
  }
})

test('waiting brightness has quiet staggered peaks with equal loop endpoints', () => {
  for (let row = 0; row < 6; row++) {
    const frame = waitingInkKeyframes(row)
    expect(frame.outputRange[0]).toBe(frame.outputRange.at(-1))
    expect(frame.outputRange.every(alpha => alpha >= 0.76 && alpha <= 0.95)).toBe(true)
  }
  expect(waitingInkKeyframes(0).outputRange).not.toEqual(waitingInkKeyframes(1).outputRange)
})

test('shape preparation precedes every real row and shares the bounded native clock', () => {
  for (const count of [1, 3, 11]) {
    const parts = Array.from({ length: count }, (_, index) => `Wynik ${index}. `)
    const layout = buildRevealLayout(parts.join(''), parts.map((text, index) => line(text, index * 25)), 300)!
    const first = focusRevealTiming(0, layout, true), last = focusRevealTiming(count - 1, layout, true)
    expect(first.start * first.duration).toBeCloseTo(focusMorphDuration)
    expect(last.duration).toBeLessThanOrEqual(4200)
    expect(last.settled).toBeCloseTo(1)
    expect((last.settled - last.end) * last.duration).toBeCloseTo(LETTER_COLOR_SETTLE_MS)
    expect(first.start).toBeLessThan(first.end)
  }
})

test('fresh focus ink shares the dictation lifetime and bounds native paint work at every supported line count', () => {
  for (let count = 1; count <= 32; count++) {
    const bands = focusInkBands(count)
    expect(count * bands.length).toBeLessThanOrEqual(128)
    const opacityAtAge = (age: number) => 1 - bands.filter(band => age >= band.fromAge && age < band.toAge).reduce((remaining, band) => remaining * (1 - band.opacity), 1)
    expect(opacityAtAge(0)).toBeCloseTo(0.12)
    expect(opacityAtAge(LETTER_FADE_MS)).toBeCloseTo(1)
    expect(opacityAtAge(LETTER_BLUE_HOLD_MS)).toBeCloseTo(1)
    expect(opacityAtAge(LETTER_COLOR_SETTLE_MS - 1)).toBeGreaterThan(0)
    expect(opacityAtAge(LETTER_COLOR_SETTLE_MS - 1)).toBeLessThan(0.51)
    expect(opacityAtAge(LETTER_COLOR_SETTLE_MS)).toBe(0)
  }
})

test('the last focus row allows fresh blue ink to settle before its finite native clock ends', () => {
  const layout = buildRevealLayout('Nowe litery.\nKolejny wiersz.', [line('Nowe litery.'), line('Kolejny wiersz.', 25)], 300)!
  const first = focusRevealTiming(0, layout), last = focusRevealTiming(1, layout)
  expect(first.end).toBe(last.start)
  expect((last.settled - last.end) * last.duration).toBeCloseTo(LETTER_COLOR_SETTLE_MS)
  expect(last.settled).toBeCloseTo(1)
  expect(last.duration).toBeLessThanOrEqual(4200)
})
test('uses bounded neutral paragraphs with ordinary word lengths and spaces', () => {
  const rows = skeletonTextRows(3, false)
  expect(rows).toHaveLength(3)
  expect(rows.every(row => /[a-ząćęłńóśźż]/iu.test(row))).toBe(true)
  expect(rows.join(' ')).not.toMatch(/Daniel|Norah|120|150|\p{Private_Use}/u)
  expect(skeletonTextRows(100, true)).toHaveLength(6)
  expect(skeletonLineCount(NaN)).toBe(3)
})
test('allows ordinary Polish summaries and bounds giant Unicode raster work', () => {
  expect(textRevealEligible('Łucja przygotuje prezentację. '.repeat(20))).toBe(true)
  expect(textRevealEligible('🧪'.repeat(1201))).toBe(false)
  expect(textRevealEligible('')).toBe(false)
})
test('native geometry preserves literal Polish words and exact line baselines', () => {
  const layout = buildRevealLayout('Łucja przygotuje slajdy.\nBudżet to 120 zł.', [line('Łucja przygotuje slajdy.'), line('Budżet to 120 zł.', 25)], 300)
  expect(layout?.lines.map(item => item.text)).toEqual(['Łucja przygotuje slajdy.', 'Budżet to 120 zł.'])
  expect(layout?.lines.map(item => item.baseline)).toEqual([18, 43])
  expect(layout?.height).toBe(50)
  expect(Object.isFrozen(layout?.lines[0])).toBe(true)
})
test('rejects changed content, invalid metrics and oversized surfaces', () => {
  expect(buildRevealLayout('Pełna treść', [line('Inna treść')], 300)).toBeNull()
  expect(buildRevealLayout('Treść', [{ ...line('Treść'), ascender: NaN }], 300)).toBeNull()
  expect(buildRevealLayout('Treść', [line('Treść')], 5000)).toBeNull()
  expect(buildRevealLayout('Treść', [{ ...line('Treść'), height: 5000 }], 300)).toBeNull()
  expect(buildRevealLayout('Treść', [], 300)).toBeNull()
  expect(buildRevealLayout('Treść', [{ ...line('Treść'), x: 10000 }], 300)).toBeNull()
})
test('word order preserves Polish, English, punctuation, repeated spaces and explicit line breaks', () => {
  const source = 'Łucja  zrobi slajdy.\nDon’t re-buy: 180 zł.'
  const layout = buildRevealLayout(source, [line('Łucja  zrobi slajdy.'), line('Don’t re-buy: 180 zł.', 25)], 300)!
  const plan = buildWordRevealPlan(layout)!
  expect(plan.words.map(word => word.text)).toEqual(['Łucja', 'zrobi', 'slajdy.', 'Don’t', 're-buy:', '180', 'zł.'])
  expect(plan.words.map(word => word.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(plan.probes.some(probe => probe.text === 'Łucja  ')).toBe(true)
  expect(plan.words.map(word => word.y)).toEqual([0, 0, 0, 25, 25, 25, 25])
})
test('a word wrapped by native layout focuses once across its two line fragments', () => {
  const layout = buildRevealLayout('przygotowanie jutro', [line('przygoto'), line('wanie jutro', 25)], 300)!
  const plan = buildWordRevealPlan(layout)!
  expect(plan.words.map(word => [word.text, word.order])).toEqual([['przygoto', 0], ['wanie', 0], ['jutro', 1]])
  expect(plan.count).toBe(2)
})
test('word masks use native prefix widths and divide spaces without moving the source', () => {
  const layout = buildRevealLayout('Więcej  informacji.', [{ ...line('Więcej  informacji.'), width: 190 }], 300)!
  const plan = buildWordRevealPlan(layout)!
  const measured = Object.fromEntries(plan.probes.map(probe => [probe.key, ({ 'Więcej': 55, 'Więcej  ': 69, 'Więcej  informacji.': 190 } as Record<string, number>)[probe.text]]))
  expect(buildWordRevealRects(plan, measured)?.map(rect => [rect.left, rect.width, rect.y, rect.height])).toEqual([[0, 62, 0, 25], [62, 238, 0, 25]])
  expect(buildWordRevealRects(plan, measured)?.map(rect => [rect.inkLeft, rect.inkWidth, rect.baseline])).toEqual([[0, 55, 18], [69, 121, 18]])
  expect(buildWordRevealRects(plan, {})).toBeNull()
  expect(buildWordRevealRects(plan, { ...measured, [plan.probes.at(-1)!.key]: 220 })).toBeNull()
  expect(buildWordRevealRects(plan, Object.fromEntries(plan.probes.map(probe => [probe.key, NaN])))).toBeNull()
})

test('soft typography uses anonymous words and preserves empty spaces between native ink bounds', () => {
  const plan = buildWordRevealPlan(buildRevealLayout('Więcej  informacji.', [{ ...line('Więcej  informacji.'), width: 190 }], 300)!)!
  const measured = Object.fromEntries(plan.probes.map(probe => [probe.key, ({ 'Więcej': 55, 'Więcej  ': 69, 'Więcej  informacji.': 190 } as Record<string, number>)[probe.text]]))
  const words = buildWordRevealRects(plan, measured)!
  const soft = buildSoftWords(words)
  expect(soft.map(word => [word.x, word.width, word.baseline])).toEqual([[0, 55, 18], [69, 121, 18]])
  expect(soft.map(word => word.text).join(' ')).not.toMatch(/Więcej|informacji/u)
  expect(buildSoftWords(words.map(word => ({ ...word, text: 'Secret identity' })))).toEqual(soft)
  expect(soft[0].x + soft[0].width).toBeLessThan(soft[1].x)
  expect(softTextBlur(16)[0]).toBeGreaterThanOrEqual(16 * 0.3)
  expect(softTextBlur(16)[1]).toBeGreaterThanOrEqual(16 * 0.18)
})

test('invalid native ink bounds cannot paint a stale soft word', () => {
  const plan = buildWordRevealPlan(buildRevealLayout('Tekst', [line('Tekst')], 300)!)!
  const word = buildWordRevealRects(plan, Object.fromEntries(plan.probes.map(probe => [probe.key, probe.expectedWidth ?? 290])))![0]
  expect(buildSoftWords([{ ...word, inkWidth: NaN }])).toEqual([])
  expect(buildSoftWords([{ ...word, inkWidth: 0 }])).toEqual([])
  expect(buildSoftWords([{ ...word, y: -1 }])).toEqual([])
})
test('word focus overlaps gently in reading order and has a bounded total duration', () => {
  const first = wordRevealTiming(0, 7), last = wordRevealTiming(6, 7)
  expect(first.start).toBe(0)
  expect(first.end).toBeLessThan(last.start)
  expect(last.end).toBe(1)
  expect(wordRevealTiming(0, 1)).toMatchObject({ start: 0, end: 1 })
  expect(last.duration).toBeLessThanOrEqual(1800)
})
test('oversized word counts and RTL content use complete native plaintext', () => {
  const many = 'a '.repeat(100)
  expect(buildWordRevealPlan(buildRevealLayout(many, [line(many)], 300)!)).toBeNull()
  expect(buildWordRevealPlan(buildRevealLayout('مرحبا', [line('مرحبا')], 300)!)).toBeNull()
})
test('uses theme blue with quiet violet, without coral/cyan stops', () => {
  expect(motionPalette(false, '#286BC2')).toEqual(['#8273CE', '#286BC2', '#AAA3DB'])
  expect(motionPalette(true, '#80B9F2')).toEqual(['#A39CE8', '#80B9F2', '#C4BEF2'])
})
test('ordinary multiline summaries reveal their complete source rather than an eight-line prefix', () => {
  const parts = Array.from({ length: 11 }, (_, index) => `Pełny wiersz ${index}. `)
  const layout = buildRevealLayout(parts.join(''), parts.map((part, index) => line(part, index * 25)), 300)
  expect(layout?.source).toBe(parts.join(''))
  expect(layout?.lines).toHaveLength(11)
  expect(layout?.height).toBe(275)
  expect(layout?.totalHeight).toBe(275)
  expect(layout?.measuredLines).toBe(11)
  expect(layout?.lines.map(item => item.text).join('')).toBe(parts.join(''))
  expect(buildWordRevealPlan(layout!)?.words.at(-1)?.text).toBe('10.')
})

test('a source taller than the complete raster budget stays plain instead of revealing only its prefix', () => {
  const parts = Array.from({ length: 16 }, (_, index) => `Wiersz ${index}. `)
  expect(buildRevealLayout(parts.join(''), parts.map((part, index) => line(part, index * 25)), 300)).toBeNull()
})
