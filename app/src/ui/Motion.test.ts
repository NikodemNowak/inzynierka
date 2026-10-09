import { createElement, useLayoutEffect, useRef, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { AccessibilityInfo, Animated, AppState, Dimensions, Image, LayoutAnimation, StyleSheet, Text, View, type AppStateStatus } from 'react-native'
import { ProcessingIndicator, RevealText, SkeletonText } from './Motion'
jest.mock('../i18n/useI18n', () => ({ useI18n: () => ({ t: (pl: string) => pl }) }))
jest.mock('./Icon', () => ({ Icon: () => null }))
let mockDark = false
jest.mock('./theme', () => ({ type: { display: { fontSize: 28, lineHeight: 35, fontWeight: '700', letterSpacing: -0.65 }, body: { fontSize: 16, lineHeight: 25, fontWeight: '400' } }, useTheme: () => ({ colors: { accent: mockDark ? '#80B9F2' : '#286BC2', ink: '#172131', body: '#49576A' }, isDark: mockDark }) }))
type Capture = { callback: (base64: string) => void; width: number; height: number }
const mockCaptures: Capture[] = []
let mockCaptureMode: 'normal' | 'missing' | 'throw' = 'normal'
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const Svg = React.forwardRef<{ toDataURL?: (callback: (base64: string) => void) => void }, { children?: import('react').ReactNode; width: number; height: number }>((props, ref) => {
    React.useImperativeHandle(ref, () => mockCaptureMode === 'missing' ? {} : { toDataURL: (callback: (base64: string) => void) => {
      if (mockCaptureMode === 'throw') throw new Error('Native export unavailable')
      mockCaptures.push({ callback, width: props.width, height: props.height })
    } })
    return React.createElement('Svg', props, props.children)
  })
  return { __esModule: true, default: Svg, Defs: 'Defs', Filter: 'Filter', FeGaussianBlur: 'FeGaussianBlur', LinearGradient: 'LinearGradient', Stop: 'Stop', G: 'G', Path: 'Path', Text: 'SvgText', TSpan: 'TSpan', Mask: 'Mask', Rect: 'Rect' }
})
const states = new Set<(value: AppStateStatus) => void>()
const motions = new Set<(value: boolean) => void>()
const trees = new Set<ReactTestRenderer>()
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
const mount: typeof create = (...args) => { const tree = create(...args); trees.add(tree); return tree }
const textOf = (tree: ReactTestRenderer): string => tree.root.findAllByType(Text).filter(node => typeof node.props.children === 'string' && node.props.accessibilityElementsHidden !== true).map(node => node.props.children as string).join('')
const stateChanged = (value: AppStateStatus) => { AppState.currentState = value; for (const callback of states) callback(value) }
const motionChanged = (value: boolean) => { for (const callback of motions) callback(value) }
const layout = async (tree: ReactTestRenderer, text: string, width = 300) => {
  const node = tree.root.findAllByType(Text).find(item => typeof item.props.onTextLayout === 'function')
  expect(node).toBeDefined()
  await act(async () => {
    node!.props.onLayout({ nativeEvent: { layout: { width, height: 25 } } })
    node!.props.onTextLayout({ nativeEvent: { lines: [{ text, x: 0, y: 0, width: width - 10, height: 25, ascender: 18, descender: 4 }] } })
  })
  await measureWords(tree, [{ text, width: width - 10 }])
}
const measureWords = async (tree: ReactTestRenderer, rows: readonly { text: string; width: number }[]) => {
  const probes = tree.root.findAllByType(Text).filter(node => /^reveal-measure-/u.test(node.props.testID ?? ''))
  await act(async () => {
    for (const node of probes) {
      const row = Number(node.props.testID.split('-')[2])
      const text = node.props.children as string
      const width = rows[row].width * text.length / rows[row].text.length
      node.props.onTextLayout({ nativeEvent: { lines: [{ text, x: 0, y: 0, width, height: 25, ascender: 18, descender: 4 }] } })
    }
  })
}
const decodeRaster = async (tree: ReactTestRenderer) => {
  await act(async () => {
    for (const image of tree.root.findAllByType(Image)) if (typeof image.props.onLoad === 'function') image.props.onLoad()
  })
}
const animations: { start: jest.Mock; stop: jest.Mock; complete?: (value: { finished: boolean }) => void; duration: number }[] = []
let timing: jest.SpyInstance
beforeEach(() => {
  jest.useFakeTimers(); mockCaptures.length = 0; animations.length = 0; mockDark = false; mockCaptureMode = 'normal'; AppState.currentState = 'active'
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { states.add(callback); return { remove: () => { states.delete(callback) } } })
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
  const listener = (_event: string, callback: (value: boolean) => void) => { motions.add(callback); return { remove: () => { motions.delete(callback) } } }
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(listener as unknown as typeof AccessibilityInfo.addEventListener)
  timing = jest.spyOn(Animated, 'timing').mockImplementation((_value, options) => {
    const item = { start: jest.fn(), stop: jest.fn(), complete: undefined as ((value: { finished: boolean }) => void) | undefined, duration: options.duration ?? 0 }
    item.start.mockImplementation((callback?: (value: { finished: boolean }) => void) => { item.complete = callback }); animations.push(item)
    return { start: item.start, stop: item.stop, reset: jest.fn() }
  })
})
afterEach(async () => { await act(async () => { for (const tree of trees) tree.unmount() }); trees.clear(); states.clear(); motions.clear(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks() })

test('the pending result raster paints anonymous shapes instead of recognizable source words', async () => {
  const text = 'Sprawy na ten tydzień'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, style: { fontSize: 28, lineHeight: 35 } })) })
  await layout(tree!, text)
  const painted = tree!.root.findAll(node => String(node.type) === 'TSpan').map(node => String(node.props.children))
  expect(painted.length).toBeGreaterThan(0)
  expect(painted.join(' ')).not.toMatch(/Sprawy|tydzień|przygotowanie|ustalenia/u)
  expect(tree!.root.findByProps({ accessible: true }).props.accessibilityLabel).toBe(text)
})

test.each([false, true])('blurred waiting ink reaches transparency smoothly on all four frame edges (title=%s)', async title => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { title, lines: title ? 1 : 3, animate: false })) })
  const gradients = tree!.root.findAll(node => String(node.type) === 'LinearGradient' && /field[XY]$/u.test(node.props.id ?? ''))
  expect(gradients).toHaveLength(2)
  for (const gradient of gradients) {
    const stops = gradient.findAll(node => String(node.type) === 'Stop').map(node => ({ offset: node.props.offset as number, alpha: node.props.stopOpacity as number }))
    expect(stops[0]).toMatchObject({ offset: 0, alpha: 0 })
    expect(stops.at(-1)).toMatchObject({ offset: 1, alpha: 0 })
    expect(stops.filter(stop => stop.alpha > 0 && stop.alpha < 1).length).toBeGreaterThanOrEqual(4)
    expect(stops.some(stop => stop.alpha === 1)).toBe(true)
  }
})

