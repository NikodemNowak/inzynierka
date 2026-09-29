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
import { useTheme } from '../ui/theme'

const PAGES = [
  {
    title: 'Notatki, które\nzostają u Ciebie',
    body: 'Nagrania i tekst zapisują się\nna Twoim telefonie. Bez konta.',
  },
  {
    title: 'Mów. Tekst\npojawia się na żywo.',
    body: 'Po nagraniu możesz poprawić\nkażde zdanie.',
  },
  {
    title: 'Mniej tekstu.\nWięcej konkretów.',
    body: 'Opcjonalny model tworzy tytuły\ni podsumowania offline.',
  },
] as const
const modelSize = `${(MODEL_CONFIG.approxSizeMb / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} GB`
const modelName = MODEL_CONFIG.displayName.replace(/\s*\([^)]*\)$/, '')

export default function WelcomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height, fontScale } = useWindowDimensions()
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
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const completeOnboarding = useSettingsStore(
    (state) => state.completeOnboarding,
  )
  const lastPage = page === 2
  const contentWidth = Math.min(width - 48, 420)
  const artHeight = Math.min(contentWidth * 0.88, height * 0.34)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setAppActive(next === 'active'),
    )
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    pager.current?.scrollTo({ x: page * width, animated: false })
  }, [width])

  const goToPage = (target: number) => {
    const next = Math.max(0, Math.min(2, target))
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
    } catch (caught) {
      finishLock.current = false
      setIsFinishing(false)
      setFinishError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen
        options={{ title: 'Witaj', headerShown: false, gestureEnabled: false }}
      />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={styles.headerSide}>
          {page > 0 && (
            <IconButton
              name="chevron-left"
              label="Poprzedni krok"
              onPress={() => goToPage(page - 1)}
              disabled={isFinishing}
              size={25}
            />
          )}
        </View>
        <View style={styles.pageIndex}>
          <View style={styles.dots}>
            {PAGES.map((item, i) => (
              <Pressable
                key={item.title}
                onPress={() => goToPage(i)}
                disabled={isFinishing}
                accessibilityRole="tab"
                accessibilityLabel={`Krok ${i + 1} z 3`}
                accessibilityState={{
                  selected: page === i,
                  disabled: isFinishing,
                }}
                hitSlop={8}
                style={styles.dotTarget}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: page === i ? colors.accent : colors.line,
                    },
                  ]}
                />
              </Pressable>
            ))}
          </View>
          <Text style={[styles.counter, { color: colors.muted }]}>
            {page + 1} z 3
          </Text>
        </View>
        {lastPage ? (
          <View style={styles.headerSide} />
        ) : (
          <Pressable
            disabled={isFinishing}
            onPress={() => void finish()}
            accessibilityRole="button"
            accessibilityLabel="Pomiń wprowadzenie i przejdź do notatek"
            style={styles.headerSide}
          >
            <Text style={[styles.skip, { color: colors.accent }]}>Pomiń</Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!isFinishing}
        onMomentumScrollEnd={(e) =>
          setPage(
            Math.max(
              0,
              Math.min(2, Math.round(e.nativeEvent.contentOffset.x / width)),
            ),
          )
        }
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
      >
        {PAGES.map((item, index) => (
          <View key={item.title} style={{ width, flex: 1 }}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.pageContent,
                {
                  paddingTop: index === 2 ? 14 : Math.max(20, height * 0.055),
                  paddingBottom: index === 2 ? Math.max(insets.bottom, 20) : 20,
                },
              ]}
            >
              <View style={{ width: contentWidth, alignSelf: 'center' }}>
                <View
                  style={{
                    height: index === 2 ? artHeight * 0.88 : artHeight,
                    marginBottom: index === 2 ? 24 : 30,
                  }}
                >
                  <OnboardingIllustration
                    page={index as 0 | 1 | 2}
                    active={page === index}
                    appActive={appActive}
                  />
                </View>
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.title,
                    {
                      color: colors.ink,
                      fontSize: Math.min(35, contentWidth * 0.095),
                      lineHeight: Math.min(41, contentWidth * 0.113),
                    },
                  ]}
                >
                  {fontScale > 1.15
                    ? item.title.replace('\n', ' ')
                    : item.title}
                </Text>
                <Text style={[styles.body, { color: colors.muted }]}>
                  {fontScale > 1.15 ? item.body.replace('\n', ' ') : item.body}
                </Text>
                {index === 2 && (
                  <View style={styles.modelActions}>
                    <View
                      style={[
                        styles.model,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.line,
                        },
                      ]}
                    >
                      <Icon name="sparkles" size={29} color={colors.accent} />
                      <Text style={[styles.modelName, { color: colors.ink }]}>
                        {modelName}
                      </Text>
                      <Text style={[styles.modelSize, { color: colors.muted }]}>
                        {status === 'ready'
                          ? 'Pobrany'
                          : status === 'downloading'
                            ? `${Math.round(progress)}%`
                            : status === 'checking'
                              ? 'Sprawdzam…'
                              : `Około ${modelSize}`}
                      </Text>
                      {status === 'downloading' && (
                        <View
                          accessibilityRole="progressbar"
                          accessibilityLabel="Pobieranie modelu"
                          accessibilityValue={{
                            min: 0,
                            max: 100,
                            now: Math.round(progress),
                          }}
                          style={[
                            styles.progressTrack,
                            { backgroundColor: colors.line },
                          ]}
                        >
                          <View
                            style={{
                              height: 3,
                              backgroundColor: colors.accent,
                              width: `${Math.min(100, Math.max(0, progress))}%`,
                            }}
                          />
                        </View>
                      )}
                    </View>
                    {error && (
                      <Text
                        accessibilityRole="alert"
                        style={[styles.error, { color: colors.danger }]}
                      >
                        {error}
                      </Text>
                    )}
                    <Button
                      label={
                        status === 'ready' || status === 'downloading'
                          ? 'Przejdź do notatek'
                          : status === 'checking'
                            ? 'Sprawdzanie modelu…'
                            : 'Pobierz model'
                      }
                      variant="primary"
                      disabled={isFinishing || status === 'checking'}
                      busy={isFinishing || status === 'checking'}
                      onPress={() =>
                        status === 'ready' || status === 'downloading'
                          ? void finish()
                          : void download()
                      }
                      style={styles.cta}
                    />
                    {status !== 'ready' && status !== 'downloading' && (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isFinishing}
                        onPress={() => void finish()}
                        style={styles.skipFinal}
                      >
                        <Text
                          style={[
                            styles.skipFinalText,
                            { color: colors.accent },
                          ]}
                        >
                          Pomiń i przejdź do notatek
                        </Text>
                      </Pressable>
                    )}
                    {status !== 'ready' && (
                      <Text style={[styles.footnote, { color: colors.muted }]}>
                        {status === 'downloading'
                          ? 'Postęp pobierania zobaczysz nad listą notatek.'
                          : 'Model pobierzesz też w Ustawieniach.'}
                      </Text>
                    )}
                    {finishError && (
                      <Text
                        accessibilityRole="alert"
                        style={[styles.error, { color: colors.danger }]}
                      >
                        {finishError}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        ))}
      </ScrollView>
      {!lastPage && (
        <View
          style={[
            styles.footer,
            {
              width: contentWidth,
              paddingBottom: Math.max(insets.bottom, 20) + 24,
            },
          ]}
        >
          {finishError && (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.danger }]}
            >
              {finishError}
            </Text>
          )}
          <Button
            label="Dalej"
            variant="primary"
            onPress={() => goToPage(page + 1)}
            disabled={isFinishing}
            style={styles.cta}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 4,
  },
  headerSide: {
    width: 60,
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageIndex: { flex: 1, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 4 },
  dotTarget: {
    width: 18,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  counter: { fontSize: 12, lineHeight: 18 },
  skip: { fontSize: 15 },
  pager: { flex: 1 },
  pagerContent: { flexGrow: 1 },
  pageContent: { paddingBottom: 20, paddingHorizontal: 24 },
  title: { fontWeight: '700', letterSpacing: -1.1 },
  body: { fontSize: 19, lineHeight: 26, marginTop: 18 },
  footer: { alignSelf: 'center', paddingTop: 10, gap: 14 },
  cta: { borderRadius: 11, minHeight: 53 },
  modelActions: { marginTop: 22, gap: 14, paddingBottom: 24 },
  model: {
    minHeight: 57,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  modelName: { flex: 1, fontSize: 15, fontWeight: '600' },
  modelSize: { fontSize: 13 },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  skipFinal: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  skipFinalText: { fontSize: 15, textAlign: 'center' },
  footnote: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  error: { fontSize: 13, lineHeight: 19 },
})
