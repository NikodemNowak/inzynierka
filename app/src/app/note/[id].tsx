import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/Icon'
import { ProcessingIndicator, RevealText, SkeletonText } from '../../ui/Motion'
import { radius, spacing, type, useTheme } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { useTasksStore } from '../../state/tasksStore'
import { useModelStore } from '../../state/modelStore'
import { formatNoteAsText } from '../../export/noteText'
import { MODEL_MISSING_MESSAGE } from '../../ai/noteProcessing'
import { AudioNotePlayer } from '../../audio/AudioNotePlayer'
import { NoteTasks } from '../../tasks/NoteTasks'
import { NoteTags } from '../../tags/NoteTags'
import type { NoteProposalSelection } from '../../notes/noteProposals'

type ProposalField = keyof NoteProposalSelection
type SheetMode = 'confirm' | 'choose' | null

const NO_SELECTION: NoteProposalSelection = {
  title: false,
  summary: false,
  tags: false,
}

const formatDuration = (durationMs: number | null): string | null => {
  if (durationMs === null) return null
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

const formatRecordedAt = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const day = isToday
    ? 'Dzisiaj'
    : date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day}, ${time}`
}

function ProposalChoice({
  label,
  value,
  selected,
  onPress,
  children,
}: {
  label: string
  value?: string
  selected: boolean
  onPress: () => void
  children?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.accentSoft : colors.canvas,
          borderColor: selected ? colors.accentSoft : colors.line,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.accent : colors.faint },
          selected && { backgroundColor: colors.accent },
        ]}
      >
        {selected && <Icon name="check" size={15} color={colors.onAccent} />}
      </View>
      <View style={styles.choiceContent}>
        <Text style={[styles.choiceLabel, { color: colors.ink }]}>{label}</Text>
        {children ?? (
          <Text style={[styles.choiceValue, { color: colors.body }]}>
            {value}
          </Text>
        )}
      </View>
    </Pressable>
  )
}

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === id),
  )
  const loaded = useNotesStore((state) => state.loaded)
  const progress = useNotesStore((state) =>
    id ? state.processing[id] : undefined,
  )
  const processError = useNotesStore((state) =>
    id ? state.processingError[id] : undefined,
  )
  const proposal = useNotesStore((state) =>
    id ? state.proposals[id] : undefined,
  )
  const proposeWithLlm = useNotesStore((state) => state.proposeWithLlm)
  const applyProposal = useNotesStore((state) => state.applyProposal)
  const clearProposal = useNotesStore((state) => state.clearProposal)
  const remove = useNotesStore((state) => state.remove)
  const allTasks = useTasksStore((state) => state.tasks)
  const noteTasks = allTasks.filter((task) => task.noteId === id)
  const modelReady = useModelStore((state) => state.status === 'ready')
  const router = useRouter()
  const isFocused = useIsFocused()
  const isFocusedRef = useRef(isFocused)
  isFocusedRef.current = isFocused
  const [sheetMode, setSheetMode] = useState<SheetMode>(null)
  const [taskAnalysisBusy, setTaskAnalysisBusy] = useState(false)
  const [selection, setSelection] =
    useState<NoteProposalSelection>(NO_SELECTION)
  const [error, setError] = useState<string | null>(null)
  const [revealTitle, setRevealTitle] = useState(false)
  const [revealSummary, setRevealSummary] = useState(false)
  const processing = progress !== undefined
  const wasProcessing = useRef(false)
  const processingSource = useRef({
    title: note?.title ?? '',
    summary: note?.summary ?? null,
  })

  useEffect(() => {
    if (proposal) setSelection(NO_SELECTION)
  }, [proposal])

  useEffect(() => {
    if (!isFocused) setSheetMode(null)
  }, [isFocused])

  useEffect(() => {
    if (processing && !wasProcessing.current && note) {
      processingSource.current = { title: note.title, summary: note.summary }
    } else if (!processing && wasProcessing.current && note) {
      setRevealTitle(note.title !== processingSource.current.title)
      setRevealSummary(
        note.summary !== processingSource.current.summary &&
          Boolean(note.summary?.trim()),
      )
    }
    wasProcessing.current = processing
  }, [note?.title, note?.summary, processing])

  useEffect(() => {
    if (!revealTitle && !revealSummary) return
    const timeout = setTimeout(() => {
      setRevealTitle(false)
      setRevealSummary(false)
    }, 1300)
    return () => clearTimeout(timeout)
  }, [revealTitle, revealSummary])

  const goToList = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const openEdit = () => {
    if (note) router.push(`/note/edit/${note.id}`)
  }

  const shareNote = async () => {
    if (!note || processing) return
    setError(null)
    try {
      await Share.share({ message: formatNoteAsText(note, noteTasks) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirmDelete = () => {
    if (!note) return
    Alert.alert('Usunąć notatkę?', 'Tej operacji nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          try {
            await remove(note.id)
            goToList()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        },
      },
    ])
  }

  const startReprocessing = async () => {
    if (!note || processing || taskAnalysisBusy) return
    if (proposal) {
      setSelection(NO_SELECTION)
      setSheetMode('choose')
      return
    }
    setError(null)
    setSheetMode(null)
    const generated = await proposeWithLlm(note.id)
    if (generated && isFocusedRef.current) {
      setSelection(NO_SELECTION)
      setSheetMode('choose')
    }
  }

  const applySelected = async () => {
    if (!note || !proposal || !id) return
    const count = Object.values(selection).filter(Boolean).length
    if (count === 0) return
    setError(null)
    try {
      const applied = await applyProposal(id, selection)
      setSheetMode(null)
      if (!applied) {
        clearProposal(id)
        setError('Notatka zmieniła się. Wygeneruj propozycje ponownie.')
      } else {
        setRevealTitle(
          selection.title && proposal.generated.title !== note.title,
        )
        setRevealSummary(
          selection.summary &&
            Boolean(proposal.generated.summary.trim()) &&
            proposal.generated.summary !== (note.summary ?? ''),
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const choose = (field: ProposalField, useNewValue: boolean) =>
    setSelection((current) => ({ ...current, [field]: useNewValue }))
  const pluralChanges = (count: number): string =>
    count === 1 ? 'zmianę' : count >= 2 && count <= 4 ? 'zmiany' : 'zmian'

  if (!note) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.canvas }]}>
        <Stack.Screen options={{ title: 'Notatka' }} />
        <Text style={[styles.body, { color: colors.muted }]}>
          {loaded ? 'Ta notatka już nie istnieje.' : 'Wczytuję notatkę…'}
        </Text>
        {loaded && <Button label="Wróć do listy" onPress={goToList} />}
      </View>
    )
  }

  const currentDuration = formatDuration(note.durationMs)
  const proposalChangeCount = Object.values(selection).filter(Boolean).length
  const headerTitle = processing
    ? () => <ProcessingIndicator label="Opracowuję notatkę…" />
    : 'Notatka'

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle,
          headerRight: () => (
            <View style={styles.headerActions}>
              {!processing && (
                <Pressable
                  onPress={openEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edytuj notatkę"
                  style={({ pressed }) => [
                    styles.editAction,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.editText, { color: colors.accent }]}>
                    Edytuj
                  </Text>
                </Pressable>
              )}
              <IconButton
                name="share"
                label="Udostępnij notatkę"
                onPress={() => void shareNote()}
                disabled={processing}
              />
            </View>
          ),
        }}
      />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[
          styles.container,
          {
            backgroundColor: colors.canvas,
            paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.lg),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {error && (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        )}
        {processing ? (
          <SkeletonText title lines={1} />
        ) : (
          <Text
            accessibilityRole="header"
            style={[styles.noteTitle, { color: colors.ink }]}
          >
            <RevealText
              text={note.title.trim() || 'Bez tytułu'}
              animate={revealTitle}
              style={[styles.noteTitle, { color: colors.ink }]}
            />
          </Text>
        )}

        <View style={styles.metadata}>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {formatRecordedAt(note.createdAt)}
          </Text>
          {currentDuration && (
            <Text style={[styles.meta, { color: colors.muted }]}>
              • {currentDuration}
            </Text>
          )}
        </View>

        {!processing && (
          <NoteTags
            tags={note.tags}
            onChange={() => undefined}
            editable={false}
            showLabel={false}
          />
        )}

        {note.audioUri && (
          <AudioNotePlayer uri={note.audioUri} durationMs={note.durationMs} />
        )}

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>
              Podsumowanie
            </Text>
            {!processing && (
              <Pressable
                onPress={() => setSheetMode(proposal ? 'choose' : 'confirm')}
                disabled={
                  !modelReady ||
                  note.content.trim().length === 0 ||
                  taskAnalysisBusy
                }
                accessibilityRole="button"
                accessibilityState={{
                  disabled:
                    !modelReady ||
                    note.content.trim().length === 0 ||
                    taskAnalysisBusy,
                }}
                style={({ pressed }) => [
                  styles.reprocessAction,
                  {
                    opacity:
                      !modelReady ||
                      note.content.trim().length === 0 ||
                      taskAnalysisBusy
                        ? 0.45
                        : pressed
                          ? 0.62
                          : 1,
                  },
                ]}
              >
                <Icon name="sparkles" size={20} color={colors.accent} />
                <Text style={[styles.reprocessText, { color: colors.accent }]}>
                  Przetwórz ponownie
                </Text>
              </Pressable>
            )}
          </View>
          {processing ? (
            <SkeletonText lines={3} />
          ) : (
            <Text
              style={[
                styles.body,
                { color: note.summary ? colors.body : colors.muted },
              ]}
            >
              <RevealText
                text={note.summary?.trim() || 'Brak podsumowania'}
                animate={revealSummary && Boolean(note.summary?.trim())}
                style={[
                  styles.body,
                  { color: note.summary ? colors.body : colors.muted },
                ]}
              />
            </Text>
          )}
          {processError && !processing && (
            <View
              style={[
                styles.processingError,
                { backgroundColor: colors.emberSoft },
              ]}
            >
              <Icon name="alert" size={16} color={colors.ember} />
              <Text
                style={[styles.processingErrorText, { color: colors.ember }]}
              >
                {processError}
              </Text>
            </View>
          )}
          {!processing && !modelReady && (
            <Text style={[styles.hint, { color: colors.muted }]}>
              {MODEL_MISSING_MESSAGE}
            </Text>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>
            Transkrypcja
          </Text>
          <Text
            selectable
            style={[
              styles.body,
              { color: note.content.trim() ? colors.body : colors.muted },
            ]}
          >
            {note.content.trim() ||
              (note.audioUri
                ? 'To nagranie nie ma jeszcze transkrypcji.'
                : 'Brak transkrypcji')}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <NoteTasks
          noteId={note.id}
          content={note.content}
          onBusyChange={setTaskAnalysisBusy}
        />

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <Button
          label="Usuń notatkę"
          variant="danger"
          icon="trash"
          onPress={confirmDelete}
          disabled={processing}
        />
      </ScrollView>

      <BottomSheet
        visible={sheetMode !== null}
        onClose={() => setSheetMode(null)}
        title={
          sheetMode === 'choose' ? 'Wybierz zmiany' : 'Przygotować nową wersję?'
        }
      >
        {sheetMode === 'confirm' && (
          <>
            <View style={styles.sheetIntro}>
              <Icon name="sparkles" size={28} color={colors.accent} />
              <Text style={[styles.sheetMessage, { color: colors.body }]}>
                Powstaną propozycje tytułu, podsumowania i kategorii. Wybierzesz
                osobno, co zmienić.
              </Text>
            </View>
            <Button
              label="Generuj propozycje"
              variant="primary"
              icon="sparkles"
              onPress={() => void startReprocessing()}
              disabled={!modelReady || processing || taskAnalysisBusy}
            />
            <Button
              label="Anuluj"
              variant="secondary"
              onPress={() => setSheetMode(null)}
            />
            {!modelReady && (
              <Text style={[styles.hint, { color: colors.muted }]}>
                {MODEL_MISSING_MESSAGE}
              </Text>
            )}
          </>
        )}
        {sheetMode === 'choose' && proposal && note && (
          <>
            <Text style={[styles.sheetMessage, { color: colors.muted }]}>
              Wybierz osobno dla każdego pola. Nic nie zmieni się, dopóki nie
              zastosujesz wyboru.
            </Text>
            <View style={styles.proposalSection}>
              <Text style={[styles.choiceSectionTitle, { color: colors.ink }]}>
                Tytuł
              </Text>
              <ProposalChoice
                label="Obecny"
                value={note.title.trim() || 'Bez tytułu'}
                selected={!selection.title}
                onPress={() => choose('title', false)}
              />
              <ProposalChoice
                label="Nowy"
                value={proposal.generated.title}
                selected={selection.title}
                onPress={() => choose('title', true)}
              />
            </View>
            <View style={styles.proposalSection}>
              <Text style={[styles.choiceSectionTitle, { color: colors.ink }]}>
                Podsumowanie
              </Text>
              <ProposalChoice
                label="Obecne"
                value={note.summary?.trim() || 'Brak podsumowania'}
                selected={!selection.summary}
                onPress={() => choose('summary', false)}
              />
              <ProposalChoice
                label="Nowe"
                value={proposal.generated.summary.trim() || 'Brak podsumowania'}
                selected={selection.summary}
                onPress={() => choose('summary', true)}
              />
            </View>
            <View style={styles.proposalSection}>
              <Text style={[styles.choiceSectionTitle, { color: colors.ink }]}>
                Kategorie
              </Text>
              <ProposalChoice
                label="Obecne"
                selected={!selection.tags}
                onPress={() => choose('tags', false)}
              >
                {note.tags.length > 0 ? (
                  <NoteTags
                    tags={note.tags}
                    onChange={() => undefined}
                    editable={false}
                    showLabel={false}
                  />
                ) : (
                  <Text style={[styles.choiceValue, { color: colors.muted }]}>
                    Bez kategorii
                  </Text>
                )}
              </ProposalChoice>
              <ProposalChoice
                label="Nowe"
                selected={selection.tags}
                onPress={() => choose('tags', true)}
              >
                {proposal.generated.tags.length > 0 ? (
                  <NoteTags
                    tags={proposal.generated.tags}
                    onChange={() => undefined}
                    editable={false}
                    showLabel={false}
                  />
                ) : (
                  <Text style={[styles.choiceValue, { color: colors.muted }]}>
                    Bez kategorii
                  </Text>
                )}
              </ProposalChoice>
            </View>
            <Button
              label={`Zastosuj ${proposalChangeCount} ${pluralChanges(proposalChangeCount)}`}
              variant="primary"
              icon="check"
              onPress={() => void applySelected()}
              disabled={proposalChangeCount === 0}
            />
            <Button
              label="Anuluj"
              variant="secondary"
              onPress={() => setSheetMode(null)}
            />
          </>
        )}
        {sheetMode === 'choose' && !proposal && (
          <Text style={[styles.sheetMessage, { color: colors.muted }]}>
            Propozycja nie jest już aktualna. Zamknij ten panel i wygeneruj ją
            ponownie.
          </Text>
        )}
      </BottomSheet>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  editAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  editText: { ...type.label },
  noteTitle: { ...type.display },
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  meta: { ...type.body, fontSize: 14, lineHeight: 20 },
  divider: { height: 1, marginVertical: spacing.xs },
  section: { gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  sectionTitle: { ...type.title, fontSize: 20 },
  reprocessAction: {
    minHeight: 44,
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flexShrink: 1,
  },
  reprocessText: { ...type.label, flexShrink: 1, textAlign: 'right' },
  body: { ...type.body },
  hint: { ...type.meta },
  error: { ...type.body },
  processingError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  processingErrorText: { fontSize: 14, lineHeight: 20, flex: 1 },
  sheetIntro: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetMessage: { ...type.body },
  proposalSection: { gap: spacing.sm },
  choiceSectionTitle: { ...type.label },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    marginTop: 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceContent: { flex: 1, gap: spacing.xs },
  choiceLabel: { ...type.label },
  choiceValue: { ...type.body },
})