// RNSVGRenderable 15.15.4 draws masked children with UIImage.drawInRect,
// which targets the current UIKit context rather than a parent's raw mask
// bitmap context. Such children leak their white mask paint onto the canvas.
const expectNativeMaskIsolation = (tree: ReactTestRenderer): void => {
  const masks = tree.root.findAll(node => String(node.type) === 'Mask')
  expect(masks.length).toBeGreaterThan(0)
  const leakedLayers = masks.flatMap(mask => mask.findAll(node => node !== mask && typeof node.props.mask === 'string'))
  expect(leakedLayers.map(node => node.props.mask)).toEqual([])
}

test.each([false, true])('iOS waiting masks never draw a masked child into the caller canvas (title=%s)', async title => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { title, lines: title ? 1 : 3, animate: false })) })
  expectNativeMaskIsolation(tree!)
})

test('iOS preparation and result raster masks never draw white layers into the caller canvas', async () => {
  const text = 'A neutral test result'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 2 })) })
  expectNativeMaskIsolation(tree!)
  await layout(tree!, text)
  expect(mockCaptures).toHaveLength(1)
  expectNativeMaskIsolation(tree!)
})

test('soft word bounds are applied before blur so the blur can round their rectangular cuts', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { lines: 1, animate: false })) })
  const blur = tree!.root.findAll(node => String(node.type) === 'G' && /soft\)$/u.test(node.props.filter ?? ''))[0]
  expect(blur).toBeDefined()
  expect(blur.findAll(node => String(node.type) === 'G' && /words\)$/u.test(node.props.mask ?? ''))).toHaveLength(1)
})

test('pending morph material breathes natively without recapture and stops when the screen leaves', async () => {
  const loop = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() }
  jest.spyOn(Animated, 'loop').mockReturnValue(loop)
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Sprawy na ten tydzień', animate: true, placeholderLines: 1 })) })
  const material = tree!.root.findAllByType(Animated.View).find(node => node.props.testID === 'reveal-waiting-material')
  expect(material).toBeDefined()
  expect(loop.start).toHaveBeenCalledTimes(1)
  expect(timing.mock.calls.filter(([, options]) => options.duration === 1900).every(([, options]) => options.useNativeDriver && options.isInteraction === false)).toBe(true)
  await layout(tree!, 'Sprawy na ten tydzień')
  expect(mockCaptures).toHaveLength(1)
  const pulse = timing.mock.calls.find(([, options]) => options.duration === 1900)![0] as Animated.Value
  await act(async () => { pulse.setValue(0.5) })
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Sprawy na ten tydzień', animate: true, placeholderLines: 1, active: false })) })
  expect(loop.stop).toHaveBeenCalled()
  expect(tree!.root.findAllByProps({ testID: 'reveal-waiting-material' })).toHaveLength(0)
  expect(textOf(tree!)).toBe('Sprawy na ten tydzień')
})

test('shrinking the layout never slices the morph halo while native literal letter layers retain their clips', async () => {
  const text = 'Krótki wynik'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 2, style: { fontSize: 14, lineHeight: 20 } })) })
  const owner = tree!.root.findAllByType(Text).find(node => typeof node.props.onTextLayout === 'function')!
  await act(async () => {
    owner.props.onLayout({ nativeEvent: { layout: { width: 300, height: 20 } } })
    owner.props.onTextLayout({ nativeEvent: { lines: [{ text, x: 0, y: 0, width: 120, height: 20, ascender: 14, descender: 3 }] } })
  })
  await measureWords(tree!, [{ text, width: 120 }])
  await act(async () => { mockCaptures[0].callback(png) }); await decodeRaster(tree!)
  const frame = StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-frame' }).props.style)
  expect(frame.height).toBe(20)
  expect(frame.overflow).toBe('visible')
  const row = tree!.root.findByProps({ testID: 'reveal-line-0' })
  expect(StyleSheet.flatten(row.props.style).overflow).toBe('hidden')
  const sharp = tree!.root.findByProps({ testID: 'reveal-line-0-sharp' })
  expect(StyleSheet.flatten(sharp.props.style).overflow).toBe('hidden')
  expect(tree!.root.findByProps({ accessible: true }).props.accessibilityLabel).toBe(text)
})

test('a longer placeholder contracts before any real letters are revealed', async () => {
  const text = 'Krótki wynik'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 3 })) })
  await layout(tree!, text, 300)
  await act(async () => { mockCaptures[0].callback(png) }); await decodeRaster(tree!)
  const morph = tree!.root.findAllByType(Animated.View).find(node => node.props.testID === 'reveal-morph-row-0')
  expect(morph).toBeDefined()
  const transform = StyleSheet.flatten(morph!.props.style).transform!
  const scale = (transform.find((value: object) => 'scaleX' in value) as { scaleX: { __getValue: () => number } }).scaleX
  const clock = timing.mock.calls.find(([, options]) => options.duration! >= 650 && options.delay !== undefined)![0] as Animated.Value
  await act(async () => { clock.setValue(0) }); const initial = scale.__getValue()
  await act(async () => { clock.setValue(0.05) })
  expect(scale.__getValue()).toBeLessThan(initial)
  const firstInk = tree!.root.findAllByType(Animated.View).find(node => node.props.testID === 'reveal-line-0-ink-8-front')!
  const position = (StyleSheet.flatten(firstInk.props.style).transform![0] as { translateX: { __getValue: () => number } }).translateX
  expect(position.__getValue()).toBe(-300)
  expect(tree!.root.findAllByType(Animated.View).some(node => node.props.testID === 'reveal-morph-row-2')).toBe(true)
})

test.each([1, 2])('three waiting rows contract to %s result rows with native layout before the letter sweep', async count => {
  const parts = Array.from({ length: count }, (_, index) => `Wynik ${index}. `)
  const text = parts.join(''); let tree: ReactTestRenderer
  const configure = jest.spyOn(LayoutAnimation, 'configureNext')
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 3 })) })
  const frame = () => StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-frame' }).props.style)
  expect(frame().height).toBe(75)
  const owner = tree!.root.findAllByType(Text).find(node => typeof node.props.onTextLayout === 'function')!
  await act(async () => {
    owner.props.onLayout({ nativeEvent: { layout: { width: 300, height: count * 25 } } })
    owner.props.onTextLayout({ nativeEvent: { lines: parts.map((part, index) => ({ text: part, x: 0, y: index * 25, width: 100, height: 25, ascender: 18, descender: 4 })) } })
  })
  await measureWords(tree!, parts.map(text => ({ text, width: 100 })))
  expect(frame().height).toBe(75)
  await act(async () => { mockCaptures[0].callback(png) }); await decodeRaster(tree!)
  expect(configure).toHaveBeenCalledWith({ duration: 320, update: { type: 'easeInEaseOut' } })
  expect(frame().height).toBe(count * 25)
  const clockCall = timing.mock.calls.find(([, options]) => options.duration! >= 650 && options.delay !== undefined)!
  const clock = clockCall[0] as Animated.Value
  await act(async () => { clock.setValue(320 / clockCall[1].duration!) })
  const first = StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-morph-row-0' }).props.style)
  const scale = (first.transform[2] as { scaleX: { __getValue: () => number } }).scaleX.__getValue()
  const shift = (first.transform[0] as { translateX: { __getValue: () => number } }).translateX.__getValue()
  expect(scale).toBeCloseTo(1 / 3)
  expect(shift + 300 * (1 - scale) / 2).toBeCloseTo(0)
  const surplus = StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-morph-row-2' }).props.style)
  expect(surplus.opacity.__getValue()).toBe(0)
  const blue = StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-line-0-ink-8-front' }).props.style)
  expect(blue.transform[0].translateX.__getValue()).toBe(-300)
  expect(tree!.root.findByProps({ accessible: true }).props.accessibilityLabel).toBe(text)
})

