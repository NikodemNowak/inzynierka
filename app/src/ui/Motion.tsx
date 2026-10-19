import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Image, LayoutAnimation, StyleSheet, Text, View, useWindowDimensions, type AccessibilityRole, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Svg, { Defs, FeGaussianBlur, Filter, G, LinearGradient, Mask, Rect, Stop, Text as SvgText, TSpan } from 'react-native-svg'
import { useI18n } from '../i18n/useI18n'
import { Icon } from './Icon'
import { type as typographyTokens, useTheme } from './theme'
import { LETTER_FADE_MS } from '../stt/liveTranscriptAnimation'
import { buildSoftWords, buildRevealLayout, buildWordRevealPlan, buildWordRevealRects, softTextBlur, softInkEdgeStops, waitingInkPeriod, waitingInkKeyframes, softWordIsTiny, tinyTextBlur, tinyWordSample, tinyWordScale, motionPalette, rasterPadding, skeletonGlyphPositions, skeletonSoftWords, skeletonRowWidth, skeletonTextRows, skeletonLineCount, textRevealEligible, focusRevealTiming, focusMorphDuration, focusInkBands, type SoftWord, type NativeTextLine, type RasterLine, type RasterTypography, type RevealLayout, type WordRevealPlan, type WordRevealRect } from './motionMaterial'

const preparationDeadline = 900
const captureDeadline = 700

const useMotionPreference = () => {
  const [preference, setPreference] = useState({ reduced: true, ready: false })
  useEffect(() => {
    let alive = true
    let eventObserved = false
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (alive && !eventObserved) setPreference({ reduced, ready: true })
    }).catch(() => { if (alive && !eventObserved) setPreference({ reduced: true, ready: true }) })
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      if (alive) { eventObserved = true; setPreference({ reduced, ready: true }) }
    })
    return () => { alive = false; listener.remove() }
  }, [])
  return preference
}
export function useReducedMotion() { return useMotionPreference().reduced }

const useMotionActive = (active: boolean): boolean => {
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    let alive = true
    const listener = AppState.addEventListener('change', state => { if (alive) setForeground(state === 'active') })
    setForeground(AppState.currentState === 'active')
    return () => { alive = false; listener.remove() }
  }, [])
  return active && foreground
}

const useWaitingInk = (enabled: boolean): Animated.Value => {
  const phase = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!enabled) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(phase, { toValue: 1, duration: waitingInkPeriod, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(phase, { toValue: 0, duration: waitingInkPeriod, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [enabled, phase])
  return phase
}

export type ProcessingStage = 'queued' | 'loading' | 'processing' | 'saving'
export function ProcessingIndicator({ label: customLabel, active = true, stage = 'processing' }: { label?: string; active?: boolean; stage?: ProcessingStage }) {
  const { t } = useI18n()
  const label = customLabel ?? (stage === 'queued' ? t('Czekam na model…', 'Waiting for model…') : stage === 'loading' ? t('Wczytuję model…', 'Loading model…') : stage === 'saving' ? t('Zapisuję…', 'Saving…') : t('Opracowuję notatkę…', 'Processing note…'))
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const live = useMotionActive(active)
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduced || !live || stage === 'queued' || stage === 'loading') { opacity.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.7, duration: 1300, useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 1300, useNativeDriver: true, isInteraction: false }),
    ]))
    loop.start()
    return () => { loop.stop(); opacity.setValue(1) }
  }, [reduced, live, stage, opacity])
  return <View accessible accessibilityLabel={label} accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
    <Animated.View style={{ opacity }}><Icon name="sparkles" size={22} color={colors.accent} /></Animated.View>
    <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.ink, flexShrink: 1 }}>{label}</Text>
  </View>
}

interface BlurRasterProps {
  readonly cacheKey: string
  readonly width: number
  readonly height: number
  readonly lines: readonly RasterLine[]
  readonly typography: RasterTypography
  readonly palette: readonly [string, string, string]
  readonly words?: readonly WordRevealRect[]
  readonly onReady?: (uri: string) => void
  readonly onFailure?: () => void
}

