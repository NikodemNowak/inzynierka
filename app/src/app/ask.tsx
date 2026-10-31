import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AskSource } from '../ask/askAnswer'
import { useAskStore, type AskMessage } from '../ask/askStore'
import { EMBEDDING_MODEL } from '../ask/embeddingModel'
import { useSearchModelStore } from '../ask/searchModel'
import { useVectorIndexStore } from '../ask/vectorStore'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { useI18n } from '../i18n/useI18n'
import { ModelDownloadBanner } from '../notes/ModelDownloadBanner'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { Icon, IconButton } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { radius, spacing, type, useTheme, type ThemeColors } from '../ui/theme'

const EXAMPLES = {
  pl: ['Co mam dzisiaj do zrobienia?', 'Co mam w tym tygodniu?', 'Kiedy mam następną wizytę?'],
  en: ['What do I have to do today?', 'What is on this week?', 'When is my next appointment?'],
} as const

// Citations stay out of the prose: list rows carry their note underneath, the
// rest of the answer reads clean and the cited notes follow as a card.
const LINE_CITE = /^\s*(?:[-•*]\s*)?((?:\[\d+\]\s*)*)(.*?)\s*((?:\[\d+\]\s*)*)$/u
const LIST_LINE = /^\s*(?:[-•*]\s*|\[\d+\])/u
// A citation still being typed ("[", "[1") is cut too, so no bracket flashes while streaming.
const stripCitations = (text: string): string => text.replace(/\s*\[\d+\]/gu, '').replace(/\s*\[\d*$/u, '').trim()

const AnswerText = memo(function AnswerText({ message, colors, onOpen, streaming }: { message: AskMessage; colors: ThemeColors; onOpen: (source: AskSource) => void; streaming: boolean }) {
  const { t } = useI18n()
  const lines = useMemo(() => message.answer.trim().split(/\n+/u), [message.answer])
  const several = useMemo(() => new Set(message.cited.map((source) => source.title)).size > 1, [message.cited])
  // A list computed from the tasks: every row carries its deadline and opens its note.
  if (message.items) {
    const items = message.items
    return (
      <View style={{ gap: 8 }}>
        {message.intro ? <Text selectable style={[styles.answer, { color: colors.ink }]}>{message.intro}</Text> : null}
        {items.map((item, index) => {
          const source = message.sources.find((candidate) => candidate.noteId === item.noteId)
          const heading = item.group && item.group !== items[index - 1]?.group ? item.group : null
          return (
            <Fragment key={index}>
              {heading ? <Text style={[type.label, { fontSize: 13, color: item.overdue ? colors.danger : colors.muted, marginTop: index ? 6 : 0 }]}>{heading}</Text> : null}
              <Pressable
                disabled={!source}
                accessibilityRole={source ? 'button' : undefined}
                accessibilityHint={source ? t(`Otwiera notatkę ${source.title}`, `Opens the note ${source.title}`) : undefined}
                onPress={() => source && onOpen(source)}
                style={({ pressed }) => [styles.answerRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[styles.answerDot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text selectable style={[styles.answer, { color: colors.ink }]}>{item.text}</Text>
                  {item.due ? (
                    <View style={[styles.dueChip, { backgroundColor: colors.surface }]}>
                      <Text style={[type.meta, { color: item.overdue ? colors.danger : colors.ink, fontVariant: ['tabular-nums'] }]}>{item.due}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </Fragment>
          )
        })}
      </View>
    )
  }
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, index) => {
        const last = index === lines.length - 1
        const caret = streaming && last ? <Text style={{ color: colors.markerLine }}>{' ▍'}</Text> : null
        if (!LIST_LINE.test(line)) return (
          <Text key={index} selectable style={[styles.answer, { color: colors.ink }]}>
            {stripCitations(line)}{caret}
          </Text>
        )
        const match = LINE_CITE.exec(line)
        const numbers = `${match?.[1] ?? ''}${match?.[3] ?? ''}`.match(/\d+/gu) ?? []
        const source = message.sources.find((item) => item.number === Number(numbers[0]))
        const body = stripCitations(match?.[2] ?? line)
        return (
          <Pressable
            key={index}
            disabled={!source}
            accessibilityRole={source ? 'button' : undefined}
            accessibilityHint={source ? t(`Otwiera notatkę ${source.title}`, `Opens the note ${source.title}`) : undefined}
            onPress={() => source && onOpen(source)}
            style={({ pressed }) => [styles.answerRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.answerDot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={[styles.answer, { color: colors.ink }]}>{body}{caret}</Text>
              {source && several ? (
                <Text numberOfLines={1} style={[type.meta, { color: colors.muted }]}>
                  {t(`z notatki „${source.title}”`, `from “${source.title}”`)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
})

function Pulse() {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const value = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      Animated.timing(value, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [reduced, value])
  return <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.marker, opacity: value }} />
}

// While retrieval runs, the user's own note titles flick past like cards in a deck.
function SearchDeck({ titles }: { titles: readonly string[] }) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  const leave = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduced || titles.length < 2) return
    let alive = true
    const step = () => {
      leave.setValue(0)
      Animated.timing(leave, { toValue: 1, duration: 420, delay: 380, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (!alive || !finished) return
        setIndex((value) => (value + 1) % titles.length)
        step()
      })
    }
    step()
    return () => { alive = false; leave.stopAnimation() }
  }, [reduced, titles.length, leave])
  if (!titles.length) return null
  const card = (offset: number) => titles[(index + offset) % titles.length]
  return (
    <View style={styles.deck} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.deckCard, styles.deckBack2, { backgroundColor: colors.surface }]} />
      <View style={[styles.deckCard, styles.deckBack1, { backgroundColor: colors.paper, borderColor: colors.line }]}>
        <Text numberOfLines={1} style={[type.label, { color: colors.faint }]}>{card(1)}</Text>
      </View>
      <Animated.View
        style={[styles.deckCard, { backgroundColor: colors.paper, borderColor: colors.line,
          opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: leave.interpolate({ inputRange: [0, 1], outputRange: [0, 120] }) },
            { rotate: leave.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '8deg'] }) },
          ] }]}
      >
        <View style={[styles.deckDot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
        <Text numberOfLines={1} style={[type.label, { color: colors.ink, flex: 1 }]}>{card(0)}</Text>
      </Animated.View>
    </View>
  )
}

const Message = memo(function Message({ message, onOpen, titles, onFollowUp }: { message: AskMessage; onOpen: (source: AskSource) => void; titles: readonly string[]; onFollowUp?: ((question: string) => void) | undefined }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const searching = message.status === 'pending' && message.stage !== 'answering' && message.stage !== 'loading'
  const stageLabel =
    message.stage === 'loading'
      ? t('Ładuję model…', 'Loading the model…')
      : message.stage === 'answering'
        ? t('Piszę odpowiedź…', 'Writing the answer…')
        : t(`Przeglądam ${titles.length} ${titles.length === 1 ? 'notatkę' : 'notatki'}…`, `Looking through ${titles.length} notes…`)
  return (
    <View style={styles.turn}>
      <View style={[styles.question, { backgroundColor: colors.action }]}>
        <Text style={[type.body, { color: colors.onAction }]}>{message.question}</Text>
      </View>
      {message.status === 'pending' && (!message.answer || message.stage !== 'answering') ? (
        <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
          <Text style={[type.label, { fontSize: 13, color: colors.muted }]}>{stageLabel}</Text>
          {searching ? <SearchDeck titles={titles} /> : <Pulse />}
        </View>
      ) : null}
      {message.answer ? <AnswerText message={message} colors={colors} onOpen={onOpen} streaming={message.status === 'pending'} /> : null}
      {message.status === 'cancelled' ? (
        <Text style={[type.meta, { color: colors.muted }]}>{t('Zatrzymano.', 'Stopped.')}</Text>
      ) : null}
      {message.status === 'error' ? (
        <Text style={[type.meta, { color: colors.danger }]}>
          {message.error ?? t('Nie udało się odpowiedzieć.', 'Could not answer.')}
        </Text>
      ) : null}
      {message.status === 'done' && message.cited.length ? (
        <Text style={[type.label, { fontSize: 13, color: colors.muted, marginBottom: -4 }]}>
          {message.cited.length > 1 ? t('Z notatek', 'From notes') : t('Z notatki', 'From the note')}
        </Text>
      ) : null}
      {message.status === 'done' && message.cited.length ? (
        <View style={[styles.sources, { backgroundColor: colors.paper, borderColor: colors.line }]}>
          {message.cited.map((source, index) => (
            <Pressable
              key={source.noteId}
              accessibilityRole="button"
              accessibilityLabel={t(`Otwórz notatkę: ${source.title}`, `Open note: ${source.title}`)}
              onPress={() => onOpen(source)}
              style={({ pressed }) => [styles.source, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[styles.answerDot, { marginTop: 0, backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
              <Text numberOfLines={1} style={[type.label, { color: colors.ink, flex: 1 }]}>
                {source.title}
              </Text>
              <Icon name="chevron-right" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {message.status === 'done' && onFollowUp && message.followUps?.length ? (
        <View style={styles.followUps}>
          {message.followUps.map((question) => (
            <Pressable
              key={question}
              accessibilityRole="button"
              onPress={() => onFollowUp(question)}
              style={({ pressed }) => [styles.pill, { borderColor: colors.line, backgroundColor: colors.paper, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[type.label, { color: colors.ink }]}>{question}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
})

// The optional search model: offered, downloading, indexing, or installed.
function SearchModelCard({ compact }: { compact: boolean }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const downloaded = useSearchModelStore((state) => state.downloaded)
  const downloading = useSearchModelStore((state) => state.downloading)
  const percent = useSearchModelStore((state) => state.percent)
  const error = useSearchModelStore((state) => state.error)
  const download = useSearchModelStore((state) => state.download)
  const cancel = useSearchModelStore((state) => state.cancel)
  const remove = useSearchModelStore((state) => state.remove)
  const indexing = useVectorIndexStore((state) => state.indexing)
  const done = useVectorIndexStore((state) => state.done)
  const total = useVectorIndexStore((state) => state.total)
  const [confirming, setConfirming] = useState(false)
  if (indexing)
    return (
      <View style={styles.stage}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Text style={[type.meta, { color: colors.muted }]}>
          {t(`Indeksuję notatki do wyszukiwania… ${done}/${total}`, `Indexing notes for search… ${done}/${total}`)}
        </Text>
      </View>
    )
  if (compact) return null
  if (downloaded)
    return (
      <>
        <Text style={[type.meta, { color: colors.muted, textAlign: 'center' }]}>
          {t('Wyszukiwanie po znaczeniu włączone. ', 'Search by meaning is on. ')}
          <Text accessibilityRole="button" onPress={() => setConfirming(true)} style={{ color: colors.ink, textDecorationLine: 'underline' }}>
            {t('Usuń model', 'Remove model')}
          </Text>
        </Text>
        <BottomSheet visible={confirming} onClose={() => setConfirming(false)} title={t('Usunąć model wyszukiwania?', 'Remove the search model?')}>
          <Text style={[type.body, { color: colors.body }]}>
            {t('Zwolni to miejsce; czat będzie szukał tylko po słowach.', 'This frees the space; the chat will search by words only.')}
          </Text>
          <Button label={t('Usuń model', 'Remove model')} variant="danger" icon="trash" onPress={() => { setConfirming(false); void remove() }} />
          <Button label={t('Anuluj', 'Cancel')} variant="quiet" onPress={() => setConfirming(false)} />
        </BottomSheet>
      </>
    )
  return (
    <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.line }]}>
      <Text style={[type.label, { color: colors.ink }]}>{t('Lepsze wyszukiwanie', 'Better search')}</Text>
      <Text style={[type.meta, { color: colors.body }]}>
        {t(
          `Model wyszukiwania (${EMBEDDING_MODEL.approxSizeMb} MB) znajduje notatki opisane innymi słowami albo w drugim języku. Działa na telefonie, bez wysyłania notatek.`, `A search model (${EMBEDDING_MODEL.approxSizeMb} MB) finds notes that say it in other words or in the other language. It runs on this phone; notes are never sent.`,
        )}
      </Text>
      {error ? <Text style={[type.meta, { color: colors.danger }]}>{error}</Text> : null}
      {downloading ? (
        <Button label={t(`Anuluj · ${Math.round(percent)}%`, `Cancel · ${Math.round(percent)}%`)} variant="quiet" onPress={cancel} />
      ) : (
        <Button label={t('Pobierz model wyszukiwania', 'Download the search model')} icon="download" onPress={() => void download()} />
      )}
    </View>
  )
}

export default function AskScreen() {
  const { t, language } = useI18n()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const notes = useNotesStore((state) => state.notes)
  const tasks = useTasksStore((state) => state.tasks)
  const messages = useAskStore((state) => state.messages)
  const ask = useAskStore((state) => state.ask)
  const stop = useAskStore((state) => state.stop)
  const clear = useAskStore((state) => state.clear)
  const [draft, setDraft] = useState('')
  const scroll = useRef<ScrollView>(null)
  const pending = messages.some((message) => message.status === 'pending')
  const last = messages.at(-1)
  const titles = useMemo(() => notes.map((note) => note.title.trim()).filter(Boolean), [notes])

  useEffect(() => {
    // Streaming text lands many times a second: an animated scroll would lag behind it.
    scroll.current?.scrollToEnd({ animated: last?.status !== 'pending' })
  }, [messages.length, last?.answer, last?.stage, last?.status])

  const send = useCallback((question: string): void => {
    if (!question.trim() || pending) return
    setDraft('')
    void ask(question, { notes, tasks, appLanguage: language })
  }, [ask, language, notes, pending, tasks])
  const open = useCallback((source: AskSource): void => router.push(`/note/${source.noteId}`), [router])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 54 : 0}
    >
      <Stack.Screen
        options={{
          title: t('Zapytaj notatki', 'Ask your notes'),
          headerRight: () =>
            messages.length ? (
              <IconButton name="refresh" label={t('Nowa rozmowa', 'New conversation')} onPress={clear} />
            ) : null,
        }}
      />
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[type.display, { fontSize: 28, lineHeight: 36, color: colors.ink, textAlign: 'center' }]}>
              {notes.length ? t('Zapytaj swoje ', 'Ask your ') : t('Nie masz jeszcze notatek', 'You have no notes yet')}
              {notes.length ? <Text style={{ backgroundColor: colors.marker, color: colors.onMarker }}>{t('notatki', 'notes')}</Text> : null}
            </Text>
            <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>
              {t(
                'Odpowiedź powstaje na telefonie, tylko z Twoich notatek. Każda informacja ma odnośnik do notatki, z której pochodzi.',
                'Answers are written on this phone, only from your notes. Every fact links to the note it came from.',
              )}
            </Text>
            {notes.length ? (
              <View style={styles.examples}>
                {EXAMPLES[language].map((example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    onPress={() => send(example)}
                    style={({ pressed }) => [styles.example, { borderColor: colors.line, backgroundColor: colors.paper, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
                  >
                    <Text style={[type.label, { color: colors.ink, flex: 1 }]}>{example}</Text>
                    <Icon name="arrow-right" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {notes.length ? <ModelDownloadBanner inset={0} /> : null}
            {notes.length ? <SearchModelCard compact={false} /> : null}
          </View>
        ) : (
          <>
            <ModelDownloadBanner inset={0} />
            <SearchModelCard compact />
            {messages.map((message) => <Message key={message.id} message={message} onOpen={open} titles={titles} onFollowUp={message.id === last?.id && !pending ? send : undefined} />)}
          </>
        )}
      </ScrollView>
      <View
        style={[
          styles.composer,
          { borderTopColor: colors.line, backgroundColor: colors.canvas, paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('Zadaj pytanie…', 'Ask a question…')}
          placeholderTextColor={colors.faint}
          multiline
          editable={notes.length > 0}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => send(draft)}
          style={[styles.input, type.body, { color: colors.ink, backgroundColor: colors.paper, borderColor: colors.line }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pending ? t('Zatrzymaj', 'Stop') : t('Wyślij', 'Send')}
          disabled={!pending && !draft.trim()}
          onPress={() => (pending ? stop() : send(draft))}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: pending || draft.trim() ? colors.brand : colors.surface, transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <Icon name={pending ? 'stop' : 'arrow-right'} size={20} color={pending || draft.trim() ? colors.onBrand : colors.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xl, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  examples: { gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.md },
  example: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 48 },
  turn: { gap: spacing.md },
  question: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  answer: { ...type.body, fontSize: 17, lineHeight: 26 },
  answerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dueChip: { alignSelf: 'flex-start', minHeight: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
  followUps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  answerDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, marginTop: 9 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sources: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 14 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  deck: { height: 58, justifyContent: 'flex-start' },
  deckCard: { position: 'absolute', left: 0, right: 0, top: 0, height: 44, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  deckBack1: { left: 6, right: 6, top: 7, opacity: 0.9 },
  deckBack2: { left: 12, right: 12, top: 14, borderWidth: 0 },
  deckDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  card: { alignSelf: 'stretch', gap: spacing.sm, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 120, minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12 },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})