test('one short waiting row grows to three result rows without exposing the source during preparation', async () => {
  const parts = ['Pierwszy wynik. ', 'Drugi wynik. ', 'Trzeci wynik.']; const text = parts.join('')
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 1 })) })
  const owner = tree!.root.findAllByType(Text).find(node => typeof node.props.onTextLayout === 'function')!
  await act(async () => {
    owner.props.onLayout({ nativeEvent: { layout: { width: 300, height: 75 } } })
    owner.props.onTextLayout({ nativeEvent: { lines: parts.map((part, index) => ({ text: part, x: 0, y: index * 25, width: 290, height: 25, ascender: 18, descender: 4 })) } })
  })
  await measureWords(tree!, parts.map(text => ({ text, width: 290 })))
  expect(StyleSheet.flatten(owner.props.style).opacity).toBe(0)
  expect(StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-frame' }).props.style).height).toBe(25)
  await act(async () => { mockCaptures[0].callback(png) }); await decodeRaster(tree!)
  expect(StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-frame' }).props.style).height).toBe(75)
  const row = () => StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-morph-row-2' }).props.style)
  expect(row().opacity.__getValue()).toBe(0)
  const call = timing.mock.calls.find(([, options]) => options.duration! >= 650 && options.delay !== undefined)!
  await act(async () => { (call[0] as Animated.Value).setValue(160 / call[1].duration!) })
  expect(row().opacity.__getValue()).toBeCloseTo(0.5)
  expect(row().transform[2].scaleX.__getValue()).toBeGreaterThan(1)
  const blue = StyleSheet.flatten(tree!.root.findByProps({ testID: 'reveal-line-0-ink-8-front' }).props.style)
  expect(blue.transform[0].translateX.__getValue()).toBe(-300)
})

test('waiting for accessibility preferences never flashes the real title and Reduce Motion settles immediately', async () => {
  let resolve!: (reduced: boolean) => void
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementation(() => new Promise<boolean>(callback => { resolve = callback }))
  const text = 'Sprawy na ten tydzień'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, placeholderLines: 1, style: { fontSize: 28, lineHeight: 35 } })) })
  const owner = tree!.root.findAllByType(Text).find(node => typeof node.props.onTextLayout === 'function')!
  expect(StyleSheet.flatten(owner.props.style).opacity).toBe(0)
  expect(tree!.root.findAll(node => String(node.type) === 'TSpan').map(node => node.props.children).join(' ')).not.toMatch(/Sprawy|tydzień/u)
  await act(async () => { resolve(true) })
  expect(StyleSheet.flatten(owner.props.style).opacity).toBe(1)
  expect(tree!.root.findAllByProps({ testID: 'reveal-morph-row-0' })).toHaveLength(0)
  expect(animations).toHaveLength(0)
})

test('v34 reveals native letters with a continuous left-to-right mask while their positions stay fixed', async () => {
  const text = 'Zażółć gęślą jaźń'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  await layout(tree!, text)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const rows = tree!.root.findAllByType(Animated.View).filter(node => node.props.testID === 'reveal-line-0-sharp')
  expect(rows).toHaveLength(1)
  const moving = StyleSheet.flatten(rows[0].props.style).transform![0] as { translateX: { __getValue: () => number } }
  const content = rows[0].findAllByType(Animated.View).find(node => node.props.testID === 'reveal-line-0-sharp-content')!
  const cancelling = StyleSheet.flatten(content.props.style).transform![0] as { translateX: { __getValue: () => number } }
  const clock = timing.mock.calls.find(([, options]) => options.useNativeDriver === true && options.isInteraction === false)!
  const progress = clock[0] as Animated.Value
  await act(async () => { progress.setValue(0.25) })
  const first = moving.translateX.__getValue()
  expect(first).toBeLessThan(0)
  expect(first + cancelling.translateX.__getValue()).toBeCloseTo(0)
  await act(async () => { progress.setValue(0.5) })
  expect(moving.translateX.__getValue()).toBeGreaterThan(first)
  expect(moving.translateX.__getValue()).toBeLessThan(0)
  expect(moving.translateX.__getValue() + cancelling.translateX.__getValue()).toBeCloseTo(0)
  expect(textOf(tree!)).toBe(text)
})

test('v34 crossfades a failed preparation instead of instantly replacing its blurred lettering', async () => {
  const onRevealComplete = jest.fn(); let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Kompletny wynik', animate: true, onRevealComplete })) })
  await act(async () => { jest.advanceTimersByTime(950) })
  expect(onRevealComplete).not.toHaveBeenCalled()
  const fallback = animations.find(item => item.duration === 240 && item.start.mock.calls.length > 0)
  expect(fallback).toBeDefined()
  await act(async () => { fallback!.complete!({ finished: true }) })
  expect(onRevealComplete).toHaveBeenCalledTimes(1)
  expect(textOf(tree!)).toBe('Kompletny wynik')
})

test.each([false, true])('dictation-colored ink leaves the completed row fully ordinary (dark=%s)', async dark => {
  mockDark = dark
  const text = 'Nowy czytelny wynik'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  await layout(tree!, text)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const tint = tree!.root.findAllByType(Animated.View).find(node => node.props.testID === 'reveal-line-0-ink-0-rear')
  expect(tint).toBeDefined()
  expect(StyleSheet.flatten(tint!.findByType(Text).props.style).color).toBe(dark ? '#80B9F2' : '#286BC2')
  const edge = (StyleSheet.flatten(tint!.props.style).transform![0] as { translateX: { __getValue: () => number } }).translateX
  const clock = timing.mock.calls.find(([, options]) => options.duration! >= 650)![0] as Animated.Value
  await act(async () => { clock.setValue(0.55) })
  expect(edge.__getValue()).toBe(0)
  await act(async () => { clock.setValue(0.9) })
  expect(edge.__getValue()).toBeGreaterThan(0)
  expect(edge.__getValue()).toBeLessThan(292)
  await act(async () => { clock.setValue(1) })
  expect(edge.__getValue()).toBe(292)
  expect(textOf(tree!)).toBe(text)
})