function NaturalInk({ id, softWords, typography, palette, width, height, padding = 0 }: { id: string; softWords: readonly SoftWord[]; typography: RasterTypography; palette: readonly [string, string, string]; width: number; height: number; padding?: number }) {
  const ordinary = softWords.filter(word => !softWordIsTiny(word, typography.fontSize))
  const tiny = softWords.filter(word => softWordIsTiny(word, typography.fontSize))
  return <>
    <Defs>
      <LinearGradient id={`${id}fill`} x1="0" y1="0" x2="1" y2="0">
        {palette.map((color, index) => <Stop key={color} offset={index / 2} stopColor={color} stopOpacity={0.85} />)}
      </LinearGradient>
      <LinearGradient id={`${id}edge`} x1="0" y1="0" x2="1" y2="0">
        <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0} /><Stop offset={0.14} stopColor="#FFFFFF" stopOpacity={1} />
        <Stop offset={0.86} stopColor="#FFFFFF" stopOpacity={1} /><Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
      </LinearGradient>
      <LinearGradient id={`${id}fieldX`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={width} y2={0}>
        {softInkEdgeStops(width, typography.fontSize).map(stop => <Stop key={stop.offset} offset={stop.offset} stopColor="#FFFFFF" stopOpacity={stop.opacity} />)}
      </LinearGradient>
      <LinearGradient id={`${id}fieldY`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={height}>
        {softInkEdgeStops(height, typography.fontSize, true).map(stop => <Stop key={stop.offset} offset={stop.offset} stopColor="#FFFFFF" stopOpacity={stop.opacity} />)}
      </LinearGradient>
      <Filter id={`${id}soft`} x="-10%" y="-20%" width="120%" height="140%"><FeGaussianBlur stdDeviation={[...softTextBlur(typography.fontSize)]} /></Filter>
      <Filter id={`${id}tiny`} filterUnits="userSpaceOnUse" x={-typography.fontSize} y={-typography.fontSize} width={width + typography.fontSize * 2} height={height + typography.fontSize * 2}>
        <FeGaussianBlur stdDeviation={[...tinyTextBlur(typography.fontSize)]} />
      </Filter>
      <Mask id={`${id}words`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
        {softWords.map((word, index) => <Rect key={index} x={word.x} y={word.y} width={word.width} height={word.height} fill={`url(#${id}edge)`} />)}
      </Mask>
      <Mask id={`${id}horizontal`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}fieldX)`} />
      </Mask>
      <Mask id={`${id}field`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id}fieldY)`} />
      </Mask>
    </Defs>
    <G transform={`translate(${padding} ${padding})`}>
    {/* iOS SVG draws masked mask children into the caller's UIKit context.
        Multiply simple axis masks on the ink instead of inside a mask. */}
    <G mask={`url(#${id}horizontal)`}>
    <G mask={`url(#${id}field)`}>
    <G filter={`url(#${id}soft)`} fill={`url(#${id}fill)`}>
      <G mask={`url(#${id}words)`}>
      {ordinary.map((word, index) => <SvgText key={index} x={word.x} y={word.baseline} fontSize={typography.fontSize} fontWeight={typography.fontWeight} fontFamily={typography.fontFamily} letterSpacing={typography.letterSpacing}>
        <TSpan x={word.xPositions ? [...word.xPositions] : undefined}>{word.text}</TSpan>
      </SvgText>)}
      </G>
    </G>
    <G filter={`url(#${id}tiny)`} fill={`url(#${id}fill)`} opacity={0.75}>
      <G mask={`url(#${id}words)`}>
      {tiny.map((word, index) => <G key={index} transform={`translate(${word.x} ${word.baseline}) scale(${tinyWordScale(word, typography.fontSize)} 1)`}>
        <SvgText x={0} y={0} fontSize={typography.fontSize} fontWeight={typography.fontWeight} fontFamily={typography.fontFamily}><TSpan>{tinyWordSample}</TSpan></SvgText>
      </G>)}
      </G>
    </G>
    </G>
    </G>
    </G>
  </>
}

// Static SVG -> one local bitmap per content/geometry/font/theme revision.
// Missing native callback is a documented possibility, hence the finite timeout.
const BlurRaster = memo(function BlurRaster({ cacheKey, width, height, lines, typography, palette, words, onReady, onFailure }: BlurRasterProps) {
  const svg = useRef<Svg | null>(null)
  const id = useId().replace(/[^\w]/gu, '_')
  const [snapshot, setSnapshot] = useState<{ key: string; uri: string } | null>(null)
  const callbacks = useRef({ onReady, onFailure })
  callbacks.current = { onReady, onFailure }
  const owner = useRef(cacheKey)
  owner.current = cacheKey
  const decode = useRef<{ key: string; loaded: () => void; failed: () => void } | null>(null)
  const softWords = useMemo(() => words ? buildSoftWords(words, typography.fontSize) : skeletonSoftWords(lines, typography.fontSize), [words, lines, typography.fontSize])
  useEffect(() => {
    let alive = true
    let finished = false
    let received = false
    const valid = () => alive && !finished && owner.current === cacheKey
    const fail = () => { if (valid()) { finished = true; clearTimeout(timeout); setSnapshot(null); callbacks.current.onFailure?.() } }
    const timeout = setTimeout(fail, captureDeadline)
    try {
      if (typeof svg.current?.toDataURL !== 'function') { fail(); return () => { alive = false; clearTimeout(timeout) } }
      svg.current.toDataURL(base64 => {
        if (!valid() || received) return
        if (typeof base64 !== 'string' || !base64.startsWith('iVBORw0KGgo') || base64.length > 2_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/u.test(base64)) { fail(); return }
        received = true
        const uri = `data:image/png;base64,${base64}`
        decode.current = { key: cacheKey, failed: fail, loaded: () => {
          if (!valid()) return
          finished = true
          clearTimeout(timeout)
          callbacks.current.onReady?.(uri)
        } }
        setSnapshot({ key: cacheKey, uri })
      }, { width: width + rasterPadding * 2, height: height + rasterPadding * 2 })
    } catch { fail() }
    return () => { alive = false; clearTimeout(timeout) }
  }, [cacheKey, width, height])
  const size = { width: width + rasterPadding * 2, height: height + rasterPadding * 2 }
  if (snapshot?.key === cacheKey) return <Image source={{ uri: snapshot.uri }} style={size} resizeMode="stretch" accessible={false}
    onLoad={() => { if (decode.current?.key === cacheKey) decode.current.loaded() }}
    onError={() => { if (decode.current?.key === cacheKey) decode.current.failed() }} />
  return <Svg ref={svg} width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
    <NaturalInk id={id} softWords={softWords} typography={typography} palette={palette} width={width} height={height} padding={rasterPadding} />
  </Svg>
})

