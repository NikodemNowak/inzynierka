import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { LiveSummaryProgress, ProcessingPhase } from '../ai/noteProcessing'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'

const EMPTY_LIVE: LiveSummaryProgress = { units: [], drafts: [] }
const ENTER_MS = 200

// Index of the furthest sentence any draft cites, or -1 before the first point.
export const lastCitedIndex = (live: LiveSummaryProgress): number => {
  const cited = new Set(live.drafts.flatMap((draft) => draft.sourceIds))
  let last = -1
  live.units.forEach((unit, index) => { if (cited.has(unit.id)) last = index })
  return last
}

export const liveTrailFraction = (live: LiveSummaryProgress): number =>
  live.units.length ? (lastCitedIndex(live) + 1) / live.units.length : 0

type LivePhase = ProcessingPhase | undefined
export type StageState = 'done' | 'active' | 'waiting'
export interface LiveStage {
  readonly key: 'transcript' | 'summary' | 'tasks' | 'title'
  readonly state: StageState
}

// The pipeline summarises first, then settles tasks and the title. There is no
// separate task phase, so tasks count as done once the title is being chosen.
export const liveStages = (phase: LivePhase): LiveStage[] => {
  const titling = phase === 'title' || phase === 'tags'
  return [
    { key: 'transcript', state: 'done' },
    { key: 'summary', state: titling ? 'done' : 'active' },
    { key: 'tasks', state: titling ? 'done' : 'waiting' },
    { key: 'title', state: titling ? 'active' : 'waiting' },
  ]
}

const pointsLabel = (count: number, t: (pl: string, en: string) => string): string => {
  const lastTwo = count % 100
  const last = count % 10
  const pl = count === 1 ? 'punkt' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'punkty' : 'punktów'
  return t(`${count} ${pl}`, `${count} ${count === 1 ? 'point' : 'points'}`)
}

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function ProgressBar({ fraction, reducedMotion }: { fraction: number; reducedMotion: boolean }) {
  const { colors } = useTheme()
  const progress = useRef(new Animated.Value(fraction)).current
  useEffect(() => {
    if (reducedMotion) { progress.setValue(fraction); return }
    Animated.timing(progress, { toValue: fraction, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [fraction, progress, reducedMotion])
  return (
    <View style={[styles.track, { backgroundColor: colors.track }]}>
      <Animated.View
        style={[styles.fill, { backgroundColor: colors.accent, transform: [{ scaleX: progress }] }]}
      />
    </View>
  )
}

function StageRow({ stage, label, detail }: { stage: StageState; label: string; detail?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.stage}>
      <View style={styles.marker}>
        {stage === 'done' ? (
          <Icon name="check" size={16} color={colors.accent} />
        ) : stage === 'active' ? (
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        ) : (
          <View style={[styles.dot, { borderWidth: 1.5, borderColor: colors.faint }]} />
        )}
      </View>
      <Text
        style={[
          type.meta,
          { color: stage === 'waiting' ? colors.secondary : colors.ink },
          stage === 'active' && { fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
      {detail ? <Text style={[type.meta, { color: colors.secondary }]}>{detail}</Text> : null}
    </View>
  )
}

// A new point fades in and settles 4 px; with Reduce Motion only the opacity changes.
function DraftRow({ text, animate, reducedMotion }: { text: string; animate: boolean; reducedMotion: boolean }) {
  const { colors } = useTheme()
  const enter = useRef(new Animated.Value(animate ? 0 : 1)).current
  useEffect(() => {
    if (!animate) return
    if (!reducedMotion) void Haptics.selectionAsync().catch(() => undefined)
    Animated.timing(enter, { toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [animate, enter, reducedMotion])
  return (
    <Animated.View
      style={[
        styles.point,
        { opacity: enter },
        reducedMotion ? null : { transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] },
      ]}
    >
      <Text style={[type.body, { color: colors.ink }]}>{'•'}</Text>
      <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{text}</Text>
    </Animated.View>
  )
}

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
  const fraction = liveTrailFraction(source)
  const summaryDetail = phase === 'queued' ? t('Czekam na model', 'Waiting for the model')
    : phase === 'loading' ? t('Wczytuję model', 'Loading the model')
      : draftCount ? pointsLabel(draftCount, t) : undefined
  const labels: Record<LiveStage['key'], string> = {
    transcript: t('Tekst nagrania', 'Recording text'),
    summary: t('Podsumowanie', 'Summary'),
    tasks: t('Zadania', 'Tasks'),
    title: t('Tytuł', 'Title'),
  }
  return (
    <View style={styles.container}>
      <View style={[styles.card, { backgroundColor: colors.field }]}>
        <View style={styles.cardHeader}>
          <Text style={[type.label, { color: colors.ink }]}>{t('Opracowuję notatkę', 'Processing the note')}</Text>
          <Text style={[type.meta, { color: colors.secondary, fontVariant: ['tabular-nums'] }]}>{formatElapsed(elapsed)}</Text>
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t(`Przeczytane ${Math.round(fraction * 100)}% notatki`, `${Math.round(fraction * 100)}% of the note read`)}
        >
          <ProgressBar fraction={fraction} reducedMotion={reducedMotion} />
        </View>
        <View style={styles.stages}>
          {liveStages(phase).map((stage) => (
            <StageRow
              key={stage.key}
              stage={stage.state}
              label={labels[stage.key]}
              detail={stage.key === 'summary' && stage.state === 'active' ? summaryDetail : undefined}
            />
          ))}
        </View>
      </View>
      {draftCount > 0 && (
        <View accessibilityLiveRegion="polite">
          <Text style={[type.caption, styles.heading, { color: colors.secondary }]}>{t('Podsumowanie', 'Summary')}</Text>
          <View style={styles.points}>
            {source.drafts.map((draft, index) => (
              <DraftRow key={index} text={draft.text} animate={index >= firstAnimated} reducedMotion={reducedMotion} />
            ))}
          </View>
        </View>
      )}
      <View>
        <Text style={[type.caption, styles.heading, { color: colors.secondary }]}>{t('Tekst nagrania', 'Recording text')}</Text>
        <Text style={[type.meta, { color: colors.ink, lineHeight: 22 }]}>{content}</Text>
      </View>
      <Text style={[type.caption, { color: colors.secondary, textAlign: 'center' }]}>
        {t('Możesz wyjść z ekranu — opracowanie trwa w tle', 'You can leave this screen; processing continues in the background')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 20 },
  card: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, width: '100%', transformOrigin: 'left center' },
  stages: { gap: 8 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  marker: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  heading: { textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
  points: { gap: 8 },
  point: { flexDirection: 'row', gap: 8 },
})