test.each([false, true])('fresh blue ink trails the reveal while earlier letters settle before the row finishes (dark=%s)', async dark => {
  mockDark = dark
  const text = 'Litery wyłaniają się płynnie i po chwili odzyskują zwykły kolor. '.repeat(2)
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  await layout(tree!, text)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const bands = tree!.root.findAllByType(Animated.View).filter(node => /^reveal-line-0-ink-\d+-front$/u.test(node.props.testID ?? ''))
  expect(bands.length).toBeGreaterThan(3)
  const [clock, options] = timing.mock.calls.find(([, config]) => config.duration! >= 650)!
  await act(async () => { (clock as Animated.Value).setValue(1100 / options.duration!) })
  const geometry = bands.map(band => {
    const id = band.props.testID.replace(/-front$/u, '') as string
    const front = StyleSheet.flatten(band.props.style).transform![0] as { translateX: { __getValue: () => number } }
    const content = band.findAllByType(Animated.View).find(node => node.props.testID === `${id}-front-content`)!
    const rear = band.findAllByType(Animated.View).find(node => node.props.testID === `${id}-rear`)!
    const rearContent = band.findAllByType(Animated.View).find(node => node.props.testID === `${id}-rear-content`)!
    const offset = (node: typeof band) => (StyleSheet.flatten(node.props.style).transform![0] as { translateX: { __getValue: () => number } }).translateX.__getValue()
    expect(front.translateX.__getValue() + offset(content)).toBeCloseTo(0)
    expect(offset(rear) + offset(rearContent)).toBeCloseTo(0)
    expect(StyleSheet.flatten(band.findByType(Text).props.style).color).toBe(dark ? '#80B9F2' : '#286BC2')
    return { front: front.translateX.__getValue() + 300, rear: offset(rear) }
  })
  expect(Math.max(...geometry.map(value => value.front))).toBeLessThan(290)
  expect(geometry.every(value => value.rear > 0)).toBe(true)
  expect(geometry.some(value => value.front > value.rear)).toBe(true)
  expect(textOf(tree!)).toBe(text)
})

test('loading paints ordinary system typography beneath a word-gap mask, with no synthetic path alphabet', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { lines: 3 })) })
  expect(tree!.root.findAll(node => String(node.type) === 'SvgText').length).toBeGreaterThan(0)
  expect(tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur').length).toBeGreaterThan(0)
  expect(tree!.root.findAll(node => String(node.type) === 'Path')).toHaveLength(0)
  const mask = tree!.root.findAll(node => String(node.type) === 'Mask')[0]
  expect(mask.props.maskUnits).toBe('userSpaceOnUse')
  expect(mask.findAll(node => String(node.type) === 'Rect').length).toBeGreaterThan(0)
  expect(tree!.root.findAll(node => String(node.type) === 'Rect').every(node => {
    let parent = node.parent
    while (parent && String(parent.type) !== 'Mask') parent = parent.parent
    return parent !== null
  })).toBe(true)
  expect(tree!.root.findAll(node => node.props.accessibilityElementsHidden === true).length).toBeGreaterThan(0)
  expect(textOf(tree!)).toBe('')
})

test('loading has straight baselines and varied paragraph widths in the measured content area', async () => {
  for (const title of [false, true]) {
    let tree: ReactTestRenderer
    await act(async () => { tree = mount(createElement(SkeletonText, { title, lines: title ? 1 : 3, animate: false })) })
    const wrapper = tree!.root.findAllByType(View).find(node => typeof node.props.onLayout === 'function')!
    await act(async () => { wrapper.props.onLayout({ nativeEvent: { layout: { width: 358 } } }) })
    const ink = tree!.root.findAll(node => Array.isArray(node.props.softWords))[0]
    const words = ink.props.softWords as { baseline: number; x: number; width: number }[]
    const font = title ? 28 : 16
    const baselines = [...new Set(words.map(word => word.baseline))]
    expect(baselines).toEqual(title ? [28] : [16, 41, 66])
    const ends = baselines.map(baseline => Math.max(...words.filter(word => word.baseline === baseline).map(word => word.x + word.width)))
    expect(ends[0]).toBeGreaterThan(330)
    if (!title) {
      expect(ends[1]).toBeLessThan(ends[0] - 30)
      expect(ends[2]).toBeLessThan(ends[1] - 30)
    }
    const blur = tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')[0].props.stdDeviation as number[]
    expect(blur[0]).toBeGreaterThanOrEqual(font * 0.3)
    expect(blur[1]).toBeGreaterThanOrEqual(font * 0.18)
  }
})

test('result waiting typography scales its ordinary word silhouettes to actual content width', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Testy aplikacji', animate: true, style: { fontSize: 28, lineHeight: 35 } })) })
  const waiting = () => tree!.root.findAll(node => Array.isArray(node.props.softWords))[0]
  expect(waiting().props.softWords.length).toBeGreaterThan(0)
  const owner = tree!.root.findAllByType(Text).find(item => typeof item.props.onTextLayout === 'function')!
  await act(async () => { owner.props.onLayout({ nativeEvent: { layout: { width: 358 } } }) })
  expect(Math.max(...waiting().props.softWords.map((word: { x: number; width: number }) => word.x + word.width))).toBeGreaterThan(330)
  expect(tree!.root.findAll(node => String(node.type) === 'SvgText').length).toBeGreaterThan(0)
  expect(tree!.root.findAll(node => node.props.accessibilityLabel === 'Testy aplikacji').length).toBeGreaterThan(0)
})
test('loading caches one raster and pulses without a second offset image', async () => {
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() })
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { lines: 2 })) })
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  await act(async () => { jest.advanceTimersByTime(5000) })
  expect(mockCaptures).toHaveLength(1)
  expect(tree!.root.findAllByType(Image)).toHaveLength(1)
  expect(timing.mock.calls.every(([, options]) => options.useNativeDriver === true)).toBe(true)
  expect(loop).toHaveBeenCalled()
})
test('hidden loading mounts no Gaussian raster or capture while preserving its decorative height', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { lines: 2, active: false })) })
  const wrapper = () => tree!.root.findAllByType(View).find(node => typeof node.props.onLayout === 'function')!
  expect(StyleSheet.flatten(wrapper().props.style).height).toBe(50)
  expect(wrapper().props.accessibilityElementsHidden).toBe(true)
  expect(mockCaptures).toHaveLength(0)
  expect(tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')).toHaveLength(0)
  await act(async () => {
    mockDark = true
    tree!.update(createElement(SkeletonText, { lines: 3, title: true, active: false }))
    Dimensions.set({ window: { width: 320, height: 844, scale: 3, fontScale: 1.4 }, screen: { width: 320, height: 844, scale: 3, fontScale: 1.4 } })
  })
  await act(async () => { wrapper().props.onLayout({ nativeEvent: { layout: { width: 320 } } }); jest.advanceTimersByTime(1000) })
  expect(mockCaptures).toHaveLength(0)
  expect(tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')).toHaveLength(0)
  expect(StyleSheet.flatten(wrapper().props.style).height).toBeCloseTo(147)
  expect(textOf(tree!)).toBe('')
})
test('loading initially mounted in AppState background waits until foreground before capture', async () => {
  AppState.currentState = 'background'
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText)) })
  expect(mockCaptures).toHaveLength(0)
  expect(tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')).toHaveLength(0)
  await act(async () => { stateChanged('active') })
  expect(mockCaptures).toHaveLength(1)
})
test('hiding pending loading unmounts its raster and ignores the old callback after return', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText)) })
  const old = mockCaptures[0]
  await act(async () => { tree!.update(createElement(SkeletonText, { active: false })) })
  await act(async () => { old.callback(png) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')).toHaveLength(0)
  await act(async () => { tree!.update(createElement(SkeletonText)) })
  await act(async () => { old.callback(png) })
  expect(mockCaptures).toHaveLength(2)
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  await act(async () => { mockCaptures[1].callback(png) })
  expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0)
})
test('foreground loading reuses its retained bitmap after focus and AppState hiding', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { animate: false })) })
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const uri = tree!.root.findByType(Image).props.source.uri
  await act(async () => { tree!.update(createElement(SkeletonText, { animate: false, active: false })) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  await act(async () => { tree!.update(createElement(SkeletonText, { animate: false })) })
  expect(mockCaptures).toHaveLength(1)
  expect(tree!.root.findByType(Image).props.source.uri).toBe(uri)
  await act(async () => { stateChanged('background') })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  await act(async () => { stateChanged('active') })
  expect(mockCaptures).toHaveLength(1)
  expect(tree!.root.findByType(Image).props.source.uri).toBe(uri)
})
test('explicit focus, AppState and Reduce Motion stop decorative loops', async () => {
  const stop = jest.fn(); const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() })
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { active: false })) })
  expect(loop).not.toHaveBeenCalled()
  await act(async () => { tree!.update(createElement(SkeletonText, { active: true })) })
  expect(loop).toHaveBeenCalled()
  await act(async () => { stateChanged('background') })
  expect(stop).toHaveBeenCalled()
  await act(async () => { stateChanged('active'); motionChanged(true) })
  expect(tree!.toJSON()).not.toBeNull()
})
test('model loading is quiet and real stage labels stay immediate', async () => {
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() })
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(ProcessingIndicator, { stage: 'loading', label: 'Wczytuję model…' })) })
  expect(loop).not.toHaveBeenCalled(); expect(textOf(tree!)).toBe('Wczytuję model…')
  await act(async () => { tree!.update(createElement(ProcessingIndicator, { stage: 'processing', label: 'Analizuję zadania…' })) })
  expect(loop).toHaveBeenCalled(); expect(textOf(tree!)).toBe('Analizuję zadania…')
})
test('full native result and header accessibility exist before snapshot callback', async () => {
  const text = 'Łucja przygotuje wykres do 9 października.'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, accessibilityRole: 'header' })) })
  expect(textOf(tree!)).toBe(text)
  expect(tree!.root.findAll(node => node.props.accessibilityRole === 'header' && node.props.accessibilityLabel === text).length).toBeGreaterThan(0)
  await layout(tree!, text); expect(mockCaptures).toHaveLength(1)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  expect(animations.some(item => item.duration <= 1900 && item.start.mock.calls.length > 0)).toBe(true)
  expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0)
})