export function SkeletonText({ lines = 3, title = false, animate = true, active = true }: { lines?: number; title?: boolean; animate?: boolean; active?: boolean }) {
  const { colors, isDark } = useTheme()
  const { fontScale } = useWindowDimensions()
  const reduced = useReducedMotion()
  const live = useMotionActive(active)
  const waitingInk = useWaitingInk(animate && !reduced && live)
  const opacity = waitingInk.interpolate(waitingInkKeyframes())
  const [width, setWidth] = useState(300)
  const baseType = title ? typographyTokens.display : typographyTokens.body
  const fontSize = Math.min(48, baseType.fontSize * fontScale)
  const lineHeight = Math.min(80, baseType.lineHeight * fontScale)
  const rows = useMemo(() => skeletonTextRows(lines, title, width, fontSize), [lines, title, width, fontSize])
  const rasterLines = useMemo(() => rows.map((text, index) => ({ text, x: 0, y: index * lineHeight, baseline: index * lineHeight + fontSize, height: lineHeight, width, xPositions: skeletonGlyphPositions(text, skeletonRowWidth(width, index), fontSize) })), [rows, lineHeight, fontSize, width])
  const palette = useMemo(() => motionPalette(isDark, colors.accent), [isDark, colors.accent])
  const typography = useMemo(() => ({ fontSize, fontWeight: '400', fontFamily: baseType.fontFamily, letterSpacing: title ? typographyTokens.display.letterSpacing : 0 }), [fontSize, baseType.fontFamily, title])
  const key = JSON.stringify([rows, width, typography, palette])
  const [bitmap, setBitmap] = useState<{ key: string; uri: string } | null>(null)
  const currentKey = useRef(key)
  currentKey.current = key
  const captured = useCallback((uri: string) => { if (currentKey.current === key) setBitmap({ key, uri }) }, [key])
  const height = rows.length * lineHeight
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={event => {
    const next = event.nativeEvent.layout.width
    if (Number.isFinite(next) && next > 0) setWidth(Math.min(600, next))
  }} style={{ height, overflow: 'hidden' }}>
    {live && <Animated.View style={{ position: 'absolute', left: -rasterPadding, top: -rasterPadding, opacity }}>
      {bitmap?.key === key ? <Image source={{ uri: bitmap.uri }} resizeMode="stretch" accessible={false} style={{ width: width + rasterPadding * 2, height: height + rasterPadding * 2 }} /> :
        <BlurRaster cacheKey={key} width={width} height={height} lines={rasterLines} typography={typography} palette={palette} onReady={captured} />}
    </Animated.View>}
  </View>
}

export function fadedTextColor(hex: string, opacity: number): string {
  const color = /^#[\da-f]{6}$/i.test(hex) ? hex : '#49576A'
  return `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${Math.max(0, Math.min(1, opacity))})`
}

// Text layout props belong to the enclosing View after the additive API change.
export function splitMotionTextStyle(style: StyleProp<TextStyle>): { container: ViewStyle; text: TextStyle } {
  const { flex, flexBasis, flexGrow, flexShrink, alignSelf, width, minWidth, maxWidth, height, minHeight, maxHeight,
    margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, marginStart, marginEnd,
    padding, paddingTop, paddingBottom, paddingLeft, paddingRight, paddingHorizontal, paddingVertical, paddingStart, paddingEnd,
    ...text } = StyleSheet.flatten(style) ?? {}
  return { container: { flex, flexBasis, flexGrow, flexShrink, alignSelf, width, minWidth, maxWidth, height, minHeight, maxHeight,
    margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, marginStart, marginEnd,
    padding, paddingTop, paddingBottom, paddingLeft, paddingRight, paddingHorizontal, paddingVertical, paddingStart, paddingEnd }, text }
}

