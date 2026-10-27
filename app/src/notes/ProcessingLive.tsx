import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { LiveSummaryProgress, ProcessingPhase } from '../ai/noteProcessing'
import { useI18n } from '../i18n/useI18n'
import { radius, spacing, type, useTheme } from '../ui/theme'

export type LiveSegmentKind = 'plain' | 'cited' | 'next'
export interface LiveSegment { readonly text: string; readonly kind: LiveSegmentKind }

const EMPTY_LIVE: LiveSummaryProgress = { units: [], drafts: [] }
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
  // Spans from another revision of the text would mark the wrong words.
  const valid = live.units.every((unit, index) =>
    unit.start >= (index ? live.units[index - 1].end : 0) && unit.start <= unit.end && unit.end <= content.length)
  if (!valid) return [{ text: content, kind: 'plain' }]
  const segments: LiveSegment[] = []
  let cursor = 0
  for (const unit of live.units) {
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

// A new point fades in and settles a few pixels up; the haptic marks the arrival.
function DraftRow({ text, animate }: { text: string; animate: boolean }) {
  const { colors } = useTheme()
  const enter = useRef(new Animated.Value(animate ? 0 : 1)).current
  useEffect(() => {
    if (!animate) return
    void Haptics.selectionAsync().catch(() => undefined)
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [animate, enter])
  return (
    <Animated.View style={[styles.row, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      <View style={styles.bulletSlot}>
        <View style={[styles.dot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
      </View>
      <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{text}</Text>
    </Animated.View>
  )
}

type LivePhase = ProcessingPhase | undefined

// The single source of phase text for the processing card.
export const liveStatusLabel = (phase: LivePhase, t: (pl: string, en: string) => string): string =>
  phase === 'queued' ? t('Czekam na model', 'Waiting for the model')
    : phase === 'loading' ? t('Wczytuję model', 'Loading the model')
      : phase === 'title' || phase === 'tags' ? t('Dobieram tytuł', 'Choosing a title')
        : t('Zakreślam najważniejsze', 'Highlighting what matters')

export function ProcessingLive({ content, live, phase, reducedMotion }: {
  content: string
  live?: LiveSummaryProgress
  phase?: LivePhase
  reducedMotion: boolean
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const startedAt = useRef(Date.now()).current
  const [elapsed, setElapsed] = useState(0)
  const draftCount = live?.drafts.length ?? 0
  const seen = useRef(draftCount)
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  // Drafts present on mount are shown without the entrance.
  const firstAnimated = seen.current
  useEffect(() => { seen.current = Math.max(seen.current, draftCount) }, [draftCount])
  const source = live ?? EMPTY_LIVE
  const segments = liveTranscriptSegments(content, source)
  const fraction = liveTrailFraction(source)
  const waiting = phase !== 'queued' && phase !== 'loading' && phase !== 'title' && phase !== 'tags'
  return (
    <View style={styles.container}>
      <View style={styles.status}>
        <Text style={[type.label, { color: colors.ink }]}>{liveStatusLabel(phase, t)}</Text>
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
                : segment.kind === 'next' ? { color: colors.ink, backgroundColor: colors.markerSoft } : undefined}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      </View>
      <View accessibilityLiveRegion="polite">
        {source.drafts.map((draft, index) => (
          <DraftRow key={index} text={draft.text} animate={!reducedMotion && index >= firstAnimated} />
        ))}
        {waiting && <WaitingDot reducedMotion={reducedMotion} label={draftCount ? t('Następny punkt…', 'Next point…') : t('Pierwszy punkt…', 'First point…')} />}
      </View>
      <Text style={[type.meta, { color: colors.muted, opacity: elapsed >= SLOW_AFTER_SECONDS ? 1 : 0 }]}>
        {t('Dłuższe nagranie — to potrwa chwilę. Możesz wrócić do listy, dokończę w tle.',
          'A longer recording takes a moment. You can go back to the list; it finishes in the background.')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, minHeight: 280 },
  status: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  trail: { height: 10, borderRadius: 3, overflow: 'hidden' },
  trailInk: { ...StyleSheet.absoluteFill, borderTopRightRadius: 6, borderBottomRightRadius: 2 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.md },
  bulletSlot: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  ring: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
})