test('native preparation and bitmap decode have separate bounded stages before the word clock starts', async () => {
  const text = 'Anna przygotuje wyniki'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  await act(async () => { jest.advanceTimersByTime(650) })
  await layout(tree!, text)
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { jest.advanceTimersByTime(450); mockCaptures[0].callback(png) })
  expect(animations.some(item => item.start.mock.calls.length > 0)).toBe(false)
  const raster = tree!.root.findAllByType(Image).find(node => typeof node.props.onLoad === 'function')!
  expect(raster).toBeDefined()
  await act(async () => { raster.props.onLoad() })
  expect(animations.some(item => item.start.mock.calls.length > 0)).toBe(true)
  expect(textOf(tree!)).toBe(text)
})

test('the result owner is notified when finite preparation fails and keeps complete plaintext', async () => {
  const text = 'Cały gotowy wynik'; const onRevealComplete = jest.fn(); let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, onRevealComplete })) })
  await act(async () => { jest.advanceTimersByTime(1000) })
  await act(async () => { jest.advanceTimersByTime(350) })
  expect(onRevealComplete).toHaveBeenCalledTimes(1)
  expect(onRevealComplete).toHaveBeenCalledWith(text)
  expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
  expect(textOf(tree!)).toBe(text)
})

test('plain fallback reports completion after the parent publishes its pending result in layout effects', async () => {
  const Owner = ({ text }: { text: string }) => {
    const previous = useRef(text)
    const changed = previous.current !== text
    const [pending, setPending] = useState<string | null>(null)
    useLayoutEffect(() => {
      if (previous.current !== text) { previous.current = text; setPending(text) }
    }, [text])
    return createElement(View, null,
      createElement(Text, { testID: 'pending-owner' }, pending ?? 'settled'),
      createElement(RevealText, { text, animate: changed || pending === text, style: { fontStyle: 'italic' }, onRevealComplete: value => setPending(current => current === value ? null : current) }))
  }
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(Owner, { text: 'Stare pole' })) })
  await act(async () => { tree!.update(createElement(Owner, { text: 'Nowe gotowe pole' })) })
  expect(tree!.root.findByProps({ testID: 'pending-owner' }).props.children).toBe('settled')
  expect(mockCaptures).toHaveLength(0)
})

test('a prior completion cannot finish a new reveal when a title returns to the same literal text', async () => {
  let tree: ReactTestRenderer
  const completed = jest.fn()
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Tytuł pierwszy', animate: true, onRevealComplete: completed })) })
  await layout(tree!, 'Tytuł pierwszy')
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const first = animations.find(item => item.duration >= 650)!
  await act(async () => { first.complete!({ finished: true }) })
  expect(completed).toHaveBeenCalledTimes(1)
  completed.mockClear()
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Drugi tytuł', animate: true, onRevealComplete: completed })) })
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Tytuł pierwszy', animate: true, onRevealComplete: completed })) })
  expect(completed).not.toHaveBeenCalled()
  await layout(tree!, 'Tytuł pierwszy')
  await act(async () => { mockCaptures.at(-1)!.callback(png) })
  await decodeRaster(tree!)
  const latest = animations.at(-1)!
  await act(async () => { latest.complete!({ finished: true }) })
  expect(completed).toHaveBeenCalledTimes(1)
  expect(completed).toHaveBeenCalledWith('Tytuł pierwszy')
})

