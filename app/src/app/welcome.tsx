import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { Button } from '../ui/Button'
import { Icon, IconButton } from '../ui/Icon'
import { RevealText, useReducedMotion } from '../ui/Motion'
import { radius, spacing, type, useTheme } from '../ui/theme'

const ONBOARDING_PAGES = [
  {
    title: 'Notatki, które zostają u Ciebie',
    body: 'Nagrania i tekst zapisują się na Twoim telefonie. Bez konta i synchronizacji.',
  },
  {
    title: 'Mów. Tekst pojawia się na żywo.',
    body: 'Po nagraniu możesz poprawić każde zdanie. Transkrypcja działa na urządzeniu, gdy systemowy model mowy jest dostępny.',
  },
  {
    title: 'Mniej tekstu. Więcej konkretów.',
    body: 'Opcjonalny model AI tworzy tytuły i podsumowania na urządzeniu. Pobierz go teraz albo później w Ustawieniach.',
  },
] as const

const BAR_LEVELS = [
  0.24, 0.38, 0.55, 0.76, 0.92, 0.64, 0.48, 0.71, 0.89, 0.58, 0.36, 0.68, 0.84,
  0.53, 0.32,
]

const formatGb = (bytes: number): string =>
  `${(bytes / 1024 ** 3).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} GB`

const approximateModelSize = (): string =>
  formatGb(MODEL_CONFIG.approxSizeMb * 1024 ** 2)

function useDrift(
  active: boolean,
  distance: number,
): Animated.AnimatedInterpolation<number> {
  const reduced = useReducedMotion()
  const value = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active || reduced) {
      value.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 1450,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 1650,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [active, reduced, value])

  return value.interpolate({ inputRange: [0, 1], outputRange: [0, distance] })
}

function WaveformBars({
  active,
  color,
  compact = false,
}: {
  active: boolean
  color: string
  compact?: boolean
}) {
  const reduced = useReducedMotion()
  const bars = useRef(
    BAR_LEVELS.map((level) => new Animated.Value(level)),
  ).current

  useEffect(() => {
    if (!active || reduced) {
      bars.forEach((bar, index) => bar.setValue(BAR_LEVELS[index] ?? 0.5))
      return
    }
    const animations = bars.map((bar, index) => {
      const peak = 0.32 + ((index * 5) % 7) * 0.095
      return Animated.loop(
        Animated.sequence([
          Animated.delay(index * 34),
          Animated.timing(bar, {
            toValue: peak,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: BAR_LEVELS[index] ?? 0.5,
            duration: 420,
            useNativeDriver: true,
          }),
        ]),
      )
    })
    animations.forEach((animation) => animation.start())
    return () => animations.forEach((animation) => animation.stop())
  }, [active, bars, reduced])

  return (
    <View
      accessible
      accessibilityLabel="Przebieg fali dźwiękowej"
      style={[styles.waveBars, compact && styles.waveBarsCompact]}
    >
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveBar,
            compact ? styles.waveBarCompact : styles.waveBarLarge,
            { backgroundColor: color, transform: [{ scaleY: bar }] },
          ]}
        />
      ))}
    </View>
  )
}

function RecordingArt({ active }: { active: boolean }) {
  const { colors, isDark } = useTheme()
  const float = useDrift(active, -8)
  return (
    <LinearGradient
      colors={[colors.canvas, colors.accentSoft] as const}
      style={[styles.recordingArt, { borderColor: colors.line }]}
    >
      <View
        style={[
          styles.waveHalo,
          { backgroundColor: isDark ? '#8BB8F220' : '#3566A81A' },
        ]}
      />
      <View style={[styles.micOrb, { backgroundColor: colors.accentSoft }]}>
        <Icon name="mic" color={colors.accent} size={29} />
      </View>
      <View style={styles.heroWave}>
        <WaveformBars active={active} color={colors.accent} />
      </View>
      <Animated.View
        style={[
          styles.liveTranscriptCard,
          {
            backgroundColor: colors.paper,
            borderColor: colors.line,
            transform: [{ translateY: float }, { rotateZ: '2deg' }],
          },
        ]}
      >
        <View style={styles.cardMicRow}>
          <View
            style={[
              styles.cardMicBadge,
              { backgroundColor: colors.accentSoft },
            ]}
          >
            <Icon name="mic" color={colors.accent} size={17} />
          </View>
          <View
            style={[styles.timePill, { backgroundColor: colors.surface }]}
          />
        </View>
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '92%' },
          ]}
        />
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '76%' },
          ]}
        />
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '58%' },
          ]}
        />
      </Animated.View>
      <View
        style={[styles.connectionDot, { backgroundColor: colors.accent }]}
      />
    </LinearGradient>
  )
}

