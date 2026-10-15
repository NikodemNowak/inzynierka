import { useI18n } from '../../i18n/useI18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { LayoutEntry, useLayoutTransition } from '../../ui/LayoutMotion'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/Icon'
import {
  ProcessingIndicator,
  RevealText,
  SkeletonText,
  useReducedMotion,
} from '../../ui/Motion'
import { radius, spacing, type, useTheme } from '../../ui/theme'
import { processingPresentation } from '../../ui/processingPresentation'
import { useNotesStore } from '../../state/notesStore'
import { useTasksStore } from '../../state/tasksStore'
import { useModelStore } from '../../state/modelStore'
import { formatNoteAsText } from '../../export/noteText'
import { getModelMissingMessage } from '../../ai/noteProcessing'
import { localeForLanguage, type Language } from '../../i18n/language'
import { AudioNotePlayer } from '../../audio/AudioNotePlayer'
import { NoteTasks } from '../../tasks/NoteTasks'
import { NoteTags } from '../../tags/NoteTags'
import { parseSummaryDocument } from '../../domain/summary'
import { SummaryWithSources } from '../../notes/SummaryWithSources'
import {
  getEffectiveNoteProposalSelection,
  getNoteProposalChanges,
  isNoteProposalCurrent,
  isNoteProposalFieldAvailable,
  type NoteProposalSelection,
} from '../../notes/noteProposals'
import { supportsBackgroundProcessing } from '../../processing/nativeProcessing'

type ProposalField = keyof NoteProposalSelection
type SheetMode = 'confirm' | 'choose' | null

// A title reveal longer than this is treated as stuck and replaced by plain text.
const TITLE_REVEAL_DEADLINE_MS = 3000

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