test('an old image error cannot finish a later reveal with the same source and geometry', async () => {
  const completed = jest.fn(); let tree: ReactTestRenderer
  const render = (text: string) => createElement(RevealText, { text, animate: true, onRevealComplete: completed })
  await act(async () => { tree = mount(render('Pierwszy tytuł')) })
  await layout(tree!, 'Pierwszy tytuł')
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const oldError = tree!.root.findAllByType(Image)[0].props.onError
  await act(async () => { animations.at(-1)!.complete!({ finished: true }) })
  completed.mockClear()
  await act(async () => { tree!.update(render('Drugi tytuł')) })
  await act(async () => { tree!.update(render('Pierwszy tytuł')) })
  await layout(tree!, 'Pierwszy tytuł')
  await act(async () => { mockCaptures.at(-1)!.callback(png) })
  await decodeRaster(tree!)
  await act(async () => { oldError({ nativeEvent: { error: 'Old decode failure' } }) })
  expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0)
  expect(completed).not.toHaveBeenCalled()
})
test('missing export, throw, empty PNG and missing callback fail safely to plain complete text', async () => {
  for (const mode of ['missing', 'throw', 'normal'] as const) {
    mockCaptureMode = mode; const text = `Pełny wynik ${mode}`; let tree: ReactTestRenderer
    await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) }); await layout(tree!, text)
    if (mode === 'normal') await act(async () => { mockCaptures[mockCaptures.length - 1].callback('') })
    await act(async () => { jest.advanceTimersByTime(1000) })
    expect(textOf(tree!)).toBe(text); expect(tree!.root.findAllByType(Image)).toHaveLength(0)
    await act(async () => { tree!.unmount() })
  }
  mockCaptureMode = 'normal'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Brak callbacku', animate: true })) }); await layout(tree!, 'Brak callbacku')
  const late = mockCaptures[mockCaptures.length - 1]
  await act(async () => { jest.advanceTimersByTime(1000); late.callback(png) })
  expect(textOf(tree!)).toBe('Brak callbacku'); expect(tree!.root.findAllByType(Image)).toHaveLength(0)
})
test('old-source and unmounted snapshot callbacks cannot publish stale images', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Pierwszy wynik', animate: true })) }); await layout(tree!, 'Pierwszy wynik')
  const old = mockCaptures[0]
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Nowy pełny wynik', animate: true })) }); await layout(tree!, 'Nowy pełny wynik')
  await act(async () => { old.callback(png) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0); expect(textOf(tree!)).toBe('Nowy pełny wynik')
  const current = mockCaptures[mockCaptures.length - 1]
  await act(async () => { tree!.unmount(); current.callback(png) }); expect(tree!.toJSON()).toBeNull()
})
test('false→true starts first reveal; hiding consumes it without replay', async () => {
  const text = 'Daniel ma przygotować tabelę'; let tree: ReactTestRenderer
  const render = (animate: boolean, active = true) => createElement(RevealText, { text, animate, active })
  await act(async () => { tree = mount(render(false)) }); await layout(tree!, text); expect(mockCaptures).toHaveLength(0)
  await act(async () => { tree!.update(render(true)) }); expect(mockCaptures).toHaveLength(0)
  await measureWords(tree!, [{ text, width: 290 }])
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const count = animations.length
  await act(async () => { tree!.update(render(true, false)) }); expect(animations.some(item => item.stop.mock.calls.length > 0)).toBe(true)
  await act(async () => { tree!.update(render(true)); motionChanged(true); motionChanged(false) })
  expect(mockCaptures).toHaveLength(1); expect(animations).toHaveLength(count); expect(textOf(tree!)).toBe(text)
})
test('theme replacement invalidates the pending bitmap without restarting old text', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Pełny wynik', animate: true })) }); await layout(tree!, 'Pełny wynik')
  const first = mockCaptures[0]; mockDark = true
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Pełny wynik', animate: true })); first.callback(png) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0); expect(textOf(tree!)).toBe('Pełny wynik')
})
test('giant source stays completely visible and causes no capture', async () => {
  const text = 'Łucja 🧪 '.repeat(500) + ' koniec'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  expect(textOf(tree!)).toBe(text); expect(mockCaptures).toHaveLength(0); expect(tree!.root.findAllByType(Text)).toHaveLength(1)
})
test('new Reduce Motion event wins over a stale pending initial preference', async () => {
  let resolve: ((value: boolean) => void) | undefined
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise(callback => { resolve = callback }))
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() })
  await act(async () => { mount(createElement(SkeletonText)) })
  await act(async () => { motionChanged(true); resolve!(false) }); expect(loop).not.toHaveBeenCalled()
})

test('image decode failure immediately releases the raster and shows full source', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Pełny wynik', animate: true })) }); await layout(tree!, 'Pełny wynik')
  await act(async () => { mockCaptures[0].callback(png) })
  const raster = tree!.root.findAllByType(Image)[0]
  expect(typeof raster.props.onError).toBe('function')
  await act(async () => { raster.props.onError({ nativeEvent: { error: 'Decode failure' } }) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
  expect(textOf(tree!)).toBe('Pełny wynik')
})

test('width replacement during native reveal stops it and never recaptures that old event', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Gotowy tekst', animate: true })) }); await layout(tree!, 'Gotowy tekst')
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  await layout(tree!, 'Gotowy tekst', 340)
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(animations.some(item => item.stop.mock.calls.length > 0)).toBe(true)
  expect(mockCaptures).toHaveLength(1)
  expect(textOf(tree!)).toBe('Gotowy tekst')
})

test('truncated text keeps native two-line layout and full AT; flex remains on wrapper', async () => {
  const text = 'Pełna treść zadania '.repeat(30); let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, numberOfLines: 2, style: { flex: 1, minWidth: 0, fontSize: 16, textDecorationLine: 'line-through' } })) })
  const owner = tree!.root.findAllByType(View).find(item => item.props.accessibilityLabel === text)
  expect(StyleSheet.flatten(owner!.props.style)).toMatchObject({ flex: 1, minWidth: 0 })
  const native = tree!.root.findByType(Text)
  expect(native.props.numberOfLines).toBe(2)
  expect(StyleSheet.flatten(native.props.style)).toMatchObject({ fontSize: 16, textDecorationLine: 'line-through' })
  expect(StyleSheet.flatten(native.props.style).flex).toBeUndefined()
  expect(mockCaptures).toHaveLength(0)
})

test('successful reveal releases all overlays and notifies the result owner after its finite native clock', async () => {
  let tree: ReactTestRenderer
  const onRevealComplete = jest.fn()
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Literalny wynik', animate: true, onRevealComplete })) }); await layout(tree!, 'Literalny wynik')
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const reveal = animations.find(item => item.duration >= 650)
  expect(reveal).toBeDefined()
  await act(async () => { reveal!.complete!({ finished: true }) })
  expect(onRevealComplete).toHaveBeenCalledTimes(1)
  expect(onRevealComplete).toHaveBeenCalledWith('Literalny wynik')
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(tree!.root.findAllByType(Text)).toHaveLength(1)
  const captures = mockCaptures.length
  await act(async () => { jest.advanceTimersByTime(5000) })
  expect(mockCaptures).toHaveLength(captures)
})

test('plain task decoration none and a non-truncated two-line limit still reveal the full task', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Alicja przygotuje wykres', animate: true, numberOfLines: 2, style: { textDecorationLine: 'none' } })) })
  await layout(tree!, 'Alicja przygotuje wykres')
  const uncapped = tree!.root.findAllByType(Text).find(node => node.props.accessibilityElementsHidden === true && typeof node.props.onTextLayout === 'function')
  await act(async () => { uncapped!.props.onTextLayout({ nativeEvent: { lines: [{ text: 'Alicja przygotuje wykres', x: 0, y: 0, width: 290, height: 25, ascender: 18, descender: 4 }] } }) })
  expect(mockCaptures).toHaveLength(0)
  await measureWords(tree!, [{ text: 'Alicja przygotuje wykres', width: 290 }])
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  expect(animations.some(item => item.duration >= 650 && item.duration <= 4200 && item.start.mock.calls.length > 0)).toBe(true)
})