function TranscriptArt({ active }: { active: boolean }) {
  const { colors } = useTheme()
  const float = useDrift(active, -5)
  return (
    <LinearGradient
      colors={[colors.canvas, colors.accentSoft] as const}
      style={[styles.transcriptArt, { borderColor: colors.line }]}
    >
      <Animated.View
        style={[
          styles.transcriptCard,
          {
            backgroundColor: colors.paper,
            borderColor: colors.line,
            transform: [{ translateY: float }],
          },
        ]}
      >
        <View style={styles.cardMicRow}>
          <View
            style={[
              styles.cardMicBadge,
              { backgroundColor: colors.accentSoft },
            ]}
          >
            <Icon name="mic" color={colors.accent} size={17} />
          </View>
          <Text style={[styles.recordingTime, { color: colors.muted }]}>
            00:12
          </Text>
        </View>
        <RevealText
          text="Spotkanie z promotorem dotyczyło kolejnych kroków. Omówiliśmy plan na najbliższy tydzień."
          animate={active}
          style={[styles.transcriptText, { color: colors.body }]}
        />
        <WaveformBars active={active} color={colors.accent} compact />
      </Animated.View>
    </LinearGradient>
  )
}

function SummaryArt({ active }: { active: boolean }) {
  const { colors, isDark } = useTheme()
  const leftFloat = useDrift(active, 5)
  const rightFloat = useDrift(active, -7)
  return (
    <LinearGradient
      colors={[colors.canvas, colors.accentSoft] as const}
      style={[styles.summaryArt, { borderColor: colors.line }]}
    >
      <Animated.View
        style={[
          styles.sourceCard,
          {
            backgroundColor: colors.paper,
            borderColor: colors.line,
            transform: [{ translateY: leftFloat }, { rotateZ: '-7deg' }],
          },
        ]}
      >
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '64%' },
          ]}
        />
        <Text style={[styles.sourceCardTitle, { color: colors.ink }]}>
          Spotkanie z promotorem
        </Text>
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '95%' },
          ]}
        />
        <View
          style={[
            styles.artLine,
            { backgroundColor: colors.line, width: '78%' },
          ]}
        />
      </Animated.View>
      <Icon name="arrow-right" color={colors.accent} size={27} />
      <Animated.View
        style={[
          styles.summaryCard,
          {
            backgroundColor: colors.paper,
            borderColor: colors.line,
            transform: [{ translateY: rightFloat }, { rotateZ: '4deg' }],
          },
        ]}
      >
        <View style={styles.sparkleRow}>
          <Icon name="sparkles" color={colors.accent} size={23} />
          <View
            style={[
              styles.artLine,
              { backgroundColor: colors.line, width: '58%' },
            ]}
          />
        </View>
        <Text style={[styles.summaryCardTitle, { color: colors.ink }]}>
          Podsumowanie
        </Text>
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.summaryBulletRow}>
            <View
              style={[
                styles.summaryBullet,
                { backgroundColor: isDark ? '#8BB8F2' : '#3566A8' },
              ]}
            />
            <View
              style={[
                styles.artLine,
                {
                  backgroundColor: colors.line,
                  width: item === 2 ? '63%' : '82%',
                },
              ]}
            />
          </View>
        ))}
      </Animated.View>
    </LinearGradient>
  )
}

function OnboardingIllustration({
  page,
  active,
}: {
  page: number
  active: boolean
}) {
  if (page === 0) return <RecordingArt active={active} />
  if (page === 1) return <TranscriptArt active={active} />
  return <SummaryArt active={active} />
}

