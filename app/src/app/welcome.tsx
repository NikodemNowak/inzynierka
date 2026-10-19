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
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { useI18n } from '../i18n/useI18n'
import type { Language } from '../i18n/language'
import { OnboardingArt, type OnboardingPage } from '../onboarding/OnboardingArt'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { fonts, radius, type, useTheme } from '../ui/theme'

// Each title ends with the words the highlighter marks.
const PAGES = [
  {
    title: ['Notatki, które\nzostają ', 'u Ciebie'],
    titleEn: ['Notes that\nstay ', 'with you'],
    body: 'Nagrania i tekst są tylko na tym telefonie. Bez konta, bez chmury, bez wysyłania gdziekolwiek.',
    bodyEn: 'Recordings and text live only on this phone. No account, no cloud, nothing sent anywhere.',
  },
  {
    title: ['Mówisz, a słowa\npojawiają się ', 'od razu'],
    titleEn: ['You speak, and the\nwords appear ', 'right away'],
    body: 'Rozpoznawanie mowy działa na telefonie. Możesz zgasić ekran — nagrywanie trwa dalej.',
    bodyEn: 'Speech recognition runs on the phone. You can turn the screen off — recording keeps going.',
  },
  {
    title: ['Mniej tekstu,\n', 'więcej sensu'],
    titleEn: ['Less text,\n', 'more meaning'],
    body: 'Model na telefonie zakreśla najważniejsze i robi z tego streszczenie i tytuł. Każdy punkt pokazuje, skąd pochodzi.',
    bodyEn: 'A model on the phone highlights what matters and turns it into a summary and a title. Every point shows where it came from.',
  },
  {
    title: ['Zapytaj swoje\n', 'notatki'],
    titleEn: ['Ask your\n', 'notes'],
    body: 'Odpowiedź powstaje na telefonie, tylko z Twoich notatek. Zawsze widzisz, z którego nagrania pochodzi.',
    bodyEn: 'The answer is written on the phone, only from your notes. You always see which recording it came from.',
  },
  {
    title: ['Zadania\n', 'same się wyłapują'],
    titleEn: ['Tasks get\n', 'picked up for you'],
    body: 'Z notatki dostaniesz propozycje zadań z terminami. Ty decydujesz, które zostają i czy dodać je do Przypomnień.',
    bodyEn: 'Each note offers task suggestions with due dates. You decide which stay and whether they go to Reminders.',
  },
] as const
const LAST = PAGES.length - 1
const modelName = MODEL_CONFIG.displayName.replace(/\s*\([^)]*\)$/, '')