test('processing status exposes true busy semantics, and padding encloses both text and overlay', async () => {
  let status: ReactTestRenderer
  await act(async () => { status = mount(createElement(ProcessingIndicator, { label: 'Opracowuję notatkę…' })) })
  const indicator = status!.root.findAllByType(View).find(item => item.props.accessibilityLabel === 'Opracowuję notatkę…')
  expect(indicator!.props.accessibilityRole).toBe('progressbar')
  expect(indicator!.props.accessibilityState).toEqual({ busy: true })
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Rzeczywisty tekst', animate: true, style: { padding: 12 } })) })
  const measured = tree!.root.findAllByType(Text).find(item => typeof item.props.onTextLayout === 'function')
  expect(measured!.parent!.props.accessibilityLabel).toBeUndefined()
  expect(StyleSheet.flatten(measured!.parent!.props.style)?.padding).toBeUndefined()
})

test('a normal 600-character summary uses one bounded raster and a finite letter sweep', async () => {
  const parts = Array.from({ length: 8 }, (_, index) => `Dosłowny wiersz ${index}: najważniejsze zdania pozostają w całości widoczne. `)
  const text = parts.join(''); let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  const measured = tree!.root.findAllByType(Text).find(item => typeof item.props.onTextLayout === 'function')
  await act(async () => {
    measured!.props.onLayout({ nativeEvent: { layout: { width: 390, height: 200 } } })
    measured!.props.onTextLayout({ nativeEvent: { lines: parts.map((part, index) => ({ text: part, x: 0, y: index * 25, width: 370, height: 25, ascender: 18, descender: 4 })) } })
  })
  await measureWords(tree!, parts.map(text => ({ text, width: 370 })))
  expect(mockCaptures).toHaveLength(1)
  expect(mockCaptures[0].height).toBe(216)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const focus = animations.find(item => item.start.mock.calls.length > 0)
  expect(focus!.duration).toBeGreaterThanOrEqual(950)
  expect(focus!.duration).toBeLessThanOrEqual(4200)
  expect(textOf(tree!)).toBe(text)
})

test('native letter masks cross each row in reading order with fixed clips and one native clock', async () => {
  let tree: ReactTestRenderer
  const text = 'Prawdziwy tekst\nKolejny wiersz'
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  const measured = tree!.root.findAllByType(Text).find(node => typeof node.props.onTextLayout === 'function')!
  await act(async () => {
    measured.props.onLayout({ nativeEvent: { layout: { width: 300, height: 50 } } })
    measured.props.onTextLayout({ nativeEvent: { lines: [
      { text: 'Prawdziwy tekst', x: 0, y: 0, width: 290, height: 25, ascender: 18, descender: 4 },
      { text: 'Kolejny wiersz', x: 0, y: 25, width: 280, height: 25, ascender: 18, descender: 4 },
    ] } })
  })
  await measureWords(tree!, [{ text: 'Prawdziwy tekst', width: 290 }, { text: 'Kolejny wiersz', width: 280 }])
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  const clock = timing.mock.calls.find(([, options]) => options.duration! >= 650)!
  expect(clock).toBeDefined()
  expect(clock[1]).toMatchObject({ useNativeDriver: true, isInteraction: false })
  const progress = clock[0] as Animated.Value
  const clips = () => tree!.root.findAllByType(View).filter(node => /^reveal-line-\d+$/u.test(node.props.testID ?? ''))
  expect(clips()).toHaveLength(2)
  const bounds = clips().map(node => StyleSheet.flatten(node.props.style))
  expect(bounds.map(style => style.top)).toEqual([0, 25])
  const sharpPosition = () => clips().map(node => {
    const layer = node.findAllByType(Animated.View).find(child => /-sharp$/u.test(child.props.testID ?? ''))!
    return (StyleSheet.flatten(layer.props.style).transform![0] as { translateX: { __getValue: () => number } }).translateX.__getValue()
  })
  expect(sharpPosition()).toEqual([-300, -300])
  await act(async () => { progress.setValue(0.2) })
  expect(sharpPosition()[0]).toBeGreaterThan(-300)
  expect(sharpPosition()[1]).toBe(-300)
  expect(clips().map(node => StyleSheet.flatten(node.props.style))).toEqual(bounds)
  await act(async () => { progress.setValue(1) })
  expect(sharpPosition()).toEqual([-8, -18])
  expect(clips().map(node => StyleSheet.flatten(node.props.style))).toEqual(bounds)
})

test('missing native word measurements cannot start a partial reveal', async () => {
  const text = 'Cały pełny wynik'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  const node = tree!.root.findAllByType(Text).find(item => typeof item.props.onLayout === 'function')!
  await act(async () => {
    node.props.onLayout({ nativeEvent: { layout: { width: 300, height: 25 } } })
    node.props.onTextLayout({ nativeEvent: { lines: [{ text, x: 0, y: 0, width: 290, height: 25, ascender: 18, descender: 4 }] } })
  })
  expect(mockCaptures).toHaveLength(0)
  expect(animations).toHaveLength(0)
  await act(async () => { jest.advanceTimersByTime(1000) })
  expect(textOf(tree!)).toBe(text)
  expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(tree!.root.findAllByType(Text).filter(node => /^reveal-measure-/u.test(node.props.testID ?? ''))).toHaveLength(0)
})

test('invalid or stale native prefix measurements release complete text and never publish the old word masks', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Stary wynik', animate: true })) })
  const measured = tree!.root.findAllByType(Text).find(item => typeof item.props.onLayout === 'function')!
  await act(async () => {
    measured.props.onLayout({ nativeEvent: { layout: { width: 300, height: 25 } } })
    measured.props.onTextLayout({ nativeEvent: { lines: [{ text: 'Stary wynik', x: 0, y: 0, width: 290, height: 25, ascender: 18, descender: 4 }] } })
  })
  const old = tree!.root.findAllByType(Text).find(node => /^reveal-measure-/u.test(node.props.testID ?? ''))!
  const callback = old.props.onTextLayout
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Nowy wynik', animate: true })) })
  await layout(tree!, 'Nowy wynik')
  await act(async () => { callback({ nativeEvent: { lines: [] } }); mockCaptures.at(-1)!.callback(png) })
  await decodeRaster(tree!)
  expect(tree!.root.findAllByType(View).filter(node => /^reveal-line-\d+$/u.test(node.props.testID ?? ''))).toHaveLength(1)
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Trzeci wynik', animate: true })) })
  const native = tree!.root.findAllByType(Text).find(item => typeof item.props.onLayout === 'function')!
  await act(async () => {
    native.props.onTextLayout({ nativeEvent: { lines: [{ text: 'Trzeci wynik', x: 0, y: 0, width: 290, height: 25, ascender: 18, descender: 4 }] } })
  })
  const invalid = tree!.root.findAllByType(Text).find(node => /^reveal-measure-/u.test(node.props.testID ?? ''))!
  await act(async () => { invalid.props.onTextLayout({ nativeEvent: { lines: [] } }) })
  expect(textOf(tree!)).toBe('Trzeci wynik')
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
})