function PageHeader({
  page,
  onBack,
  onSkip,
  onSelectPage,
}: {
  page: number
  onBack: () => void
  onSkip: () => void
  onSelectPage: (page: number) => void
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.pageHeader}>
      {page > 0 ? (
        <IconButton
          name="chevron-left"
          label="Poprzedni krok"
          onPress={onBack}
          size={25}
        />
      ) : (
        <View style={styles.headerSideSpace} />
      )}
      <View style={styles.pageIndex}>
        <View style={styles.dots}>
          {ONBOARDING_PAGES.map((item, index) => (
            <Pressable
              key={item.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: page === index }}
              accessibilityLabel={`Krok ${index + 1} z ${ONBOARDING_PAGES.length}`}
              onPress={() => onSelectPage(index)}
              hitSlop={8}
              style={styles.dotHitTarget}
            >
              <View
                style={[
                  styles.dot,
                  page === index && styles.activeDot,
                  {
                    backgroundColor:
                      page === index ? colors.accent : colors.line,
                  },
                ]}
              />
            </Pressable>
          ))}
        </View>
        <Text style={[styles.pageCounter, { color: colors.muted }]}>
          {page + 1} z {ONBOARDING_PAGES.length}
        </Text>
      </View>
      <Pressable
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel="Pomiń wprowadzenie i przejdź do notatek"
        style={styles.skipButton}
      >
        <Text style={[styles.skipLabel, { color: colors.accent }]}>Pomiń</Text>
      </Pressable>
    </View>
  )
}