export default function WelcomeScreen() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width, height, fontScale } = useWindowDimensions()
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const [page, setPage] = useState(0)
  const [isFinishing, setIsFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [micNote, setMicNote] = useState<string | null>(null)
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const finishLock = useRef(false)
  const pager = useRef<ScrollView>(null)
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const noteLanguage = useSettingsStore((state) => state.noteLanguage)
  const setNoteLanguage = useSettingsStore((state) => state.setNoteLanguage)
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding)
  const modelSize = `${(MODEL_CONFIG.approxSizeMb / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
  const contentWidth = Math.min(width - 48, 420)
  const artHeight = Math.min(contentWidth * 0.9, height * 0.36)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setAppActive(next === 'active'))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    pager.current?.scrollTo({ x: page * width, animated: false })
  }, [width])

  const goToPage = (target: number) => {
    const next = Math.max(0, Math.min(LAST, target))
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
  const enableMicrophone = async () => {
    setMicNote(null)
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permission.granted) {
        setMicNote(t(
          'Bez dostępu nagrywanie nie zadziała. Możesz go włączyć później w ustawieniach systemu.',
          'Recording needs this access. You can turn it on later in the system settings.',
        ))
        return
      }
    } catch {
      // Unsupported here (e.g. simulator); recording asks again later.
    }
    goToPage(2)
  }
  const startDownload = () => {
    void download()
    goToPage(3)
  }

  const languages: { value: Language; label: string }[] = [
    { value: 'pl', label: 'Polski' },
    { value: 'en', label: 'English' },
  ]
  const modelLine = status === 'ready'
    ? t('Gotowy na telefonie', 'Ready on this phone')
    : status === 'downloading'
      ? t(`Pobieram · ${Math.round(progress)}%`, `Downloading · ${Math.round(progress)}%`)
      : status === 'checking'
        ? t('Sprawdzam…', 'Checking…')
        : t(`${modelSize} · raz, najlepiej przez Wi-Fi`, `${modelSize} · once, ideally on Wi-Fi`)

  const footer = () => {
    if (page === 1) return (
      <>
        <Button label={t('Włącz mikrofon', 'Turn on the microphone')} icon="mic" variant="primary" onPress={() => void enableMicrophone()} disabled={isFinishing} />
        <Text style={[styles.caption, { color: micNote ? colors.ember : colors.muted }]}>
          {micNote ?? t('Telefon zapyta o mikrofon i rozpoznawanie mowy.', 'The phone will ask for the microphone and speech recognition.')}
        </Text>
        {micNote && <Button label={t('Dalej', 'Next')} variant="quiet" onPress={() => goToPage(2)} />}
      </>
    )
    if (page === 2 && status !== 'ready' && status !== 'downloading') return (
      <>
        <Button label={t('Pobierz model', 'Download the model')} variant="primary" onPress={startDownload} disabled={isFinishing || status === 'checking'} busy={status === 'checking'} />
        <Button label={t('Później — w ustawieniach', 'Later — in Settings')} variant="quiet" onPress={() => goToPage(3)} disabled={isFinishing} />
      </>
    )
    if (page === LAST) return (
      <>
        <Button label={t('Przejdź do notatek', 'Go to notes')} variant="primary" onPress={() => void finish()} disabled={isFinishing} busy={isFinishing} />
        {status === 'downloading' && (
          <Text style={[styles.caption, { color: colors.muted }]}>{t('Pobieranie trwa dalej w tle.', 'The download continues in the background.')}</Text>
        )}
      </>
    )
    return <Button label={t('Dalej', 'Next')} variant="primary" onPress={() => goToPage(page + 1)} disabled={isFinishing} />
  }

  const modelCard = (
    <View style={[styles.modelCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
      <View style={styles.modelRow}>
        <Text style={[styles.modelName, { color: colors.ink }]}>{modelName}</Text>
        <Text style={[type.meta, { fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'] }]}>{modelLine}</Text>
      </View>
      {(status === 'downloading' || status === 'ready') && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('Pobieranie modelu', 'Downloading model')}
          accessibilityValue={{ min: 0, max: 100, now: status === 'ready' ? 100 : Math.round(progress) }}
          style={[styles.track, { backgroundColor: colors.surface }]}
        >
          <View style={[styles.trackInk, { backgroundColor: colors.marker, width: `${status === 'ready' ? 100 : Math.min(100, Math.max(0, progress))}%` }]} />
        </View>
      )}
      {page === LAST && status !== 'ready' && status !== 'downloading' && (
        <Text style={[type.meta, { color: colors.muted }]}>{t('Model pobierzesz w Ustawieniach. Nagrywać możesz już teraz.', 'Download the model in Settings. You can record right away.')}</Text>
      )}
      {error && <Text accessibilityRole="alert" style={[type.meta, { color: colors.danger }]}>{error}</Text>}
    </View>
  )

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen options={{ title: t('Witaj', 'Welcome'), headerShown: false, gestureEnabled: false }} />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <View style={styles.headerSide}>
          {page > 0 && (
            <IconButton name="chevron-left" label={t('Poprzedni krok', 'Previous step')} onPress={() => goToPage(page - 1)} disabled={isFinishing} size={25} />
          )}
        </View>
        <View style={styles.steps} accessibilityLabel={t(`Krok ${page + 1} z ${PAGES.length}`, `Step ${page + 1} of ${PAGES.length}`)}>
          {PAGES.map((_, index) => (
            <Pressable
              key={index}
              onPress={() => goToPage(index)}
              disabled={isFinishing}
              accessibilityRole="tab"
              accessibilityLabel={t(`Krok ${index + 1} z ${PAGES.length}`, `Step ${index + 1} of ${PAGES.length}`)}
              accessibilityState={{ selected: page === index }}
              hitSlop={8}
              style={styles.stepTarget}
            >
              <View
                style={[
                  styles.step,
                  page === index
                    ? { width: 28, backgroundColor: colors.marker, borderColor: colors.markerLine, borderWidth: 1 }
                    : { backgroundColor: index < page ? colors.ink : colors.line },
                ]}
              />
            </Pressable>
          ))}
        </View>
        {page === LAST ? (
          <View style={styles.headerSide} />
        ) : (
          <Pressable
            disabled={isFinishing}
            onPress={() => void finish()}
            accessibilityRole="button"
            accessibilityLabel={t('Pomiń wprowadzenie i przejdź do notatek', 'Skip introduction and go to notes')}
            style={styles.headerSide}
          >
            <Text style={[styles.skip, { color: colors.muted }]}>{t('Pomiń', 'Skip')}</Text>
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
        onMomentumScrollEnd={(e) => setPage(Math.max(0, Math.min(LAST, Math.round(e.nativeEvent.contentOffset.x / width))))}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
      >
        {PAGES.map((item, index) => {
          const [lead, marked] = t(item.title.join('|'), item.titleEn.join('|')).split('|')
          const titleSize = Math.min(34, contentWidth * 0.092)
          return (
            <View key={index} style={{ width, flex: 1 }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.pageContent, { paddingTop: Math.max(12, height * 0.03) }]}>
                <View style={{ width: contentWidth, alignSelf: 'center' }}>
                  <View style={{ height: index === 1 ? artHeight * 0.78 : artHeight, marginBottom: index === 1 ? 18 : 26 }}>
                    <OnboardingArt page={index as OnboardingPage} animate={page === index && appActive && !reducedMotion} />
                  </View>
                  <Text accessibilityRole="header" style={[type.display, { color: colors.ink, fontSize: titleSize, lineHeight: titleSize * 1.14 }]}>
                    {fontScale > 1.15 ? lead.replace('\n', ' ') : lead}
                    <Text style={{ backgroundColor: colors.marker, color: colors.onMarker }}>{marked}</Text>
                  </Text>
                  <Text style={[styles.body, { color: colors.body }]}>{t(item.body, item.bodyEn)}</Text>
                  {index === 1 && (
                    <View style={styles.language}>
                      <Text style={[type.label, { fontSize: 13, color: colors.muted }]}>{t('W jakim języku mówisz?', 'Which language do you speak?')}</Text>
                      <View style={[styles.segment, { backgroundColor: colors.surface }]} accessibilityRole="radiogroup">
                        {languages.map((option) => {
                          const selected = noteLanguage === option.value
                          return (
                            <Pressable
                              key={option.value}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selected }}
                              onPress={() => void setNoteLanguage(option.value)}
                              style={[styles.segmentOption, selected && { backgroundColor: colors.raised }]}
                            >
                              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: selected ? colors.ink : colors.muted }}>{option.label}</Text>
                            </Pressable>
                          )
                        })}
                      </View>
                    </View>
                  )}
                  {(index === 2 || index === LAST) && <View style={{ marginTop: 18 }}>{modelCard}</View>}
                </View>
              </ScrollView>
            </View>
          )
        })}
      </ScrollView>
      <View style={[styles.footer, { width: contentWidth, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {finishError && <Text accessibilityRole="alert" style={[type.meta, { color: colors.danger }]}>{finishError}</Text>}
        {footer()}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', paddingBottom: 4 },
  headerSide: { width: 64, minHeight: 54, justifyContent: 'center', alignItems: 'center' },
  steps: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  stepTarget: { height: 24, justifyContent: 'center' },
  step: { width: 14, height: 6, borderRadius: 3 },
  skip: { fontFamily: fonts.semibold, fontSize: 15 },
  pager: { flex: 1 },
  pagerContent: { flexGrow: 1 },
  pageContent: { paddingBottom: 16, paddingHorizontal: 24 },
  body: { ...type.body, fontSize: 17, lineHeight: 25, marginTop: 14 },
  language: { marginTop: 18, gap: 8 },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 3 },
  segmentOption: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modelCard: { borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 10 },
  modelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  modelName: { fontFamily: fonts.semibold, fontSize: 16 },
  track: { height: 10, borderRadius: 3, overflow: 'hidden' },
  trackInk: { height: 10, borderTopRightRadius: 6, borderBottomRightRadius: 2 },
  footer: { alignSelf: 'center', paddingTop: 10, gap: 8 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
})