test('result bitmap paints anonymous typography within native ink bounds, while VoiceOver gets one complete source', async () => {
  const text = 'Ostateczny budżet to 180 zł.'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, style: { fontSize: 16 } })) })
  await layout(tree!, text)
  const blur = tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')[0]
  expect(blur.props.stdDeviation[1]).toBeGreaterThanOrEqual(16 * 0.18)
  const words = tree!.root.findAll(node => String(node.type) === 'TSpan')
  expect(words.map(word => word.props.children).join(' ')).not.toMatch(/Ostateczny|budżet|180|zł/u)
  const ink = tree!.root.findAll(node => Array.isArray(node.props.softWords))[0]
  expect(ink.props.softWords).toHaveLength(5)
  expect(mockCaptures).toHaveLength(1)
  await act(async () => { mockCaptures[0].callback(png) })
  expect(tree!.root.findAllByType(View).find(node => node.props.accessibilityLabel === text)?.props.accessible).toBe(true)
  expect(mockCaptures).toHaveLength(1)
})

test('the tiny title word loses its source glyph while sharp native text and accessible source remain complete', async () => {
  const text = 'Testy i wyniki'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, style: { fontSize: 28, lineHeight: 35 } })) })
  await layout(tree!, text)
  const words = tree!.root.findAll(node => String(node.type) === 'TSpan').map(node => node.props.children)
  expect(words).toHaveLength(3)
  expect(words).not.toContain('Testy')
  expect(words).not.toContain('wyniki')
  expect(words).not.toContain('i')
  const filters = tree!.root.findAll(node => String(node.type) === 'FeGaussianBlur')
  expect(filters[1].props.stdDeviation[1]).toBeGreaterThan(filters[0].props.stdDeviation[1])
  expect(textOf(tree!)).toBe(text)
  expect(tree!.root.findAllByType(View).find(node => node.props.accessibilityLabel === text)?.props.accessible).toBe(true)
  await act(async () => { mockCaptures[0].callback(png); jest.advanceTimersByTime(2000) })
  expect(textOf(tree!)).toBe(text)
  expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
})

test('font-scale replacement and Reduce Motion invalidate pending exports without replay', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Pełny tekst', animate: true })) }); await layout(tree!, 'Pełny tekst')
  const first = mockCaptures[0]
  await act(async () => { Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1.4 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1.4 } }) })
  await act(async () => { first.callback(png) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(textOf(tree!)).toBe('Pełny tekst')
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Nowa treść', animate: true })) }); await layout(tree!, 'Nowa treść')
  const second = mockCaptures[mockCaptures.length - 1]
  await act(async () => { motionChanged(true); second.callback(png) })
  expect(tree!.root.findAllByType(Image)).toHaveLength(0)
  expect(textOf(tree!)).toBe('Nowa treść')
})

test('title loading uses the actual display typography scale, not a smaller unrelated font', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(SkeletonText, { title: true, lines: 1, animate: false })) })
  const ink = tree!.root.findAll(node => Array.isArray(node.props.softWords))[0]
  expect(ink.props.typography.fontSize).toBe(28)
  const type = tree!.root.findAll(node => String(node.type) === 'SvgText')[0]
  expect(type.props.fontWeight).toBe('700')
  expect(mockCaptures[0].height).toBe(51)
})

test('italic and transformed typography fall back rather than use mismatched SVG metrics', async () => {
  for (const style of [{ fontStyle: 'italic' as const }, { transform: [{ scaleX: 1.2 }] }, { fontVariant: ['small-caps' as const] }, { textTransform: 'uppercase' as const }]) {
    let tree: ReactTestRenderer
    await act(async () => { tree = mount(createElement(RevealText, { text: 'Pełne źródło', animate: true, style })) })
    expect(textOf(tree!)).toBe('Pełne źródło')
    expect(StyleSheet.flatten(tree!.root.findAllByType(Text)[0].props.style).opacity).toBe(1)
    expect(mockCaptures).toHaveLength(0)
    await act(async () => { tree!.unmount() })
  }
})

test('capped native character ranges alone cannot authorize an uncapped sharp layer', async () => {
  const text = 'Długi tekst naprawdę zajmuje trzy wiersze'; let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true, numberOfLines: 2 })) })
  await layout(tree!, text)
  expect(mockCaptures).toHaveLength(0)
  const uncapped = tree!.root.findAllByType(Text).find(node => node.props.accessibilityElementsHidden === true && typeof node.props.onTextLayout === 'function')
  expect(uncapped).toBeDefined()
  await act(async () => { uncapped!.props.onTextLayout({ nativeEvent: { lines: ['Długi tekst ', 'naprawdę zajmuje ', 'trzy wiersze'].map((part, index) => ({ text: part, x: 0, y: index * 25, width: 280, height: 25, ascender: 18, descender: 4 })) } }) })
  await act(async () => { jest.advanceTimersByTime(500) })
  expect(mockCaptures).toHaveLength(0)
  expect(textOf(tree!)).toBe(text)
  expect(tree!.root.findAllByType(Text)[0].props.numberOfLines).toBe(2)
})

test('a late old-image error cannot cancel the new source reveal', async () => {
  let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text: 'Stary wynik', animate: true })) }); await layout(tree!, 'Stary wynik')
  await act(async () => { mockCaptures[0].callback(png) })
  const oldError = tree!.root.findAllByType(Image)[0].props.onError
  await act(async () => { tree!.update(createElement(RevealText, { text: 'Nowy wynik', animate: true })) }); await layout(tree!, 'Nowy wynik')
  await act(async () => { mockCaptures[mockCaptures.length - 1].callback(png) })
  await act(async () => { oldError({ nativeEvent: { error: 'Old decode error' } }) })
  expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0)
  expect(textOf(tree!)).toBe('Nowy wynik')
})
test('an eleven-line summary reveals every original word inside one complete bounded raster', async () => {
  const parts = Array.from({ length: 11 }, (_, index) => `Wiersz ${index}: dosłowne źródłowe informacje. `)
  const text = parts.join(''); let tree: ReactTestRenderer
  await act(async () => { tree = mount(createElement(RevealText, { text, animate: true })) })
  const measured = tree!.root.findAllByType(Text).find(item => typeof item.props.onTextLayout === 'function')
  await act(async () => {
    measured!.props.onLayout({ nativeEvent: { layout: { width: 390, height: 275 } } })
    measured!.props.onTextLayout({ nativeEvent: { lines: parts.map((part, index) => ({ text: part, x: 0, y: index * 25, width: 370, height: 25, ascender: 18, descender: 4 })) } })
  })
  await measureWords(tree!, parts.map(text => ({ text, width: 370 })))
  expect(mockCaptures).toHaveLength(1)
  expect(mockCaptures[0].height).toBe(291)
  const softWords = tree!.root.findAll(node => Array.isArray(node.props.softWords))[0].props.softWords as { y: number; height: number; text: string }[]
  expect(Math.max(...softWords.map(word => word.y + word.height))).toBe(275)
  expect(softWords.some(word => word.y === 250)).toBe(true)
  expect(softWords.map(word => word.text).join(' ')).not.toMatch(/Wiersz|dosłowne|źródłowe|informacje/u)
  expect(tree!.root.findAllByType(View).some(node => {
    const style = StyleSheet.flatten(node.props.style)
    return style?.width === 390 && style?.height === 275 && style?.overflow === 'hidden'
  })).toBe(true)
  await act(async () => { mockCaptures[0].callback(png) })
  await decodeRaster(tree!)
  expect(tree!.root.findAllByType(View).filter(node => node.props.testID === 'reveal-line-10')).toHaveLength(1)
  expect(textOf(tree!)).toBe(text)
})
