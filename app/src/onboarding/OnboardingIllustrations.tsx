import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../ui/Icon'
import { RevealText, useReducedMotion } from '../ui/Motion'
import { radius, spacing, type, useTheme } from '../ui/theme'

type OnboardingPage = 0 | 1 | 2

const WAVE_LEVELS = [0.25, 0.43, 0.66, 0.9, 0.64, 0.38, 0.73, 1, 0.68, 0.42, 0.81, 0.52, 0.31]

export function OnboardingIllustration({
  page,
  active,
  appActive,
}: {
  page: OnboardingPage
  active: boolean
  appActive: boolean
}) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const entrance = useRef(new Animated.Value(1)).current
  const hasEntered = useRef(false)

  useLayoutEffect(() => {
    if (!active || !appActive || reducedMotion || hasEntered.current) {
      entrance.stopAnimation()
      if (hasEntered.current || reducedMotion) entrance.setValue(1)
      if (reducedMotion && active) hasEntered.current = true
      return
    }

    hasEntered.current = true
    entrance.setValue(0)
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [active, appActive, entrance, reducedMotion])

  const translateY = entrance.interpolate({ inputRange: [0, 1], outputRange: [9, 0] })
  const description = [
    'Przykład prywatnej notatki na telefonie',
    'Przykład tekstu z dyktowania',
    'Przykład uporządkowanej notatki',
  ][page]

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={description}
      style={[styles.scene, { opacity: entrance, transform: [{ translateY }] }]}
    >
      {page === 0 ? (
        <PrivateNoteIllustration />
      ) : page === 1 ? (
        <DictationIllustration
          active={active}
          appActive={appActive}
          reducedMotion={reducedMotion}
        />
      ) : (
        <SummaryIllustration />
      )}
    </Animated.View>
  )
}

function PrivateNoteIllustration() {
  const { colors } = useTheme()
  return (
    <View style={[styles.phone, { backgroundColor: colors.paper, borderColor: colors.line }]}>
      <View style={[styles.phoneSpeaker, { backgroundColor: colors.line }]} />
      <View style={styles.phoneHeader}>
        <View style={styles.phoneHeaderTitle}>
          <Icon name="note" color={colors.accent} size={17} />
          <Text style={[styles.phoneLabel, { color: colors.ink }]}>Notatka</Text>
        </View>
        <Icon name="lock" color={colors.accent} size={16} />
      </View>
      <Text style={[styles.phoneTitle, { color: colors.ink }]}>Pomysł na projekt</Text>
      <View style={[styles.phoneLine, { backgroundColor: colors.line }]} />
      <View style={[styles.phoneLine, styles.phoneLineShort, { backgroundColor: colors.line }]} />
      <View style={[styles.phoneLine, styles.phoneLineMedium, { backgroundColor: colors.line }]} />
      <View style={[styles.privateBadge, { backgroundColor: colors.accentSoft }]}>
        <Icon name="shield" color={colors.accent} size={13} />
        <Text style={[styles.privateLabel, { color: colors.accent }]}>Tylko na tym telefonie</Text>
      </View>
    </View>
  )
}

