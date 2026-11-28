import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import { parseAnswerBlocks, sourceChipLabel } from '../ask/answerPresentation'
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
import { font, spacing, type, useTheme, type ThemeColors } from '../ui/theme'

const EXAMPLES = {
  pl: ['Co mam dzisiaj do zrobienia?', 'Co mam w tym tygodniu?', 'Kiedy mam następną wizytę?'],
  en: ['What do I have to do today?', 'What is on this week?', 'When is my next appointment?'],
} as const

// The answer as plain text, numbered and bulleted lines as list rows. Citation
// marks never show; the notes behind the answer are chips under it.
function AnswerText({ message, colors, onOpen, streaming }: { message: AskMessage; colors: ThemeColors; onOpen: (source: AskSource) => void; streaming: boolean }) {
  const { t } = useI18n()
  const blocks = useMemo(() => parseAnswerBlocks(message.answer), [message.answer])
  // A list computed from the tasks: every row carries its deadline and opens its note.
  if (message.items) {
    const items = message.items
    return (
      <View style={styles.answerBlock}>
        {message.intro ? <Text selectable style={[styles.answer, { color: colors.ink }]}>{message.intro}</Text> : null}
        {items.map((item, index) => {
          const source = message.sources.find((candidate) => candidate.noteId === item.noteId)
          const heading = item.group && item.group !== items[index - 1]?.group ? item.group : null
          return (
            <Fragment key={index}>
              {heading ? <Text style={[type.caption, { color: item.overdue ? colors.danger : colors.secondary, marginTop: index ? 6 : 0 }]}>{heading}</Text> : null}
              <Pressable
                disabled={!source}
                accessibilityRole={source ? 'button' : undefined}
                accessibilityHint={source ? t(`Otwiera notatkę ${source.title}`, `Opens the note ${source.title}`) : undefined}
                onPress={() => source && onOpen(source)}
                style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.answer, styles.marker, { color: colors.ink }]}>{'•'}</Text>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text selectable style={[styles.answer, { color: colors.ink }]}>{item.text}</Text>
                  {item.due ? (
                    <Text style={[type.meta, { color: item.overdue ? colors.danger : colors.secondary, fontVariant: ['tabular-nums'] }]}>{item.due}</Text>
                  ) : null}
                </View>
              </Pressable>
            </Fragment>
          )
        })}
      </View>
    )
  }
  const caret = streaming ? <Text style={{ color: colors.accent }}>{' ▍'}</Text> : null
  return (
    <View style={styles.answerBlock}>
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1
        if (block.kind === 'paragraph') {
          return (
            <Text key={index} selectable style={[styles.answer, { color: colors.ink }]}>
              {block.text}{last ? caret : null}
            </Text>
          )
        }
        return (
          <View key={index} style={styles.list}>
            {block.items.map((item, position) => (
              <View key={position} style={styles.listRow}>
                <Text style={[styles.answer, styles.marker, { color: colors.ink, fontVariant: ['tabular-nums'] }]}>
                  {block.labels?.[position] ?? (block.ordered ? `${position + 1}.` : '•')}
                </Text>
                <Text selectable style={[styles.answer, { color: colors.ink, flex: 1 }]}>
                  {item}{last && position === block.items.length - 1 ? caret : null}
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

// Three still dots: the model is working, nothing moves.
function Waiting({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <View style={styles.waiting} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((dot) => <View key={dot} style={[styles.dot, { backgroundColor: colors.faint }]} />)}
      </View>
      <Text style={[type.meta, { color: colors.secondary }]}>{label}</Text>
    </View>
  )
}

const Message = memo(function Message({ message, onOpen, dates, onFollowUp }: { message: AskMessage; onOpen: (source: AskSource) => void; dates: ReadonlyMap<string, number>; onFollowUp?: ((question: string) => void) | undefined }) {
  const { t, language } = useI18n()
  const { colors } = useTheme()
  const stageLabel =
    message.stage === 'loading'
      ? t('Ładuję model…', 'Loading the model…')
      : message.stage === 'answering'
        ? t('Piszę odpowiedź…', 'Writing the answer…')
        : t('Szukam w notatkach…', 'Searching your notes…')
  const now = new Date()
  return (
    <View style={styles.turn}>
      <View style={[styles.question, { backgroundColor: colors.accent }]}>
        <Text style={[type.body, { color: '#FFFFFF' }]}>{message.question}</Text>
      </View>
      {message.status === 'pending' && (!message.answer || message.stage !== 'answering') ? (
        <Waiting label={stageLabel} colors={colors} />
      ) : null}
      {message.answer ? <AnswerText message={message} colors={colors} onOpen={onOpen} streaming={message.status === 'pending'} /> : null}
      {message.status === 'cancelled' ? (
        <Text style={[type.meta, { color: colors.secondary }]}>{t('Zatrzymano.', 'Stopped.')}</Text>
      ) : null}
      {message.status === 'error' ? (
        <Text style={[type.meta, { color: colors.danger }]}>
          {message.error ?? t('Nie udało się odpowiedzieć.', 'Could not answer.')}
        </Text>
      ) : null}
      {message.status === 'done' && message.cited.length ? (
        <View style={styles.chips}>
          {message.cited.map((source) => (
            <Pressable
              key={source.noteId}
              accessibilityRole="button"
              accessibilityLabel={t(`Otwórz notatkę: ${source.title}`, `Open note: ${source.title}`)}
              onPress={() => onOpen(source)}
              style={({ pressed }) => [styles.chip, { backgroundColor: colors.canvas, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text numberOfLines={1} style={[type.caption, font.regular, { color: colors.ink }]}>
                {sourceChipLabel(source.title, dates.get(source.noteId), now, language)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message.status === 'done' && onFollowUp && message.followUps?.length ? (
        <View style={styles.chips}>
          {message.followUps.map((question) => (
            <Pressable
              key={question}
              accessibilityRole="button"
              onPress={() => onFollowUp(question)}
              style={({ pressed }) => [styles.chip, { backgroundColor: colors.tint, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[type.caption, { color: colors.onTint }]}>{question}</Text>
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
        <ActivityIndicator size="small" color={colors.secondary} />
        <Text style={[type.meta, { color: colors.secondary }]}>
          {t(`Indeksuję notatki do wyszukiwania… ${done}/${total}`, `Indexing notes for search… ${done}/${total}`)}
        </Text>
      </View>
    )
  if (compact) return null
  if (downloaded)
    return (
      <>
        <Text style={[type.meta, { color: colors.secondary, textAlign: 'center' }]}>
          {t('Wyszukiwanie po znaczeniu włączone. ', 'Search by meaning is on. ')}
          <Text accessibilityRole="button" onPress={() => setConfirming(true)} style={{ color: colors.accent }}>
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
    <View style={[styles.card, { backgroundColor: colors.canvas }]}>
      <Text style={[type.label, { color: colors.ink }]}>{t('Lepsze wyszukiwanie', 'Better search')}</Text>
      <Text style={[type.meta, { color: colors.secondary }]}>
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
  const dates = useMemo(() => new Map(notes.map((note) => [note.id, note.createdAt] as const)), [notes])
  const canSend = pending || draft.trim().length > 0

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
      style={{ flex: 1, backgroundColor: colors.group }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // AppHeader: status bar inset plus its 54 pt bar.
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 54 : 0}
    >
      <Stack.Screen
        options={{
          title: t('Zapytaj notatki', 'Ask your notes'),
          headerRight: () =>
            messages.length ? (
              <IconButton name="refresh" label={t('Nowa rozmowa', 'New conversation')} onPress={clear} color={colors.accent} />
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
            <Text style={[type.noteTitle, { color: colors.ink, textAlign: 'center' }]}>
              {notes.length ? t('Zapytaj swoje notatki', 'Ask your notes') : t('Nie masz jeszcze notatek', 'You have no notes yet')}
            </Text>
            <Text style={[type.body, { color: colors.secondary, textAlign: 'center' }]}>
              {t(
                'Odpowiedź powstaje na telefonie, tylko z Twoich notatek. Pod każdą widać notatki, z których pochodzi.',
                'Answers are written on this phone, only from your notes. The notes behind each one are shown under it.',
              )}
            </Text>
            {notes.length ? (
              <View style={styles.examples}>
                {EXAMPLES[language].map((example) => (
                  <Pressable
                    key={example}
                    accessibilityRole="button"
                    onPress={() => send(example)}
                    style={({ pressed }) => [styles.example, { backgroundColor: colors.canvas, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{example}</Text>
                    <Icon name="chevron-right" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {notes.length ? <ModelDownloadBanner inset={0} onCanvas /> : null}
            {notes.length ? <SearchModelCard compact={false} /> : null}
          </View>
        ) : (
          <>
            <ModelDownloadBanner inset={0} onCanvas />
            <SearchModelCard compact />
            {messages.map((message) => <Message key={message.id} message={message} onOpen={open} dates={dates} onFollowUp={message.id === last?.id && !pending ? send : undefined} />)}
          </>
        )}
      </ScrollView>
      <View
        style={[
          styles.composer,
          { borderTopColor: colors.line, backgroundColor: colors.canvas, paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('Zapytaj o swoje notatki', 'Ask about your notes')}
          placeholderTextColor={colors.faint}
          accessibilityLabel={t('Pytanie', 'Question')}
          multiline
          editable={notes.length > 0}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => send(draft)}
          style={[styles.input, type.body, { color: colors.ink, backgroundColor: colors.group, borderColor: colors.line }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pending ? t('Zatrzymaj', 'Stop') : t('Wyślij', 'Send')}
          disabled={!canSend}
          onPress={() => (pending ? stop() : send(draft))}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? colors.accent : colors.field, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon name={pending ? 'stop' : 'arrow-up'} size={18} color={canSend ? '#FFFFFF' : colors.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.lg, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  examples: { gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.md },
  example: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 12, paddingHorizontal: spacing.lg, minHeight: 44 },
  turn: { gap: spacing.lg },
  question: { alignSelf: 'flex-end', maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  answerBlock: { gap: spacing.sm },
  answer: { ...type.body, lineHeight: 24 },
  list: { gap: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { width: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { height: 32, borderRadius: 16, paddingHorizontal: spacing.md, justifyContent: 'center', maxWidth: '100%' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dots: { flexDirection: 'row', gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  card: { alignSelf: 'stretch', gap: spacing.sm, borderRadius: 12, padding: spacing.lg, marginTop: spacing.lg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 120, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, paddingHorizontal: spacing.lg, paddingTop: 9, paddingBottom: 9 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