const formatRecordedAt = (timestamp: number, language: Language): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const locale = localeForLanguage(language)
  const day = isToday
    ? language === 'pl'
      ? 'Dzisiaj'
      : 'Today'
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day}, ${time}`
}

function ProposalChoice({
  label,
  value,
  selected,
  disabled = false,
  reveal = false,
  animate = false,
  active = true,
  onPress,
  children,
}: {
  label: string
  value?: string
  selected: boolean
  disabled?: boolean
  reveal?: boolean
  animate?: boolean
  active?: boolean
  onPress: () => void
  children?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.accentSoft : colors.canvas,
          opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.action : colors.faint },
          selected && { backgroundColor: colors.action },
        ]}
      >
        {selected && <Icon name="check" size={15} color={colors.onAction} />}
      </View>
      <View style={styles.choiceValueContent}>
        <Text style={[styles.choiceLabel, { color: colors.ink }]}>{label}</Text>
        {children ?? (reveal ? (
          <RevealText text={value ?? ''} animate={animate} active={active} style={[styles.choiceValue, { color: colors.body }]} />
        ) : (
          <Text style={[styles.choiceValue, { color: colors.body }]}>
            {value}
          </Text>
        ))}
      </View>
    </Pressable>
  )
}

function ProposalValue({ label, value, hint, children }: {
  label: string
  value?: string
  hint?: string
  children?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.choice}>
      <View style={styles.choiceValueContent}>
        <Text style={[styles.choiceLabel, { color: colors.muted }]}>{label}</Text>
        {children ?? <Text style={[styles.choiceValue, { color: colors.body }]}>{value}</Text>}
        {hint && <Text style={[styles.hint, { color: colors.muted }]}>{hint}</Text>}
      </View>
    </View>
  )
}

export default function NoteDetailScreen() {
  const { id, recordingNotice, titlePending } = useLocalSearchParams<{
    id: string
    recordingNotice?: string
    titlePending?: string
  }>()
  const { colors } = useTheme()
  const { t, language } = useI18n()
  const insets = useSafeAreaInsets()
  const reducedMotion = useReducedMotion()
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === id),
  )
  const loaded = useNotesStore((state) => state.loaded)
  const processingPhase = useNotesStore((state) =>
    id ? state.processing[id]?.phase : undefined,
  )
  const processingProgress = useNotesStore((state) =>
    id ? state.processing[id] : undefined,
  )
  const resumableProcessing = useNotesStore((state) =>
    id ? state.resumableProcessing[id] : undefined,
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
  const [discarding, setDiscarding] = useState(false)
  const discardInFlight = useRef(false)
  const [appliedNotice, setAppliedNotice] = useState(false)
  const [revealTitle, setRevealTitle] = useState<string | null>(null)
  const [revealSummary, setRevealSummary] = useState<string | null>(null)
  const [readyFields, setReadyFields] = useState({ title: false, summary: false })
  const [pendingTitle, setPendingTitle] = useState(titlePending === '1')
  const titleMarker = useRef<{ id: string | undefined; accepted: boolean }>({ id, accepted: false })
  const processing = processingPhase !== undefined
  const proposalCurrent = Boolean(note && proposal && isNoteProposalCurrent(note, proposal))
  const proposalChanges = proposal ? getNoteProposalChanges(proposal) : NO_SELECTION
  const effectiveSelection = proposal && proposalCurrent
    ? getEffectiveNoteProposalSelection(proposal, selection)
    : NO_SELECTION
  const changedFieldCount = Object.values(proposalChanges).filter(Boolean).length
  const titleAvailable = Boolean(
    proposal && isNoteProposalFieldAvailable(proposal, 'title'),
  )
  const summaryAvailable = Boolean(
    proposal && isNoteProposalFieldAvailable(proposal, 'summary'),
  )
  const tagsAvailable = Boolean(
    proposal && isNoteProposalFieldAvailable(proposal, 'tags'),
  )
  const unavailableValue = t(
    'Nie udało się przygotować tego pola. Obecna wartość pozostanie.',
    'This field could not be prepared. The current value will be kept.',
  )
  const preparingModel =
    processingPhase === 'queued' || processingPhase === 'loading'
  const wasProcessing = useRef(false)
  const processingSource = useRef({
    id: note?.id,
    title: note?.title ?? '',
    summary: note?.summary ?? null,
  })
  // Store publication and job cleanup are separate updates. Animate the result
  // in its first render, including when the processing entry is still present.
  const observingResult = Boolean(note && processingSource.current.id === note.id && wasProcessing.current)
  const titleResultChanged = observingResult && note?.title !== processingSource.current.title
  const summaryResultChanged = observingResult && note?.summary !== processingSource.current.summary && Boolean(note?.summary?.trim())
  const resultPublished = titleResultChanged || summaryResultChanged
  const titleLoading = processing && !resultPublished && !readyFields.title && (pendingTitle || !note?.title.trim())
  const summaryLoading = processing && !resultPublished && !readyFields.summary
  // After its reveal (or a stuck one) the title remounts as plain text. On iOS an
  // interrupted layout animation can leave the revealed view invisible until remount.
  const [titleSettled, setTitleSettled] = useState({ text: '', epoch: 0 })
  const titleRevealComplete = useCallback((value: string) => {
    setRevealTitle(current => current === value ? null : current)
    setTitleSettled(current => ({ text: value, epoch: current.epoch + 1 }))
  }, [])
  const summaryRevealComplete = useCallback((value: string) => setRevealSummary(current => current === value ? null : current), [])
  const desiredPresentation = { title: note?.title ?? '', summary: note?.summary ?? null, tags: note?.tags ?? [], titleLoading, summaryLoading, processing }
  const shown = useLayoutTransition(desiredPresentation, JSON.stringify(desiredPresentation), id ?? '', isFocused, reducedMotion)
  const summaryDocument = note ? parseSummaryDocument(note.summaryDocument, note.content, note.summary) : null
  const summaryRevealing = Boolean(note?.summary && (revealSummary === note.summary || summaryResultChanged))
  // Metadata may arrive without changing the text. Stage its activation as a
  // separate native layout transaction before publishing minimum44 source rows.
  const sourceIdentity = note && summaryDocument && isFocused && !summaryLoading && !shown.summaryLoading
    && shown.summary === note.summary && (reducedMotion || !summaryRevealing)
    ? JSON.stringify({ noteId: note.id, revision: note.updatedAt, content: note.content, document: note.summaryDocument }) : null
  const shownSourceIdentity = useLayoutTransition(sourceIdentity, sourceIdentity ?? '', id ?? '', isFocused, reducedMotion)
  // Current canonical data always wins over a delayed presentation, including
  // the first render after source, focus, revision or reveal state changes.
  const showSummarySources = sourceIdentity !== null && shownSourceIdentity === sourceIdentity
  const summaryPlaceholder = useRef({ id, lines: 3 })
  if (summaryPlaceholder.current.id !== id) summaryPlaceholder.current = { id, lines: 3 }
  if (shown.summaryLoading) summaryPlaceholder.current.lines = shown.summary?.trim() ? 2 : 3

  useLayoutEffect(() => {
    if (titleMarker.current.id !== id) {
      titleMarker.current = { id, accepted: false }
      setPendingTitle(false)
    }
    if (titlePending !== '1' || titleMarker.current.accepted) return
    titleMarker.current.accepted = true
    setPendingTitle(true)
    // Keep the pending title only in this mounted screen; returning cannot
    // hide a saved title behind a stale route parameter.
    router.setParams({ titlePending: undefined })
  }, [id, titlePending, router])

  useEffect(() => {
    if (proposal) setSelection(NO_SELECTION)
  }, [proposal])

  useEffect(() => {
    if (!isFocused) setSheetMode(null)
  }, [isFocused])

  useLayoutEffect(() => {
    if (!note) return
    if (processingSource.current.id !== note.id) {
      processingSource.current = { id: note.id, title: note.title, summary: note.summary }
      setRevealTitle(null)
      setRevealSummary(null)
      setReadyFields({ title: false, summary: false })
      wasProcessing.current = processing
      return
    }
    if (processing && !wasProcessing.current && note) {
      processingSource.current = { id: note.id, title: note.title, summary: note.summary }
      setRevealTitle(null)
      setRevealSummary(null)
      setReadyFields({ title: false, summary: false })
    } else if (wasProcessing.current) {
      if (titleResultChanged) setRevealTitle(note.title)
      if (summaryResultChanged) setRevealSummary(note.summary)
      // The store publishes title, summary and tags together before cleanup.
      if (titleResultChanged || summaryResultChanged) setReadyFields({ title: true, summary: true })
      if (titleResultChanged || summaryResultChanged || !processing) setPendingTitle(false)
      processingSource.current = { id: note.id, title: note.title, summary: note.summary }
    }
    wasProcessing.current = processing
  }, [note?.id, note?.title, note?.summary, processing, titleResultChanged, summaryResultChanged])

  useEffect(() => {
    if (!isFocused) {
      setPendingTitle(false)
      setRevealTitle(null)
      setRevealSummary(null)
    } else if (processError && !processing) setPendingTitle(false)
  }, [isFocused, processError, processing])

  useEffect(() => {
    if (!revealTitle) return
    const timeout = setTimeout(() => titleRevealComplete(revealTitle), TITLE_REVEAL_DEADLINE_MS)
    return () => clearTimeout(timeout)
  }, [revealTitle, titleRevealComplete])

  useEffect(() => {
    if (!appliedNotice) return
    const timeout = setTimeout(() => setAppliedNotice(false), 2600)
    return () => clearTimeout(timeout)
  }, [appliedNotice])

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
      await Share.share({
        message: formatNoteAsText(note, noteTasks, language),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirmDelete = () => {
    if (!note) return
    Alert.alert(
      t('Usunąć notatkę?', 'Delete note?'),
      t('Tej operacji nie można cofnąć.', 'This action cannot be undone.'),
      [
        { text: t('Anuluj', 'Cancel'), style: 'cancel' },
        {
          text: t('Usuń', 'Delete'),
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
      ],
    )
  }

  const startReprocessing = async (background?: boolean) => {
    if (!note || processing || taskAnalysisBusy) return
    if (note.transcriptionIncomplete) return
    if (proposal) {
      setSelection(NO_SELECTION)
      setSheetMode('choose')
      return
    }
    setError(null)
    setSheetMode(null)
    const generated = await proposeWithLlm(
      note.id,
      background === undefined ? undefined : { background },
    )
    if (generated && isFocusedRef.current) {
      setSelection(NO_SELECTION)
      setSheetMode('choose')
    }
  }

  const applySelected = async () => {
    if (!note || !proposal || !id || discardInFlight.current) return
    const count = Object.values(effectiveSelection).filter(Boolean).length
    if (count === 0) return
    setError(null)
    try {
      const applied = await applyProposal(id, effectiveSelection)
      if (!applied) {
        const discarded = await clearProposal(id, proposal)
        if (discarded) setSheetMode(null)
        setError(
          useNotesStore.getState().processingError[id] ?? t(
            'Notatka zmieniła się. Wygeneruj propozycje ponownie.',
            'The note has changed. Generate suggestions again.',
          ),
        )
      } else {
        setSheetMode(null)
        setAppliedNotice(true)
        setRevealTitle(
          effectiveSelection.title && proposal.generated.title !== note.title ? proposal.generated.title : null,
        )
        setRevealSummary(
          effectiveSelection.summary &&
            Boolean(proposal.generated.summary.trim()) &&
            proposal.generated.summary !== (note.summary ?? '') ? proposal.generated.summary : null,
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const discardSuggestions = async () => {
    if (!id || !proposal || processing || discardInFlight.current) return
    discardInFlight.current = true
    setDiscarding(true)
    setError(null)
    try {
      const discarded = await clearProposal(id, proposal)
      if (discarded) {
        setSelection(NO_SELECTION)
        setSheetMode(null)
      } else {
        setError(
          useNotesStore.getState().processingError[id] ?? t(
            'Nie udało się odrzucić propozycji. Sprawdź notatkę i spróbuj ponownie.',
            'The suggestions could not be discarded. Check the note and try again.',
          ),
        )
      }
    } finally {
      discardInFlight.current = false
      setDiscarding(false)
    }
  }

  const closeChoices = () => {
    if (!discardInFlight.current) setSheetMode(null)
  }

  const choose = (field: ProposalField, useNewValue: boolean) => {
    if (
      discardInFlight.current ||
      !proposalCurrent ||
      (useNewValue && !proposalChanges[field])
    )
      return
    setSelection((current) => ({ ...current, [field]: useNewValue }))
  }
  const pluralChanges = (count: number): string =>
    language === 'en'
      ? count === 1
        ? 'change'
        : 'changes'
      : count === 1
        ? 'zmianę'
        : count >= 2 && count <= 4
          ? 'zmiany'
          : 'zmian'

  if (!note) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.canvas }]}>
        <Stack.Screen options={{ title: t('Notatka', 'Note') }} />
        <Text style={[styles.body, { color: colors.muted }]}>
          {loaded
            ? t('Ta notatka już nie istnieje.', 'This note no longer exists.')
            : t('Wczytuję notatkę…', 'Loading note…')}
        </Text>
        {loaded && (
          <Button
            label={t('Wróć do listy', 'Back to notes')}
            onPress={goToList}
          />
        )}
      </View>
    )
  }

  const currentDuration = formatDuration(note.durationMs)
  const reprocessDisabled = !modelReady || taskAnalysisBusy ||
    (note.transcriptionIncomplete ? !note.audioUri : !note.content.trim())
  const proposalChangeCount = Object.values(effectiveSelection).filter(Boolean).length
  const presentation = processingPresentation(processingProgress, t)
  const headerTitle = processing
    ? () => <ProcessingIndicator active={isFocused} {...presentation} />
    : t('Notatka', 'Note')

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
                  accessibilityLabel={t('Edytuj notatkę', 'Edit note')}
                  style={({ pressed }) => [
                    styles.editAction,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.editText, { color: colors.accent }]}>
                    {t('Edytuj', 'Edit')}
                  </Text>
                </Pressable>
              )}
              <IconButton
                name="share"
                label={t('Udostępnij notatkę', 'Share note')}
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
        {recordingNotice && (
          <View
            style={[
              styles.processingError,
              { backgroundColor: colors.accentSoft },
            ]}
            accessibilityRole="alert"
          >
            <Icon name="alert" size={20} color={colors.accent} />
            <Text style={[styles.processingErrorText, { color: colors.body }]}>
              {recordingNotice}
            </Text>
            <IconButton
              name="close"
              label={t('Zamknij informację', 'Dismiss message')}
              onPress={() => router.setParams({ recordingNotice: undefined })}
            />
          </View>
        )}
        {error && (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        )}
        {shown.titleLoading ? (
          <SkeletonText title lines={1} animate={!preparingModel} active={isFocused} />
        ) : (
          <RevealText
            key={`title-${titleSettled.epoch}`}
            accessibilityRole="header"
            active={isFocused}
            text={shown.title.trim() || t('Bez tytułu', 'Untitled')}
            animate={isFocused && titleSettled.text !== shown.title && (revealTitle === shown.title || titleResultChanged && shown.title === note.title)}
            onRevealComplete={titleRevealComplete}
            placeholderLines={1}
            style={[styles.noteTitle, { color: colors.ink }]}
          />
        )}

        <View style={styles.metadata}>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {formatRecordedAt(note.createdAt, language)}
          </Text>
          {currentDuration && (
            <Text style={[styles.meta, { color: colors.muted }]}>
              • {currentDuration}
            </Text>
          )}
        </View>

        <LayoutEntry eventKey={JSON.stringify(shown.tags)} visible={shown.tags.length > 0} active={isFocused} reducedMotion={reducedMotion}>
          <NoteTags
            tags={shown.tags}
            onChange={() => undefined}
            editable={false}
            showLabel={false}
            compact
          />
        </LayoutEntry>

        {note.audioUri && (
          <AudioNotePlayer uri={note.audioUri} durationMs={note.durationMs} />
        )}

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>
              {t('Podsumowanie', 'Summary')}
            </Text>
            {!shown.processing && (
              <Pressable
                onPress={() => {
                  if (note.transcriptionIncomplete) {
                    if (note.audioUri) router.push({ pathname: '/import', params: { noteId: note.id } })
                    return
                  }
                  setSheetMode(proposal ? 'choose' : 'confirm')
                }}
                disabled={reprocessDisabled}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: reprocessDisabled,
                }}
                style={({ pressed }) => [
                  styles.reprocessAction,
                  {
                    opacity:
                      reprocessDisabled
                        ? 0.45
                        : pressed
                          ? 0.62
                          : 1,
                  },
                ]}
              >
                <Icon name="sparkles" size={20} color={colors.accent} />
                <Text style={[styles.reprocessText, { color: colors.accent }]}>
                  {note.transcriptionIncomplete
                    ? t('Uzupełnij i przetwórz', 'Complete and process')
                    : t('Przetwórz ponownie', 'Process again')}
                </Text>
              </Pressable>
            )}
          </View>
          {(!shown.summaryLoading || Boolean(shown.summary?.trim())) && (
            showSummarySources ? <SummaryWithSources
              noteId={note.id}
              revision={note.updatedAt}
              content={note.content}
              summary={note.summary ?? ''}
              document={note.summaryDocument}
              active={isFocused}
            /> : <RevealText
              active={isFocused}
              text={shown.summary?.trim() || t('Brak podsumowania', 'No summary')}
              animate={isFocused && Boolean(shown.summary?.trim()) && (revealSummary === shown.summary || summaryResultChanged && shown.summary === note.summary)}
              onRevealComplete={summaryRevealComplete}
              placeholderLines={summaryPlaceholder.current.lines}
              style={[
                styles.body,
                { color: shown.summary ? colors.body : colors.muted },
              ]}
            />
          )}
          {shown.summaryLoading && (
            <View style={{ gap: spacing.sm, marginTop: shown.summary?.trim() ? spacing.md : 0 }}>
              {Boolean(shown.summary?.trim()) && (
                <Text style={[type.meta, { color: colors.muted }]}>
                  {t('Nowa propozycja', 'New proposal')}
                </Text>
              )}
              <SkeletonText lines={shown.summary?.trim() ? 2 : 3} animate={!preparingModel} active={isFocused} />
            </View>
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
          {resumableProcessing && !processing && modelReady && !note.transcriptionIncomplete && (
            <View style={{ gap: spacing.sm }}>
              <Button
                label={t('Wznów opracowanie', 'Resume processing')}
                variant="primary"
                onPress={() =>
                  void useNotesStore.getState().resumeProcessing(note.id)
                }
              />
              <Button
                label={t(
                  'Wznów w otwartej aplikacji',
                  'Resume with the app open',
                )}
                variant="secondary"
                onPress={() =>
                  void useNotesStore
                    .getState()
                    .resumeProcessing(note.id, { background: false })
                }
              />
            </View>
          )}
          {shown.processing && (
            <Button
              label={t('Wstrzymaj', 'Pause')}
              variant="secondary"
              onPress={() =>
                void useNotesStore.getState().pauseProcessing(note.id)
              }
            />
          )}
          {!processing && !modelReady && (
            <Text style={[styles.hint, { color: colors.muted }]}>
              {getModelMissingMessage()}
            </Text>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.ink }]}>
            {t('Transkrypcja', 'Transcript')}
          </Text>
          {(note.transcriptionIncomplete || note.audioUri) && (
            <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              {note.transcriptionIncomplete && <Text
                accessibilityRole="alert"
                style={[styles.hint, { color: colors.ember }]}
              >
                {t(
                  'Audio zostało zapisane. Transkrypcja może być niepełna.',
                  'Audio has been saved. The transcript may be incomplete.',
                )}
              </Text>}
              {note.audioUri && <Button
                label={note.transcriptionIncomplete
                  ? t('Uzupełnij transkrypcję', 'Complete transcript')
                  : t('Transkrybuj audio ponownie', 'Transcribe audio again')}
                variant="secondary"
                disabled={processing || taskAnalysisBusy}
                onPress={() =>
                  router.push({
                    pathname: '/import',
                    params: { noteId: note.id },
                  })
                }
              />}
              {note.audioUri && !note.transcriptionIncomplete && (
                <Text style={[styles.hint, { color: colors.muted }]}>
                  {t(
                    'Użyj, jeśli brakuje fragmentów. Ponowna transkrypcja zastąpi obecny tekst.',
                    'Use this if parts are missing. Transcribing again replaces the current text.',
                  )}
                </Text>
              )}
            </View>
          )}
          <Text
            selectable
            style={[
              styles.body,
              { color: note.content.trim() ? colors.body : colors.muted },
            ]}
          >
            {note.content.trim() ||
              (note.audioUri
                ? t(
                    'To nagranie nie ma jeszcze transkrypcji.',
                    'This recording has no transcript yet.',
                  )
                : t('Brak transkrypcji', 'No transcript'))}
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
          label={t('Usuń notatkę', 'Delete note')}
          variant="danger"
          icon="trash"
          onPress={confirmDelete}
          disabled={processing}
        />
      </ScrollView>

      <BottomSheet
        visible={sheetMode === 'confirm' && isFocused}
        onClose={() => setSheetMode(null)}
        title={t('Przygotować nową wersję?', 'Prepare a new version?')}
      >
        {sheetMode === 'confirm' && (
          <>
            <View style={styles.sheetIntro}>
              <Icon name="sparkles" size={28} color={colors.accent} />
              <Text style={[styles.sheetMessage, { color: colors.body }]}>
                {t(
                  'Powstaną propozycje tytułu, podsumowania i kategorii. Wybierzesz osobno, co zmienić.',
                  'Suggestions for the title, summary, and categories will be created. You choose which fields to change.',
                )}
              </Text>
            </View>
            <Button
              label={t('Generuj propozycje', 'Generate suggestions')}
              variant="primary"
              icon="sparkles"
              onPress={() => void startReprocessing()}
              disabled={!modelReady || processing || taskAnalysisBusy}
            />
            {supportsBackgroundProcessing() && (
              <Button
                label={t('Generuj w tle', 'Generate in the background')}
                variant="secondary"
                icon="sparkles"
                onPress={() => void startReprocessing(true)}
                disabled={!modelReady || processing || taskAnalysisBusy}
              />
            )}
            {supportsBackgroundProcessing() && (
              <Text style={[styles.hint, { color: colors.muted }]}>
                {t(
                  'Tryb w tle używa CPU i może być wolniejszy. iOS pokazuje postęp.',
                  'Background mode uses the CPU and may be slower. iOS shows progress.',
                )}
              </Text>
            )}
            <Button
              label={t('Anuluj', 'Cancel')}
              variant="secondary"
              onPress={() => setSheetMode(null)}
            />
            {!modelReady && (
              <Text style={[styles.hint, { color: colors.muted }]}>
                {getModelMissingMessage()}
              </Text>
            )}
          </>
        )}
      </BottomSheet>

      <Modal
        visible={sheetMode === 'choose' && isFocused}
        animationType={reducedMotion ? 'fade' : 'slide'}
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={closeChoices}
      >
        <View
          accessibilityViewIsModal
          style={[styles.choiceScreen, { backgroundColor: colors.canvas }]}
        >
          <View
            style={[
              styles.choiceHeader,
              {
                paddingTop: insets.top + spacing.xs,
                borderBottomColor: colors.line,
              },
            ]}
          >
            <Pressable
              onPress={closeChoices}
              disabled={discarding}
              accessibilityRole="button"
              accessibilityState={{ disabled: discarding }}
              accessibilityLabel={t(
                'Anuluj wybór zmian',
                'Cancel choosing changes',
              )}
              style={styles.choiceCancel}
            >
              <Text style={[styles.headerCancelText, { color: colors.accent }]}>
                {t('Anuluj', 'Cancel')}
              </Text>
            </Pressable>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.choiceScreenTitle, { color: colors.ink }]}
            >
              {t('Wybierz zmiany', 'Choose changes')}
            </Text>
            <View style={styles.choiceCancel} />
          </View>

          <ScrollView
            style={styles.choiceScroll}
            contentContainerStyle={styles.choiceScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.choiceIntro, { color: colors.muted }]}>
              {t(
                'Wybierz zmiany, które chcesz zastosować.',
                'Choose the changes you want to apply.',
              )}
            </Text>
            {proposal && proposalCurrent ? (
              <>
                {changedFieldCount === 0 && (
                  <Text accessibilityLiveRegion="polite" style={[styles.choiceValue, { color: colors.muted }]}>
                    {titleAvailable && summaryAvailable && tagsAvailable
                      ? t('Brak zmian. Propozycje są takie same jak obecne wartości.', 'No changes. The suggestions match the current values.')
                      : t('Brak zmian do zastosowania.', 'No changes to apply.')}
                  </Text>
                )}
                {proposal.generated.warnings?.map((warning, index) => (
                  <Text
                    key={index}
                    accessibilityRole="alert"
                    style={[styles.choiceValue, { color: colors.ember }]}
                  >
                    {warning}
                  </Text>
                ))}
                {error && (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: colors.ember }]}
                  >
                    {error}
                  </Text>
                )}
                <View style={styles.proposalSection}>
                  <Text
                    style={[styles.choiceSectionTitle, { color: colors.ink }]}
                  >
                    {t('Tytuł', 'Title')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line }]}
                  >
                    {proposalChanges.title ? (
                      <>
                        <ProposalChoice
                          label={t('Obecny', 'Current')}
                          value={note.title.trim() || t('Bez tytułu', 'Untitled')}
                          selected={!selection.title}
                          onPress={() => choose('title', false)}
                        />
                        <View
                          style={[
                            styles.choiceDivider,
                            { backgroundColor: colors.line },
                          ]}
                        />
                        <ProposalChoice
                          reveal
                          active={sheetMode === 'choose' && isFocused}
                          animate={sheetMode === 'choose' && isFocused && !reducedMotion}
                          label={t('Nowy', 'New')}
                          value={proposal.generated.title}
                          selected={selection.title}
                          disabled={discarding}
                          onPress={() => choose('title', true)}
                        />
                      </>
                    ) : (
                        <ProposalValue
                          label={titleAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                          value={note.title.trim() || t('Bez tytułu', 'Untitled')}
                          hint={titleAvailable ? undefined : unavailableValue}
                        />
                    )}
                  </View>
                </View>
                <View style={styles.proposalSection}>
                  <Text
                    style={[styles.choiceSectionTitle, { color: colors.ink }]}
                  >
                    {t('Podsumowanie', 'Summary')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line }]}
                  >
                    {proposalChanges.summary ? (
                      <>
                        <ProposalChoice
                          label={t('Obecne', 'Current')}
                          value={
                            note.summary?.trim() ||
                            t('Brak podsumowania', 'No summary')
                          }
                          selected={!selection.summary}
                          onPress={() => choose('summary', false)}
                        />
                        <View
                          style={[
                            styles.choiceDivider,
                            { backgroundColor: colors.line },
                          ]}
                        />
                        <ProposalChoice
                          reveal
                          active={sheetMode === 'choose' && isFocused}
                          animate={sheetMode === 'choose' && isFocused && !reducedMotion}
                          label={t('Nowe', 'New')}
                          value={
                            proposal.generated.summary.trim() || t('Brak podsumowania', 'No summary')
                          }
                          selected={selection.summary}
                          disabled={discarding}
                          onPress={() => choose('summary', true)}
                        />
                      </>
                    ) : (
                        <ProposalValue
                          label={summaryAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                          value={note.summary?.trim() || t('Brak podsumowania', 'No summary')}
                          hint={summaryAvailable ? undefined : unavailableValue}
                        />
                    )}
                  </View>
                </View>
                <View style={styles.proposalSection}>
                  <Text
                    style={[styles.choiceSectionTitle, { color: colors.ink }]}
                  >
                    {t('Kategorie', 'Categories')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line }]}
                  >
                    {proposalChanges.tags ? (
                      <>
                        <ProposalChoice
                          label={t('Obecne', 'Current')}
                          selected={!selection.tags}
                          onPress={() => choose('tags', false)}
                        >
                          {note.tags.length > 0 ? (
                            <NoteTags
                              tags={note.tags}
                              onChange={() => undefined}
                              editable={false}
                              showLabel={false}
                              compact
                            />
                          ) : (
                            <Text
                              style={[styles.choiceValue, { color: colors.muted }]}
                            >
                              {t('Bez kategorii', 'No categories')}
                            </Text>
                          )}
                        </ProposalChoice>
                        <View
                          style={[
                            styles.choiceDivider,
                            { backgroundColor: colors.line },
                          ]}
                        />
                        <ProposalChoice
                          label={t('Nowe', 'New')}
                          selected={selection.tags}
                          disabled={discarding}
                          onPress={() => choose('tags', true)}
                        >
                          {proposal.generated.tags.length > 0 ? (
                            <NoteTags
                              tags={proposal.generated.tags}
                              onChange={() => undefined}
                              editable={false}
                              showLabel={false}
                              compact
                            />
                          ) : (
                            <Text
                              style={[styles.choiceValue, { color: colors.muted }]}
                            >
                              {t('Bez kategorii', 'No categories')}
                            </Text>
                          )}
                        </ProposalChoice>
                      </>
                    ) : (
                      <ProposalValue
                        label={tagsAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                        hint={tagsAvailable ? undefined : unavailableValue}
                      >
                        {note.tags.length > 0 ? (
                          <NoteTags
                            tags={note.tags}
                            onChange={() => undefined}
                            editable={false}
                            showLabel={false}
                            compact
                          />
                        ) : (
                          <Text
                            style={[styles.choiceValue, { color: colors.muted }]}
                          >
                            {t('Bez kategorii', 'No categories')}
                          </Text>
                      )}
                    </ProposalValue>
                    )}
                  </View>
                </View>
              </>
            ) : (
              <Text style={[styles.choiceValue, { color: colors.muted }]}>
                {t(
                  'Propozycja nie jest już aktualna. Zamknij ekran i wygeneruj ją ponownie.',
                  'The suggestion is no longer current. Close this screen and generate it again.',
                )}
              </Text>
            )}
          </ScrollView>

          <View
            style={[
              styles.choiceFooter,
              {
                backgroundColor: colors.canvas,
                borderTopColor: colors.line,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            {proposal && (
              <Button
                label={t(
                  `Zastosuj ${proposalChangeCount} ${pluralChanges(proposalChangeCount)}`,
                  `Apply ${proposalChangeCount} ${pluralChanges(proposalChangeCount)}`,
                )}
                variant="primary"
                icon="check"
                onPress={() => void applySelected()}
                disabled={proposalChangeCount === 0 || discarding || processing}
              />
            )}
            {proposal && (
              <Button
                label={discarding
                  ? t('Odrzucanie propozycji…', 'Discarding suggestions…')
                  : t('Odrzuć propozycje', 'Discard suggestions')}
                variant="secondary"
                onPress={() => void discardSuggestions()}
                disabled={discarding || processing}
              />
            )}
            <Button
              label={t('Anuluj', 'Cancel')}
              variant="secondary"
              onPress={closeChoices}
              disabled={discarding}
            />
          </View>
        </View>
      </Modal>

      {appliedNotice && (
        <View pointerEvents="box-none" style={styles.noticeHost}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              'Zapisano zmiany. Zamknij powiadomienie',
              'Changes saved. Dismiss notification',
            )}
            accessibilityLiveRegion="polite"
            onPress={() => setAppliedNotice(false)}
            style={[styles.notice, { backgroundColor: colors.action }]}
          >
            <Icon name="check" size={20} color={colors.onAction} />
            <Text style={[styles.noticeText, { color: colors.onAction }]}>
              {t('Zapisano zmiany', 'Changes saved')}
            </Text>
            <Icon name="close" size={18} color={colors.onAction} />
          </Pressable>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
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
    minHeight: 36,
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    flexShrink: 1,
  },
  reprocessText: {
    ...type.label,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
    textAlign: 'right',
  },
  body: { ...type.body, fontSize: 15, lineHeight: 23 },
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
    minHeight: 66,
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
  choiceValueContent: { flex: 1, gap: spacing.xs },
  choiceLabel: { ...type.label },
  choiceValue: { ...type.body, fontSize: 14, lineHeight: 20 },
  choiceScreen: { flex: 1 },
  choiceHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  choiceCancel: { width: 72, minHeight: 44, justifyContent: 'center' },
  headerCancelText: { ...type.label, fontWeight: '500' },
  choiceScreenTitle: { ...type.label, textAlign: 'center', flex: 1 },
  choiceScroll: { flex: 1 },
  choiceScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  choiceIntro: { ...type.body, fontSize: 14, lineHeight: 20 },
  choiceGroup: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  choiceDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.md,
  },
  choiceFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  noticeHost: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
  },
  notice: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  noticeText: { ...type.label, flex: 1 },
})