function DictationIllustration({
  active,
  appActive,
  reducedMotion,
}: {
  active: boolean
  appActive: boolean
  reducedMotion: boolean
}) {
  const { colors } = useTheme()
  const [animateTail, setAnimateTail] = useState(false)
  const hasRevealed = useRef(false)

  useEffect(() => {
    if (!active || !appActive || reducedMotion) {
      setAnimateTail(false)
      return
    }
    if (!hasRevealed.current) {
      hasRevealed.current = true
      setAnimateTail(true)
    }
  }, [active, appActive, reducedMotion])

  return (
    <View style={[styles.dictationCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
      <View style={styles.dictationHeader}>
        <View style={[styles.micBadge, { backgroundColor: colors.accentSoft }]}>
          <Icon name="mic" color={colors.accent} size={18} />
        </View>
        <Text style={[styles.dictationLabel, { color: colors.muted }]}>Dyktowanie</Text>
        <Text style={[styles.timeLabel, { color: colors.muted }]}>00:12</Text>
      </View>
      <Waveform color={colors.accent} />
      <RevealText
        text="Omówmy plan na najbliższy tydzień."
        animate={animateTail}
        style={[styles.transcript, { color: colors.body }]}
      />
    </View>
  )
}

function Waveform({ color }: { color: string }) {
  return (
    <View
      accessible
      accessibilityLabel="Przykładowy przebieg dźwięku"
      style={styles.waveform}
    >
      {WAVE_LEVELS.map((level, index) => (
        <View
          key={index}
          style={{
            width: 4,
            height: 34 * level,
            borderRadius: radius.pill,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  )
}

function SummaryIllustration() {
  const { colors } = useTheme()
  return (
    <View style={styles.summaryFlow}>
      <View style={[styles.sourceCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
        <View style={styles.summaryCardHeader}>
          <Icon name="note" color={colors.muted} size={15} />
          <Text style={[styles.smallCardLabel, { color: colors.muted }]}>Notatka</Text>
        </View>
        <Text style={[styles.sourceTitle, { color: colors.ink }]}>Spotkanie</Text>
        <View style={[styles.summaryLine, { backgroundColor: colors.line }]} />
        <View style={[styles.summaryLine, styles.summaryLineShort, { backgroundColor: colors.line }]} />
        <View style={[styles.summaryLine, styles.summaryLineMedium, { backgroundColor: colors.line }]} />
      </View>
      <Icon name="arrow-right" color={colors.accent} size={20} />
      <View style={[styles.resultCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
        <View style={styles.summaryCardHeader}>
          <Icon name="sparkles" color={colors.accent} size={15} />
          <Text style={[styles.smallCardLabel, { color: colors.accent }]}>Opracowanie</Text>
        </View>
        <Text style={[styles.resultTitle, { color: colors.ink }]}>Tytuł</Text>
        <Text style={[styles.resultText, { color: colors.body }]}>Plan projektu</Text>
        <View style={[styles.summaryLine, { backgroundColor: colors.line }]} />
        <View style={styles.summaryBulletRow}>
          <View style={[styles.summaryBullet, { backgroundColor: colors.accent }]} />
          <View style={[styles.summaryLine, { backgroundColor: colors.line, flex: 1 }]} />
        </View>
        <View style={styles.summaryBulletRow}>
          <View style={[styles.summaryBullet, { backgroundColor: colors.accent }]} />
          <View style={[styles.summaryLine, styles.summaryLineMedium, { backgroundColor: colors.line }]} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scene: {
    minHeight: 224,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: {
    width: 164,
    minHeight: 214,
    borderWidth: 1.5,
    borderRadius: 28,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 13,
    alignItems: 'stretch',
    gap: 9,
  },
  phoneSpeaker: {
    alignSelf: 'center',
    width: 32,
    height: 3,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  phoneHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phoneHeaderTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phoneLabel: { ...type.label, fontSize: 12 },
  phoneTitle: { ...type.label, fontSize: 13, marginTop: 3 },
  phoneLine: { height: 6, borderRadius: radius.pill, width: '100%' },
  phoneLineShort: { width: '73%' },
  phoneLineMedium: { width: '86%' },
  privateBadge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  privateLabel: { ...type.meta, fontSize: 10, fontWeight: '600', flexShrink: 1 },
  dictationCard: {
    width: '100%',
    minHeight: 190,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dictationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  micBadge: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dictationLabel: { ...type.label, flex: 1, fontSize: 13 },
  timeLabel: { ...type.meta, fontVariant: ['tabular-nums'] },
  waveform: { height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  transcript: { ...type.body, fontSize: 17, lineHeight: 25 },
  summaryFlow: {
    width: '100%',
    minHeight: 206,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sourceCard: {
    flex: 1,
    minHeight: 132,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  resultCard: {
    flex: 1.23,
    minHeight: 158,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: 'center',
    gap: 5,
  },
  summaryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  smallCardLabel: { ...type.meta, fontSize: 10, fontWeight: '600' },
  sourceTitle: { ...type.label, fontSize: 12, lineHeight: 17 },
  resultTitle: { ...type.meta, fontSize: 10, fontWeight: '600', marginTop: 2 },
  resultText: { ...type.label, fontSize: 12, lineHeight: 16 },
  summaryLine: { height: 5, borderRadius: radius.pill, width: '100%' },
  summaryLineShort: { width: '63%' },
  summaryLineMedium: { width: '82%' },
  summaryBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryBullet: { width: 5, height: 5, borderRadius: radius.pill },
})
