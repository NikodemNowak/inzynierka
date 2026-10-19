import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { Button } from '../ui/Button'
import { useI18n } from '../i18n/useI18n'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { Icon, IconButton } from '../ui/Icon'
import { radius, spacing, type, useTheme, type ThemeColors } from '../ui/theme'

const EXAMPLES = {
  pl: ['Co mam dzisiaj do zrobienia?', 'Co mam w tym tygodniu?', 'Kiedy mam następną wizytę?'],
  en: ['What do I have to do today?', 'What is on this week?', 'When is my next appointment?'],
} as const

function AnswerText({ message, colors, onOpen }: { message: AskMessage; colors: ThemeColors; onOpen: (source: AskSource) => void }) {
  const parts = message.answer.split(/(\[\d+\])/u)
  return (
    <Text selectable style={[styles.answer, { color: colors.ink }]}>
      {parts.map((part, index) => {
        const number = /^\[(\d+)\]$/u.exec(part)?.[1]
        const source = number ? message.sources.find((item) => item.number === Number(number)) : undefined
        if (!number) return part
        if (!source) return null
        return (
          <Text
            key={index}
            accessibilityRole="link"
            accessibilityLabel={source.title}
            onPress={() => onOpen(source)}
            style={{ color: colors.accent, fontWeight: '600' }}
          >
            {` [${number}]`}
          </Text>
        )
      })}
    </Text>
  )
}

function Message({ message, onOpen }: { message: AskMessage; onOpen: (source: AskSource) => void }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const stageLabel =
    message.stage === 'loading'
      ? t('Ładuję model…', 'Loading the model…')
      : message.stage === 'answering'
        ? t('Piszę odpowiedź…', 'Writing the answer…')
        : t('Szukam w notatkach…', 'Searching your notes…')
  return (
    <View style={styles.turn}>
      <View style={[styles.question, { backgroundColor: colors.accentSoft }]}>
        <Text style={[type.body, { color: colors.ink }]}>{message.question}</Text>
      </View>
      {message.answer ? <AnswerText message={message} colors={colors} onOpen={onOpen} /> : null}
      {message.status === 'pending' && (!message.answer || message.stage !== 'answering') ? (
        <View style={styles.stage}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={[type.meta, { color: colors.muted }]}>{stageLabel}</Text>
        </View>
      ) : null}
      {message.status === 'cancelled' ? (
        <Text style={[type.meta, { color: colors.muted }]}>{t('Zatrzymano.', 'Stopped.')}</Text>
      ) : null}
      {message.status === 'error' ? (
        <Text style={[type.meta, { color: colors.danger }]}>
          {message.error ?? t('Nie udało się odpowiedzieć.', 'Could not answer.')}
        </Text>
      ) : null}
      {message.status === 'done' && message.cited.length ? (
        <View style={styles.sources}>
          {message.cited.map((source) => (
            <Pressable
              key={source.noteId}
              accessibilityRole="button"
              onPress={() => onOpen(source)}
              style={({ pressed }) => [styles.source, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[type.meta, { color: colors.accent, fontWeight: '600' }]}>{source.number}</Text>
              <Icon name="note" size={14} color={colors.muted} />
              <Text numberOfLines={1} style={[type.meta, { color: colors.body, flexShrink: 1 }]}>
                {source.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}


// The optional search model: offered, downloading, indexing, or installed.
function SearchModelCard({ compact }: { compact: boolean }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const model = useSearchModelStore()
  const indexing = useVectorIndexStore()
  if (indexing.indexing)
    return (
      <View style={styles.stage}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Text style={[type.meta, { color: colors.muted }]}>
          {t(`Indeksuję notatki do wyszukiwania… ${indexing.done}/${indexing.total}`, `Indexing notes for search… ${indexing.done}/${indexing.total}`)}
        </Text>
      </View>
    )
  if (compact) return null
  if (model.downloaded)
    return (
      <Text style={[type.meta, { color: colors.muted, textAlign: 'center' }]}>
        {t('Wyszukiwanie po znaczeniu włączone. ', 'Search by meaning is on. ')}
        <Text accessibilityRole="button" onPress={() =>
            Alert.alert(t('Usunąć model wyszukiwania?', 'Remove the search model?'), t('Zwolni to miejsce; czat będzie szukał tylko po słowach.', 'This frees the space; the chat will search by words only.'), [
              { text: t('Anuluj', 'Cancel'), style: 'cancel' },
              { text: t('Usuń', 'Remove'), style: 'destructive', onPress: () => void model.remove() },
            ])
          } style={{ color: colors.accent }}>
          {t('Usuń model', 'Remove model')}
        </Text>
      </Text>
    )
  return (
    <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.line }]}>
      <Text style={[type.label, { color: colors.ink }]}>{t('Lepsze wyszukiwanie', 'Better search')}</Text>
      <Text style={[type.meta, { color: colors.body }]}>
        {t(
          `Model wyszukiwania (${EMBEDDING_MODEL.approxSizeMb} MB) znajduje notatki opisane innymi słowami albo w drugim języku. Działa na telefonie, bez wysyłania notatek.`, `A search model (${EMBEDDING_MODEL.approxSizeMb} MB) finds notes that say it in other words or in the other language. It runs on this phone; notes are never sent.`,
        )}
      </Text>
      {model.error ? <Text style={[type.meta, { color: colors.danger }]}>{model.error}</Text> : null}
      {model.downloading ? (
        <Button label={t(`Anuluj · ${Math.round(model.percent)}%`, `Cancel · ${Math.round(model.percent)}%`)} variant="quiet" onPress={model.cancel} />
      ) : (
        <Button label={t('Pobierz model wyszukiwania', 'Download the search model')} icon="download" onPress={() => void model.download()} />
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

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true })
  }, [messages.length, last?.answer, last?.stage])

  const send = (question: string): void => {
    if (!question.trim() || pending) return
    setDraft('')
    void ask(question, { notes, tasks, appLanguage: language })
  }
  const open = (source: AskSource): void => router.push(`/note/${source.noteId}`)

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
            <Icon name="sparkles" size={30} color={colors.accent} />
            <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>
              {notes.length
                ? t('Zapytaj o cokolwiek z notatek', 'Ask anything about your notes')
                : t('Nie masz jeszcze notatek', 'You have no notes yet')}
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
                    style={({ pressed }) => [styles.example, { borderColor: colors.line, backgroundColor: colors.paper, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[type.label, { color: colors.body }]}>{example}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {notes.length ? <SearchModelCard compact={false} /> : null}
          </View>
        ) : (
          <>
            <SearchModelCard compact />
            {messages.map((message) => <Message key={message.id} message={message} onOpen={open} />)}
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
            { backgroundColor: pending || draft.trim() ? colors.action : colors.surface, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Icon name={pending ? 'stop' : 'arrow-right'} size={20} color={pending || draft.trim() ? colors.onAction : colors.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xl, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  examples: { gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.md },
  example: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  turn: { gap: spacing.md },
  question: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  answer: { ...type.body },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, maxWidth: '100%' },
  card: { alignSelf: 'stretch', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 0.5 },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 10 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
