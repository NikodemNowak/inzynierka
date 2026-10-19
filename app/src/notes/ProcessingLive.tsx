import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { LiveSummaryProgress } from '../ai/noteProcessing'
import { useI18n } from '../i18n/useI18n'
import { radius, spacing, type, useTheme } from '../ui/theme'

export type LiveSegmentKind = 'plain' | 'cited' | 'next'
export interface LiveSegment { readonly text: string; readonly kind: LiveSegmentKind }

const NEXT_UNITS = 2
const SLOW_AFTER_SECONDS = 40

// Index of the furthest sentence any draft cites, or -1 before the first point.
export const lastCitedIndex = (live: LiveSummaryProgress): number => {
  const cited = new Set(live.drafts.flatMap((draft) => draft.sourceIds))
  let last = -1
  live.units.forEach((unit, index) => { if (cited.has(unit.id)) last = index })
  return last
}

export const liveTrailFraction = (live: LiveSummaryProgress): number =>
  live.units.length ? (lastCitedIndex(live) + 1) / live.units.length : 0

// Transcript split into plain text, cited sentences and the ones the model reads next.
export const liveTranscriptSegments = (content: string, live: LiveSummaryProgress): LiveSegment[] => {
  const cited = new Set(live.drafts.flatMap((draft) => draft.sourceIds))
  const last = lastCitedIndex(live)
  const next = new Set(live.units.slice(last + 1, last + 1 + NEXT_UNITS).map((unit) => unit.id))
  const segments: LiveSegment[] = []
  let cursor = 0
  for (const unit of live.units) {
    if (unit.start < cursor || unit.end > content.length) continue
    if (unit.start > cursor) segments.push({ text: content.slice(cursor, unit.start), kind: 'plain' })
    const kind: LiveSegmentKind = cited.has(unit.id) ? 'cited' : next.has(unit.id) ? 'next' : 'plain'
    segments.push({ text: content.slice(unit.start, unit.end), kind })
    cursor = unit.end
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), kind: 'plain' })
  return segments
}

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function MarkerTrail({ fraction, reducedMotion }: { fraction: number; reducedMotion: boolean }) {
  const { colors } = useTheme()
  const [width, setWidth] = useState(0)
  const progress = useRef(new Animated.Value(fraction)).current
  useEffect(() => {
    if (reducedMotion) { progress.setValue(fraction); return }
    Animated.timing(progress, { toValue: fraction, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [fraction, progress, reducedMotion])
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.trail, { backgroundColor: colors.surface }]}
    >
      <Animated.View
        style={[
          styles.trailInk,
          { backgroundColor: colors.marker },
          { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] },
        ]}
      />
    </View>
  )
}

function WaitingDot({ reducedMotion, label }: { reducedMotion: boolean; label: string }) {
  const { colors } = useTheme()
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reducedMotion) return
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [pulse, reducedMotion])
  return (
    <View style={styles.row}>
      <View style={styles.bulletSlot}>
        <Animated.View
          style={[
            styles.ring,
            { backgroundColor: colors.marker },
            { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] },
          ]}
        />
        <View style={[styles.dot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
      </View>
      <Text style={[type.body, { color: colors.faint }]}>{label}</Text>
    </View>
  )
}

// The bullet stretches into a highlighter stroke, writes the point and folds back.
function DraftRow({ text, animate }: { text: string; animate: boolean }) {
  const { colors, isDark } = useTheme()
  const [width, setWidth] = useState(0)
  const sweep = useRef(new Animated.Value(animate ? 0 : 1)).current
  const fold = useRef(new Animated.Value(animate ? 0 : 1)).current
  useEffect(() => {
    if (!animate || !width) return
    void Haptics.selectionAsync().catch(() => undefined)
    Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fold, { toValue: 1, duration: 380, delay: 160, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start()
  }, [animate, width, sweep, fold])
  const strokeScale = Animated.add(sweep, Animated.multiply(fold, -1)).interpolate({ inputRange: [0, 1], outputRange: [0.02, 1], extrapolate: 'clamp' })
  return (
    <View style={styles.row} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.bulletSlot}>
        <Animated.View style={[styles.dot, { backgroundColor: colors.marker, borderColor: colors.markerLine, transform: [{ scale: fold }] }]} />
      </View>
      {animate && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stroke,
            { width, backgroundColor: colors.marker, opacity: isDark ? 0.4 : 1, transform: [{ scaleX: strokeScale }] },
          ]}
        />
      )}
      <View style={styles.clip}>
        <Animated.View style={{ transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }}>
          <Animated.View style={{ transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] }}>
            <Text style={[type.body, { color: colors.ink }]}>{text}</Text>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  )
}

export function ProcessingLive({ content, live, reducedMotion }: {
  content: string
  live: LiveSummaryProgress
  reducedMotion: boolean
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const startedAt = useRef(Date.now()).current
  const [elapsed, setElapsed] = useState(0)
  const seen = useRef(live.drafts.length)
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  // Drafts present on mount are shown without the reveal.
  const firstAnimated = seen.current
  useEffect(() => { seen.current = Math.max(seen.current, live.drafts.length) }, [live.drafts.length])
  const segments = liveTranscriptSegments(content, live)
  const fraction = liveTrailFraction(live)
  return (
    <View style={styles.container}>
      <View style={styles.status}>
        <Text style={[type.label, { color: colors.ink }]}>{t('Zakreślam najważniejsze', 'Highlighting what matters')}</Text>
        <Text style={[type.meta, { color: colors.muted }]}>{formatElapsed(elapsed)}</Text>
      </View>
      <View accessible accessibilityLabel={t(`Przeczytane ${Math.round(fraction * 100)}% notatki`, `${Math.round(fraction * 100)}% of the note read`)}>
        <MarkerTrail fraction={fraction} reducedMotion={reducedMotion} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.line }]}>
        <Text style={[type.body, { color: colors.faint }]}>
          {segments.map((segment, index) => (
            <Text
              key={index}
              style={segment.kind === 'cited'
                ? { color: colors.onMarker, backgroundColor: colors.marker }
                : segment.kind === 'next' ? { color: colors.ink, backgroundColor: colors.accentSoft } : undefined}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      </View>
      <View accessibilityLiveRegion="polite">
        {live.drafts.map((draft, index) => (
          <DraftRow key={index} text={draft.text} animate={!reducedMotion && index >= firstAnimated} />
        ))}
        <WaitingDot reducedMotion={reducedMotion} label={live.drafts.length ? t('Następny punkt…', 'Next point…') : t('Pierwszy punkt…', 'First point…')} />
      </View>
      {elapsed >= SLOW_AFTER_SECONDS && (
        <Text style={[type.meta, { color: colors.muted }]}>
          {t('Dłuższe nagranie — to potrwa jeszcze chwilę. Możesz wrócić do listy, dokończę w tle.',
            'A longer recording takes a little more time. You can go back to the list; it finishes in the background.')}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  status: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  trail: { height: 10, borderRadius: 3, overflow: 'hidden' },
  trailInk: { ...StyleSheet.absoluteFill, borderTopRightRadius: 6, borderBottomRightRadius: 2 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.md },
  bulletSlot: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  ring: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  stroke: { position: 'absolute', left: 0, top: 10, bottom: 10, borderRadius: 5, transformOrigin: 'left' },
  clip: { flex: 1, overflow: 'hidden' },
})