function ModelChoice({
  status,
  progress,
  isCancelling,
  onDownload,
}: {
  status: 'checking' | 'absent' | 'downloading' | 'ready'
  progress: number
  isCancelling: boolean
  onDownload: () => void
}) {
  const { colors } = useTheme()
  const size =
    status === 'ready'
      ? 'Pobrany na urządzenie'
      : `Około ${approximateModelSize()} do pobrania`
  return (
    <View
      style={[
        styles.modelChoice,
        { backgroundColor: colors.paper, borderColor: colors.line },
      ]}
    >
      <View
        style={[styles.modelChoiceIcon, { backgroundColor: colors.accentSoft }]}
      >
        <Icon name="sparkles" color={colors.accent} size={22} />
      </View>
      <View style={styles.modelChoiceIdentity}>
        <Text style={[styles.modelChoiceName, { color: colors.ink }]}>
          {MODEL_CONFIG.displayName}
        </Text>
        <Text style={[styles.modelChoiceSize, { color: colors.muted }]}>
          {size}
        </Text>
      </View>
      {status === 'ready' && (
        <Icon name="check" color={colors.accent} size={21} />
      )}
      {status === 'downloading' && (
        <Text style={[styles.modelChoiceProgress, { color: colors.accent }]}>
          {progress.toFixed(0)}%
        </Text>
      )}
      {status === 'checking' && (
        <Text style={[styles.modelChoiceProgress, { color: colors.muted }]}>
          …
        </Text>
      )}
      {status === 'downloading' && (
        <View
          style={[styles.modelProgressTrack, { backgroundColor: colors.line }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Pobieranie modelu AI"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
        >
          <View
            style={[
              styles.modelProgressFill,
              {
                backgroundColor: colors.accent,
                width: `${Math.min(100, Math.max(0, progress))}%`,
              },
            ]}
          />
        </View>
      )}
      {status === 'absent' && (
        <Button
          label={`Pobierz model · ${approximateModelSize()}`}
          variant="primary"
          icon="download"
          onPress={onDownload}
          style={styles.modelChoiceButton}
        />
      )}
      {status === 'checking' && (
        <Button
          label="Sprawdzanie modelu…"
          variant="secondary"
          busy
          disabled
          onPress={onDownload}
          style={styles.modelChoiceButton}
        />
      )}
      {status === 'downloading' && (
        <Text style={[styles.downloadingHint, { color: colors.muted }]}>
          {isCancelling
            ? 'Kończę anulowanie pobierania…'
            : 'Możesz przejść do notatek. Postęp zobaczysz także nad listą.'}
        </Text>
      )}
      {status === 'ready' && (
        <Text style={[styles.readyHint, { color: colors.success }]}>
          Gotowy do tworzenia tytułów i podsumowań offline.
        </Text>
      )}
    </View>
  )
}

export default function WelcomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const [page, setPage] = useState(0)
  const [isFinishing, setIsFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const finishLock = useRef(false)
  const pager = useRef<ScrollView>(null)
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const isCancelling = useModelStore((state) => state.isCancelling)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const completeOnboarding = useSettingsStore(
    (state) => state.completeOnboarding,
  )

  const goToPage = (target: number) => {
    const next = Math.max(0, Math.min(ONBOARDING_PAGES.length - 1, target))
    setPage(next)
    pager.current?.scrollTo({ x: next * width, animated: !reducedMotion })
  }

  const finish = async () => {
    if (finishLock.current) return
    finishLock.current = true
    setIsFinishing(true)
    setFinishError(null)
    try {
      await completeOnboarding()
      router.replace('/')
    } catch (caughtError) {
      finishLock.current = false
      setIsFinishing(false)
      setFinishError(
        caughtError instanceof Error
          ? caughtError.message
          : String(caughtError),
      )
    }
  }

  const pagePadding = {
    paddingTop: Math.max(insets.top, spacing.md) + spacing.sm,
    paddingBottom: Math.max(insets.bottom, spacing.md),
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen
        options={{ title: 'Witaj', headerShown: false, gestureEnabled: false }}
      />
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(
            event.nativeEvent.contentOffset.x / Math.max(1, width),
          )
          setPage(Math.max(0, Math.min(ONBOARDING_PAGES.length - 1, index)))
        }}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
      >
        {ONBOARDING_PAGES.map((item, index) => (
          <View key={item.title} style={{ width, flex: 1 }}>
            <ScrollView
              style={styles.verticalPage}
              contentContainerStyle={[styles.pageContent, pagePadding]}
              showsVerticalScrollIndicator={false}
            >
              <PageHeader
                page={index}
                onBack={() => goToPage(page - 1)}
                onSkip={() => void finish()}
                onSelectPage={goToPage}
              />
              <View style={styles.artFrame}>
                <OnboardingIllustration page={index} active={page === index} />
              </View>
              <Text
                style={[styles.pageTitle, { color: colors.ink }]}
                accessibilityRole="header"
              >
                {item.title}
              </Text>
              <Text style={[styles.pageBody, { color: colors.muted }]}>
                {item.body}
              </Text>

              {index === ONBOARDING_PAGES.length - 1 ? (
                <>
                  <View style={styles.finalModelArea}>
                    <ModelChoice
                      status={status}
                      progress={progress}
                      isCancelling={isCancelling}
                      onDownload={() => void download()}
                    />
                    {error && (
                      <Text
                        style={[styles.modelError, { color: colors.danger }]}
                        accessibilityRole="alert"
                      >
                        {error}
                      </Text>
                    )}
                    <Text
                      style={[styles.modelFootnote, { color: colors.muted }]}
                    >
                      Model pobierzesz też później w Ustawieniach.
                    </Text>
                  </View>
                  <View style={styles.footerSpacer} />
                  {status === 'ready' ? (
                    <Button
                      label={
                        isFinishing ? 'Otwieram notatki…' : 'Przejdź do notatek'
                      }
                      variant="primary"
                      icon="arrow-right"
                      onPress={() => void finish()}
                      disabled={isFinishing}
                      busy={isFinishing}
                    />
                  ) : (
                    <Button
                      label={
                        isFinishing
                          ? 'Otwieram notatki…'
                          : 'Pomiń i przejdź do notatek'
                      }
                      variant="quiet"
                      icon="arrow-right"
                      onPress={() => void finish()}
                      disabled={isFinishing}
                      busy={isFinishing}
                    />
                  )}
                  {finishError && (
                    <Text
                      style={[styles.modelError, { color: colors.danger }]}
                      accessibilityRole="alert"
                    >
                      {finishError}
                    </Text>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.footerSpacer} />
                  <Button
                    label={isFinishing ? 'Otwieram notatki…' : 'Dalej'}
                    variant="primary"
                    icon="arrow-right"
                    onPress={() => goToPage(page + 1)}
                    disabled={isFinishing}
                    busy={isFinishing}
                  />
                </>
              )}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pager: { flex: 1 },
  pagerContent: { flexGrow: 1 },
  verticalPage: { flex: 1 },
  pageContent: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.md },
  pageHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSideSpace: { width: 44, height: 44 },
  pageIndex: { flex: 1, alignItems: 'center', gap: 3 },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dotHitTarget: {
    width: 16,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  activeDot: { width: 19 },
  pageCounter: { ...type.meta },
  skipButton: {
    minWidth: 54,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipLabel: { ...type.body, fontSize: 15, fontWeight: '600' },
  artFrame: { marginTop: spacing.xs, marginBottom: spacing.sm },
  recordingArt: {
    height: 222,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  waveHalo: {
    position: 'absolute',
    left: -36,
    top: 22,
    width: 190,
    height: 190,
    borderRadius: radius.pill,
  },
  micOrb: {
    position: 'absolute',
    left: 28,
    top: 30,
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWave: { position: 'absolute', left: 9, top: 88 },
  waveBars: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 4 },
  waveBarsCompact: { height: 30, gap: 3, opacity: 0.72 },
  waveBar: { borderRadius: radius.pill },
  waveBarLarge: { width: 4, height: 58 },
  waveBarCompact: { width: 3, height: 23 },
  liveTranscriptCard: {
    position: 'absolute',
    right: 15,
    top: 36,
    width: '53%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  cardMicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMicBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePill: { width: 44, height: 8, borderRadius: radius.pill },
  artLine: { height: 8, borderRadius: radius.pill },
  connectionDot: {
    position: 'absolute',
    right: '39%',
    top: 111,
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: '#FFFFFF99',
  },
  transcriptArt: {
    minHeight: 222,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    justifyContent: 'center',
  },
  transcriptCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  recordingTime: { ...type.meta },
  transcriptText: { ...type.body, fontSize: 15, lineHeight: 22 },
  summaryArt: {
    height: 202,
    borderWidth: 1,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  sourceCard: {
    position: 'absolute',
    left: '7%',
    top: 48,
    width: '40%',
    minHeight: 111,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  sourceCardTitle: { ...type.label, fontSize: 12, lineHeight: 16 },
  summaryCard: {
    position: 'absolute',
    right: '6%',
    top: 25,
    width: '48%',
    minHeight: 142,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  sparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryCardTitle: { ...type.label, fontSize: 13 },
  summaryBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryBullet: { width: 6, height: 6, borderRadius: radius.pill },
  pageTitle: {
    ...type.display,
    fontSize: 29,
    lineHeight: 36,
    letterSpacing: -0.75,
    marginTop: spacing.xs,
  },
  pageBody: { ...type.body, fontSize: 16, lineHeight: 24 },
  footerSpacer: { flexGrow: 1, minHeight: spacing.sm },
  finalModelArea: { gap: spacing.sm, marginTop: spacing.xs },
  modelChoice: {
    minHeight: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modelChoiceIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelChoiceIdentity: { flex: 1, minWidth: 100, gap: 2 },
  modelChoiceName: { ...type.label, fontSize: 15 },
  modelChoiceSize: { ...type.meta },
  modelChoiceProgress: { ...type.label, fontSize: 13 },
  modelChoiceButton: { width: '100%' },
  modelProgressTrack: {
    height: 6,
    flexBasis: '100%',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  modelProgressFill: { height: '100%', borderRadius: radius.pill },
  downloadingHint: { ...type.meta, flexBasis: '100%' },
  readyHint: { ...type.meta, flexBasis: '100%' },
  modelFootnote: { ...type.meta, textAlign: 'center' },
  modelError: { ...type.meta, textAlign: 'left' },
})
