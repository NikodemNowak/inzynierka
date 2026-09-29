import { useEffect, useRef, useState } from 'react'
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { OnboardingIllustration } from '../onboarding/OnboardingIllustrations'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { Button } from '../ui/Button'
import { Icon, IconButton } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { radius, spacing, type, useTheme } from '../ui/theme'

const ONBOARDING_PAGES = [
  {
    title: 'Notatki, które zostają u Ciebie',
    body: 'Nagranie i tekst zapisują się na tym telefonie. Nie potrzebujesz konta.',
  },
  {
    title: 'Mów. Tekst pojawia się na żywo.',
    body: 'Zamieniaj głos w tekst podczas nagrania. Po zatrzymaniu możesz poprawić każde zdanie.',
  },
  {
    title: 'Mniej tekstu. Więcej konkretów.',
    body: 'Opcjonalny model działa na urządzeniu i pomaga przygotować tytuł oraz podsumowanie. Pobierz go teraz albo później w Ustawieniach.',
  },
] as const

const formatGb = (bytes: number): string =>
  `${(bytes / 1024 ** 3).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} GB`

const approximateModelSize = (): string =>
  formatGb(MODEL_CONFIG.approxSizeMb * 1024 ** 2)
function PageHeader({
  page,
  onBack,
  onSkip,
  onSelectPage,
  disabled,
}: {
  page: number
  onBack: () => void
  onSkip: () => void
  onSelectPage: (page: number) => void
  disabled: boolean
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.pageHeader}>
      {page > 0 ? (
        <IconButton
          name="chevron-left"
          label="Poprzedni krok"
          onPress={onBack}
          disabled={disabled}
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
              accessibilityLabel={`Krok ${index + 1} z ${ONBOARDING_PAGES.length}`}
              accessibilityState={{ selected: page === index, disabled }}
              disabled={disabled}
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
        accessibilityState={{ disabled }}
        disabled={disabled}
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
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppActive(nextState === 'active')
    })
    return () => subscription.remove()
  }, [])

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
      router.dismissTo('/')
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

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen
        options={{ title: 'Witaj', headerShown: false, gestureEnabled: false }}
      />
      <View
        style={[
          styles.topBar,
          { paddingTop: Math.max(insets.top, spacing.sm) },
        ]}
      >
        <PageHeader
          page={page}
          onBack={() => goToPage(page - 1)}
          onSkip={() => void finish()}
          onSelectPage={goToPage}
          disabled={isFinishing}
        />
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!isFinishing}
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
              contentContainerStyle={styles.pageContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              <View style={styles.artFrame}>
                <OnboardingIllustration
                  page={index as 0 | 1 | 2}
                  active={page === index}
                  appActive={appActive}
                />
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

              {index === ONBOARDING_PAGES.length - 1 && (
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
                  {status !== 'ready' && (
                    <Text style={[styles.modelFootnote, { color: colors.muted }]}>
                      Model pobierzesz też później w Ustawieniach.
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.canvas,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
      >
        {finishError && (
          <Text
            style={[styles.finishError, { color: colors.danger }]}
            accessibilityRole="alert"
          >
            {finishError}
          </Text>
        )}
        {page < ONBOARDING_PAGES.length - 1 ? (
          <Button
            label="Dalej"
            variant="primary"
            icon="arrow-right"
            onPress={() => goToPage(page + 1)}
            disabled={isFinishing}
          />
        ) : (
          <Button
            label={
              isFinishing
                ? 'Otwieram notatki…'
                : status === 'ready' || status === 'downloading'
                  ? 'Przejdź do notatek'
                  : 'Pomiń i przejdź do notatek'
            }
            variant={
              status === 'ready' || status === 'downloading'
                ? 'primary'
                : 'quiet'
            }
            icon="arrow-right"
            onPress={() => void finish()}
            disabled={isFinishing}
            busy={isFinishing}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xs },
  pager: { flex: 1 },
  pagerContent: { flexGrow: 1 },
  verticalPage: { flex: 1 },
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
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
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipLabel: { ...type.body, fontSize: 15, fontWeight: '600' },
  artFrame: { minHeight: 224, justifyContent: 'center' },
  pageTitle: {
    ...type.display,
    fontSize: 29,
    lineHeight: 36,
    letterSpacing: -0.75,
    marginTop: spacing.xs,
  },
  pageBody: { ...type.body, fontSize: 16, lineHeight: 24 },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
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
  modelChoiceProgress: {
    ...type.label,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
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
  finishError: { ...type.body, fontSize: 14, marginBottom: spacing.sm },
})