const WordMeasurements = memo(function WordMeasurements({ plan, style, onReady, onFailure }: { plan: WordRevealPlan; style: TextStyle; onReady: (rects: readonly WordRevealRect[]) => void; onFailure: () => void }) {
  const measured = useRef<Record<string, number>>({})
  const alive = useRef(true)
  const finished = useRef(false)
  useEffect(() => () => { alive.current = false }, [])
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    {plan.probes.map(probe => <Text key={probe.key} testID={`reveal-measure-${probe.key}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[style, { opacity: 0, position: 'absolute', left: 0, top: 0, width: 604 }]} onTextLayout={event => {
      if (!alive.current || finished.current) return
      const lines = event.nativeEvent.lines
      if (lines.length !== 1 || lines[0].text !== probe.text || !Number.isFinite(lines[0].width) || lines[0].width < 0) { finished.current = true; onFailure(); return }
      measured.current[probe.key] = lines[0].width
      if (Object.keys(measured.current).length !== plan.probes.length) return
      finished.current = true
      const rects = buildWordRevealRects(plan, measured.current)
      if (rects) onReady(rects); else onFailure()
    }}>{probe.text}</Text>)}
  </View>
})

const MorphInk = memo(function MorphInk({ layout, width, count, lineHeight, typography, palette, progress, duration, animate = false }: {
  layout: RevealLayout | null; width: number; count: number; lineHeight: number; typography: RasterTypography;
  palette: readonly [string, string, string]; progress?: Animated.Value; duration?: number; animate?: boolean
}) {
  const id = useId().replace(/[^\w]/gu, '_')
  const waitingInk = useWaitingInk(animate)
  const finish = duration ? focusMorphDuration / duration : 1
  const morph = progress?.interpolate({ inputRange: [0, finish], outputRange: [0, 1], extrapolate: 'clamp' })
  const rows = Math.min(6, Math.max(count, layout?.lines.length ?? count))
  const source = skeletonTextRows(rows, typography.fontSize >= 24, width, typography.fontSize)
  return <Animated.View testID="reveal-waiting-material" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { opacity: morph?.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }) ?? 1 }]}>
    {source.map((text, index) => {
      const initialWidth = skeletonRowWidth(width, index), initialY = index * lineHeight
      const target = layout?.lines[index]
      const targetWidth = target ? Math.max(1, Math.min(width, target.x + target.width)) : initialWidth * 0.06
      const scale = morph?.interpolate({ inputRange: [0, 1], outputRange: [1, targetWidth / initialWidth] }) ?? 1
      const translateX = morph ? Animated.multiply(morph, (targetWidth - initialWidth) / 2) : 0
      const translateY = morph ? Animated.multiply(morph, (target?.y ?? Math.max(0, (layout?.height ?? initialY) - lineHeight)) - initialY) : 0
      const opacity = morph?.interpolate({ inputRange: [0, 1], outputRange: [index < count ? 1 : 0, target ? 1 : 0] }) ?? (index < count ? 1 : 0)
      const ink = skeletonSoftWords([{ text, x: 0, y: 0, baseline: typography.fontSize, height: lineHeight, width: initialWidth,
        xPositions: skeletonGlyphPositions(text, initialWidth, typography.fontSize) }], typography.fontSize)
      return <Animated.View key={index} testID={`reveal-morph-row-${index}`} style={{ position: 'absolute', left: 0, top: initialY, width: initialWidth, height: lineHeight, opacity,
        transform: [{ translateX }, { translateY }, { scaleX: scale }] }}>
        <Animated.View style={{ opacity: waitingInk.interpolate(waitingInkKeyframes(index)) }}>
        <Svg width={initialWidth} height={lineHeight} viewBox={`0 0 ${initialWidth} ${lineHeight}`}>
          <NaturalInk id={`${id}${index}`} softWords={ink} typography={typography} palette={palette} width={initialWidth} height={lineHeight} />
        </Svg>
        </Animated.View>
      </Animated.View>
    })}
  </Animated.View>
})

const LetterRows = memo(function LetterRows({ layout, uri, progress, text, style, accent, onFailure, numberOfLines, morph = false }: { layout: RevealLayout; uri: string; progress: Animated.Value; text: string; style: TextStyle; accent: string; onFailure: () => void; numberOfLines?: number; morph?: boolean }) {
  const bands = focusInkBands(layout.lines.length)
  const softOpacity = morph ? progress.interpolate({ inputRange: [0, focusMorphDuration * 0.7 / focusRevealTiming(0, layout, true).duration, focusMorphDuration / focusRevealTiming(0, layout, true).duration], outputRange: [0, 0, 1], extrapolate: 'clamp' }) : 1
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
    {layout.lines.map((line, index) => {
      if (!line.text.trim()) return null
      const { start, end, duration } = focusRevealTiming(index, layout, morph)
      const distance = Math.min(layout.width, line.x + line.width + 2)
      const edgeAt = (age: number) => progress.interpolate({ inputRange: [start + age / duration, end + age / duration], outputRange: [0, distance], extrapolate: 'clamp' })
      const edge = edgeAt(LETTER_FADE_MS)
      const sharpX = Animated.subtract(edge, layout.width)
      return <View key={index} testID={`reveal-line-${index}`} style={{ position: 'absolute', top: line.y, left: 0, width: layout.width, height: line.height, overflow: 'hidden' }}>
        <Animated.View testID={`reveal-line-${index}-soft`} style={[StyleSheet.absoluteFill, { opacity: softOpacity, overflow: 'hidden', transform: [{ translateX: edge }] }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(edge, -1) }] }]}>
            <Image accessible={false} onError={onFailure} source={{ uri }} resizeMode="stretch" style={{ position: 'absolute', width: layout.width + rasterPadding * 2, height: layout.height + rasterPadding * 2, top: -line.y - rasterPadding, left: -rasterPadding }} />
          </Animated.View>
        </Animated.View>
        <Animated.View testID={`reveal-line-${index}-sharp`} style={[StyleSheet.absoluteFill, { overflow: 'hidden', transform: [{ translateX: sharpX }] }]}>
          <Animated.View testID={`reveal-line-${index}-sharp-content`} style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(sharpX, -1) }] }]}>
            <Text accessible={false} accessibilityElementsHidden numberOfLines={numberOfLines} style={[style, { position: 'absolute', width: layout.width, top: -line.y, left: 0 }]}>{text}</Text>
          </Animated.View>
        </Animated.View>
        {bands.map((band, bandIndex) => {
          const front = Animated.subtract(edgeAt(band.fromAge), layout.width)
          const rear = edgeAt(band.toAge)
          const id = `reveal-line-${index}-ink-${bandIndex}`
          return <Animated.View key={bandIndex} testID={`${id}-front`} style={[StyleSheet.absoluteFill, { opacity: band.opacity, overflow: 'hidden', transform: [{ translateX: front }] }]}>
            <Animated.View testID={`${id}-front-content`} style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(front, -1) }] }]}>
              <Animated.View testID={`${id}-rear`} style={[StyleSheet.absoluteFill, { overflow: 'hidden', transform: [{ translateX: rear }] }]}>
                <Animated.View testID={`${id}-rear-content`} style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(rear, -1) }] }]}>
                  <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" numberOfLines={numberOfLines}
                    style={[style, { color: accent, position: 'absolute', width: layout.width, top: -line.y, left: 0 }]}>{text}</Text>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </Animated.View>
        })}
      </View>
    })}
  </View>
})

export function RevealText({ text, animate = false, style, active = true, accessibilityRole, numberOfLines, onRevealComplete, delayMs = 0, placeholderLines = 0 }: {
  text: string; animate?: boolean; style?: StyleProp<TextStyle>; active?: boolean; accessibilityRole?: AccessibilityRole; numberOfLines?: number; onRevealComplete?: (text: string) => void; delayMs?: number; placeholderLines?: number
}) {
  const { colors, isDark } = useTheme()
  const { fontScale } = useWindowDimensions()
  const { reduced, ready } = useMotionPreference()
  const live = useMotionActive(active)
  const split = useMemo(() => splitMotionTextStyle(style), [style])
  const nativeStyle = useMemo(() => ({ color: colors.body, ...split.text }), [colors.body, split.text])
  const fontSize = (typeof nativeStyle.fontSize === 'number' ? nativeStyle.fontSize : 14) * fontScale
  const typography = useMemo<RasterTypography>(() => ({ fontSize, fontWeight: String(nativeStyle.fontWeight ?? '400'), fontFamily: nativeStyle.fontFamily, letterSpacing: nativeStyle.letterSpacing ?? 0 }), [fontSize, nativeStyle.fontWeight, nativeStyle.fontFamily, nativeStyle.letterSpacing])
  const morphEnabled = Number.isFinite(placeholderLines) && placeholderLines > 0
  const placeholderCount = skeletonLineCount(morphEnabled ? placeholderLines : 1)
  const placeholderType = (nativeStyle.fontSize ?? 14) >= 24 ? typographyTokens.display : typographyTokens.body
  const placeholderFont = Math.min(48, placeholderType.fontSize * fontScale)
  const placeholderLineHeight = Math.min(80, placeholderType.lineHeight * fontScale)
  const placeholderTypography = useMemo<RasterTypography>(() => ({ fontSize: placeholderFont, fontWeight: '400', fontFamily: placeholderType.fontFamily,
    letterSpacing: placeholderType === typographyTokens.display ? typographyTokens.display.letterSpacing : 0 }), [placeholderFont, placeholderType])
  const palette = useMemo(() => motionPalette(isDark, colors.accent), [isDark, colors.accent])
  const visual = JSON.stringify([typography, palette, nativeStyle, numberOfLines, morphEnabled, placeholderCount, placeholderTypography])
  const eligible = textRevealEligible(text) && fontSize <= 48 && (!nativeStyle.textAlign || nativeStyle.textAlign === 'left') && (!nativeStyle.textDecorationLine || nativeStyle.textDecorationLine === 'none') &&
    (!nativeStyle.fontStyle || nativeStyle.fontStyle === 'normal') && !nativeStyle.fontVariant?.length && !nativeStyle.transform && (!nativeStyle.textTransform || nativeStyle.textTransform === 'none')
  const [width, setWidth] = useState(0)
  const [lines, setLines] = useState<{ text: string; values: readonly NativeTextLine[] } | null>(null)
  const [uncapped, setUncapped] = useState<{ text: string; values: readonly NativeTextLine[] } | null>(null)
  const layout = useMemo(() => {
    const capped = lines?.text === text ? buildRevealLayout(text, lines.values, width) : null
    if (!numberOfLines || numberOfLines <= 0) return capped
    const full = uncapped?.text === text ? buildRevealLayout(text, uncapped.values, width) : null
    return full && capped && full.measuredLines <= numberOfLines && JSON.stringify(full) === JSON.stringify(capped) ? capped : null
  }, [text, lines, uncapped, width, numberOfLines])
  const rasterKey = layout ? JSON.stringify([text, layout, visual]) : null
  const wordPlan = useMemo(() => layout ? buildWordRevealPlan(layout) : null, [layout])
  const [phase, setPhase] = useState<'plain' | 'waiting' | 'revealing' | 'fading'>('plain')
  const [bitmap, setBitmap] = useState<{ key: string; uri: string } | null>(null)
  const [wordRects, setWordRects] = useState<{ key: string; values: readonly WordRevealRect[] } | null>(null)
  const seen = useRef<string | null>(null)
  const request = useRef<{ text: string; visual: string; geometry: string | null; alive: boolean; capturing: boolean; fading: boolean; epoch: number; delay: number } | null>(null)
  const completion = useRef(onRevealComplete)
  completion.current = onRevealComplete
  const completionEpoch = useRef(0)
  const [requestEpoch, setRequestEpoch] = useState(0)
  const [completed, setCompleted] = useState<{ text: string; epoch: number } | null>(null)
  const progress = useRef(new Animated.Value(1)).current
  const fallbackProgress = useRef(new Animated.Value(1)).current
  const animation = useRef<Animated.CompositeAnimation | null>(null)
  const lifetime = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({ text, live, animate, visual, reduced })
  current.current = { text, live, animate, visual, reduced }
  const geometry = useRef(rasterKey)
  geometry.current = rasterKey
  const placeholderId = useId().replace(/[^\w]/gu, '_')
  const pendingInk = useMemo(() => {
    const count = layout?.lines.length ?? 1
    const rows = skeletonTextRows(count, false, width || 300, fontSize)
    return skeletonSoftWords(rows.map((value, index) => ({ text: value, x: 0, y: layout?.lines[index]?.y ?? index * fontSize * 1.6, height: layout?.lines[index]?.height ?? fontSize * 1.6, baseline: layout?.lines[index]?.baseline ?? index * fontSize * 1.6 + fontSize, width: layout?.lines[index]?.width ?? skeletonRowWidth(width || 300, index) })), fontSize)
  }, [layout, width, fontSize])
  const settle = useCallback(() => {
    const owner = request.current
    const notify = owner?.alive && current.current.text === owner.text
    if (request.current) request.current.alive = false
    request.current = null
    if (lifetime.current !== null) { clearTimeout(lifetime.current); lifetime.current = null }
    animation.current?.stop(); animation.current = null
    progress.setValue(1); fallbackProgress.setValue(1); setPhase('plain'); setBitmap(null); setWordRects(null)
    if (notify) setCompleted({ text: owner.text, epoch: owner.epoch })
  }, [progress, fallbackProgress])
  const fadeFallback = useCallback(() => {
    const owner = request.current
    if (!owner?.alive || owner.fading) return
    if (!current.current.live || !current.current.animate || current.current.reduced) { settle(); return }
    owner.fading = true
    if (lifetime.current !== null) clearTimeout(lifetime.current)
    animation.current?.stop()
    fallbackProgress.setValue(0)
    if (morphEnabled) LayoutAnimation.configureNext({ duration: 240, update: { type: 'easeInEaseOut' } })
    setPhase('fading')
    const fade = Animated.timing(fallbackProgress, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false })
    animation.current = fade
    fade.start(({ finished }) => { if (finished && request.current === owner && owner.alive) settle() })
    lifetime.current = setTimeout(() => { if (request.current === owner && owner.alive) settle() }, 340)
  }, [fallbackProgress, settle, morphEnabled])
  useEffect(() => {
    if (completed?.text === text && completed.epoch === completionEpoch.current) completion.current?.(text)
  }, [completed, text])
  useLayoutEffect(() => {
    const epoch = ++completionEpoch.current
    if (!live || ready && reduced) { seen.current = text; settle(); if (animate) setCompleted({ text, epoch }); return }
    if (!animate) { settle(); return }
    if (!ready) return
    if (seen.current === text) { setCompleted({ text, epoch }); return }
    if (!eligible) { seen.current = text; settle(); setCompleted({ text, epoch }); return }
    seen.current = text
    const owner = { text, visual, geometry: geometry.current, alive: true, capturing: false, fading: false, epoch, delay: Number.isFinite(delayMs) ? Math.max(0, Math.min(420, delayMs)) : 0 }
    request.current = owner
    setRequestEpoch(epoch)
    setPhase('waiting'); setBitmap(null); setWordRects(null); progress.setValue(0)
    lifetime.current = setTimeout(() => { if (request.current === owner && owner.alive) fadeFallback() }, preparationDeadline)
    return () => {
      const notify = request.current === owner && owner.alive && current.current.text === owner.text
      owner.alive = false
      settle()
      if (notify) setCompleted({ text: owner.text, epoch: owner.epoch })
    }
  }, [text, animate, live, ready, reduced, eligible, visual, progress, settle, fadeFallback])
  useLayoutEffect(() => {
    const owner = request.current
    if (!owner?.alive || !rasterKey) return
    if (owner.geometry !== null && owner.geometry !== rasterKey) { fadeFallback(); return }
    owner.geometry = rasterKey
  }, [rasterKey, fadeFallback])
  useLayoutEffect(() => { if (layout && !wordPlan && request.current?.alive) fadeFallback() }, [layout, wordPlan, fadeFallback])
  useLayoutEffect(() => {
    const owner = request.current
    if (phase !== 'waiting' || !owner?.alive || owner.capturing || !rasterKey || wordRects?.key !== rasterKey) return
    owner.capturing = true
    if (lifetime.current !== null) clearTimeout(lifetime.current)
    lifetime.current = setTimeout(() => { if (request.current === owner && owner.alive) fadeFallback() }, captureDeadline + 50)
  }, [phase, rasterKey, wordRects, fadeFallback])
  const rasterOwner = request.current
  const captured = useCallback((uri: string) => {
    const owner = request.current
    if (!owner?.alive || owner.fading || owner !== rasterOwner || !rasterKey || geometry.current !== rasterKey || owner.geometry !== rasterKey || current.current.text !== owner.text || current.current.visual !== owner.visual || !current.current.live || !current.current.animate) return
    setBitmap({ key: rasterKey, uri })
  }, [rasterKey, rasterOwner])
  const measured = useCallback((values: readonly WordRevealRect[]) => {
    const owner = request.current
    if (!owner?.alive || owner.fading || owner !== rasterOwner || !rasterKey || geometry.current !== rasterKey || owner.geometry !== rasterKey || current.current.text !== owner.text || current.current.visual !== owner.visual || !current.current.live || !current.current.animate) return
    setWordRects({ key: rasterKey, values })
  }, [rasterKey, rasterOwner])
  useLayoutEffect(() => {
    const owner = request.current
    if (phase !== 'waiting' || !owner?.alive || !rasterKey || bitmap?.key !== rasterKey || wordRects?.key !== rasterKey || !wordPlan) return
    if (lifetime.current !== null) { clearTimeout(lifetime.current); lifetime.current = null }
    if (morphEnabled) LayoutAnimation.configureNext({ duration: focusMorphDuration, update: { type: 'easeInEaseOut' } })
    setPhase('revealing')
    const duration = focusRevealTiming(0, layout!, morphEnabled).duration
    const focus = Animated.timing(progress, { toValue: 1, duration, delay: owner.delay, easing: Easing.linear, useNativeDriver: true, isInteraction: false })
    animation.current = focus
    focus.start(({ finished }) => { if (finished && request.current === owner && owner.alive) settle() })
    lifetime.current = setTimeout(() => { if (request.current === owner && owner.alive) settle() }, duration + owner.delay + 100)
  }, [phase, rasterKey, bitmap, wordRects, wordPlan, layout, progress, settle, morphEnabled])
  const failed = useCallback(() => {
    const owner = request.current
    if (owner?.alive && owner === rasterOwner && rasterKey && geometry.current === rasterKey && owner.geometry === rasterKey && current.current.text === owner.text && current.current.visual === owner.visual) fadeFallback()
  }, [rasterKey, rasterOwner, fadeFallback])
  const waiting = phase === 'waiting' && request.current?.alive === true
  const fading = phase === 'fading' && request.current?.alive === true
  const revealing = (phase === 'revealing' || fading) && bitmap?.key === rasterKey && wordRects?.key === rasterKey && layout !== null
  const awaitingPreference = animate && live && eligible && !ready
  const frameHeight = morphEnabled && (waiting || awaitingPreference) ? placeholderCount * placeholderLineHeight : morphEnabled && revealing && !fading ? layout?.height : undefined
  // Each anonymous SVG already feathers its own four edges. A changing parent
  // height must not cut that halo before it fades; literal layers own their clips.
  const morphMaterial = morphEnabled && (waiting || awaitingPreference || revealing && !fading)
  return <View accessible accessibilityLabel={text} accessibilityRole={accessibilityRole} style={split.container}>
    <View testID="reveal-frame" style={{ position: 'relative', height: frameHeight, overflow: morphEnabled && !morphMaterial ? 'hidden' : 'visible' }}>
    <Animated.View style={{ opacity: fading ? fallbackProgress : 1 }}>
    <Text accessible={false} numberOfLines={numberOfLines} style={[nativeStyle, { opacity: !fading && (awaitingPreference || waiting || revealing) ? 0 : 1 }]} onLayout={event => {
      const next = event.nativeEvent.layout.width
      if (Number.isFinite(next) && next > 0) setWidth(next)
    }} onTextLayout={event => {
      const values = event.nativeEvent.lines
      setLines(previous => previous?.text === text && JSON.stringify(previous.values) === JSON.stringify(values) ? previous : { text, values })
    }}>{text}</Text>
    {fading && <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { opacity: fallbackProgress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 1, 0] }) }]}>
      <Text accessible={false} accessibilityElementsHidden numberOfLines={numberOfLines} style={[nativeStyle, { color: colors.accent }]}>{text}</Text>
    </Animated.View>}
    </Animated.View>
    {waiting && eligible && numberOfLines !== undefined && numberOfLines > 0 && width > 0 && <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[nativeStyle, { opacity: 0, position: 'absolute', left: 0, top: 0, width }]} onTextLayout={event => {
      const values = event.nativeEvent.lines
      setUncapped(previous => previous?.text === text && JSON.stringify(previous.values) === JSON.stringify(values) ? previous : { text, values })
    }}>{text}</Text>}
    {waiting && wordPlan && rasterKey && <WordMeasurements key={`${requestEpoch}:${rasterKey}`} plan={wordPlan} style={nativeStyle} onReady={measured} onFailure={failed} />}
    {waiting && wordPlan && layout && rasterKey && wordRects?.key === rasterKey && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, width: layout.width, height: layout.height, overflow: 'hidden', opacity: morphEnabled ? 0 : 1 }}>
      <View style={{ position: 'absolute', top: -rasterPadding, left: -rasterPadding }}>
      <BlurRaster key={requestEpoch} cacheKey={rasterKey} width={layout.width} height={layout.height} lines={layout.lines} words={wordRects.values} typography={typography} palette={palette} onReady={captured} onFailure={failed} />
      </View>
    </View>}
    {(!morphEnabled && (awaitingPreference || waiting && (!layout || wordRects?.key !== rasterKey)) || fading && !revealing) && <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { opacity: fading ? Animated.subtract(1, fallbackProgress) : 1 }]}>
      <Svg width="100%" height={layout?.height ?? Math.min(80, fontSize * 2.9)} viewBox={`0 0 ${width || 300} ${layout?.height ?? Math.min(80, fontSize * 2.9)}`}>
        <NaturalInk id={`${placeholderId}wait`} softWords={pendingInk} typography={typography} palette={palette} width={width || 300} height={layout?.height ?? Math.min(80, fontSize * 2.9)} />
      </Svg>
    </Animated.View>}
    {revealing && layout && wordPlan && bitmap && <Animated.View style={[StyleSheet.absoluteFill, { opacity: fading ? Animated.subtract(1, fallbackProgress) : 1 }]}>
      <LetterRows layout={layout} uri={bitmap.uri} progress={progress} text={text} style={nativeStyle} accent={colors.accent} numberOfLines={numberOfLines} onFailure={failed} morph={morphEnabled} />
    </Animated.View>}
    {morphEnabled && (awaitingPreference || waiting || revealing && !fading) && <MorphInk layout={revealing ? layout : null} width={width || 300} count={placeholderCount}
      animate={waiting && ready && !reduced && live}
      lineHeight={placeholderLineHeight} typography={placeholderTypography} palette={palette} progress={revealing ? progress : undefined}
      duration={revealing && layout ? focusRevealTiming(0, layout, true).duration : undefined} />}
    </View>
  </View>
}
