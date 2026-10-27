import { useI18n } from '../../i18n/useI18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { useLayoutTransition } from '../../ui/LayoutMotion'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/Icon'
import { useReducedMotion } from '../../ui/Motion'
import { radius, spacing, type, useTheme, fonts } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { useTasksStore } from '../../state/tasksStore'
import { useModelStore } from '../../state/modelStore'
import { formatNoteAsText } from '../../export/noteText'
import { getModelMissingMessage } from '../../ai/noteProcessing'
import { localeForLanguage, type Language } from '../../i18n/language'
import { AudioNotePlayer, type AudioMark, type AudioNotePlayerHandle } from '../../audio/AudioNotePlayer'
import { timeForRanges } from '../../domain/audioTimeline'
import type { Note } from '../../domain/note'
import { NoteTasks } from '../../tasks/NoteTasks'
import { NoteTags } from '../../tags/NoteTags'
import { parseSummaryDocument, type SummaryPoint } from '../../domain/summary'
import { SummaryWithSources } from '../../notes/SummaryWithSources'
import { ProcessingLive } from '../../notes/ProcessingLive'
import { addedWords } from '../../notes/wordDiff'
import { MarkedLabel } from '../../ui/MarkedLabel'
import {
  getEffectiveNoteProposalSelection,
  getNoteProposalChanges,
  isNoteProposalCurrent,
  isNoteProposalFieldAvailable,
  type NoteProposalSelection,
} from '../../notes/noteProposals'
import { supportsBackgroundProcessing } from '../../processing/nativeProcessing'

type ProposalField = keyof NoteProposalSelection
type SheetMode = 'confirm' | 'choose' | 'delete' | null

const CROSSFADE_MS = 200
// The choice screen opens after the processing card has crossfaded away.
const CHOICE_OPEN_DELAY_MS = 420
const EMPTY_SPANS: readonly never[] = []

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

// Fades the new content in over the previous one when `id` changes; the first
// render and reduced motion swap instantly.
function Crossfade({ id, active, reducedMotion, style, children }: {
  id: string
  active: boolean
  reducedMotion: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const progress = useRef(new Animated.Value(1)).current
  const last = useRef({ id, node: children })
  const [outgoing, setOutgoing] = useState<ReactNode>(null)
  useLayoutEffect(() => {
    const previous = last.current
    last.current = { id, node: children }
    if (previous.id === id) return
    progress.stopAnimation()
    if (!active || reducedMotion) {
      progress.setValue(1)
      setOutgoing(null)
      return
    }
    progress.setValue(0)
    setOutgoing(previous.node)
    Animated.timing(progress, { toValue: 1, duration: CROSSFADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setOutgoing(null) })
  })
  return (
    <View style={[style, outgoing ? styles.clipped : undefined]}>
      <Animated.View style={{ opacity: progress }}>{children}</Animated.View>
      {outgoing ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
        >
          {outgoing}
        </Animated.View>
      ) : null}
    </View>
  )
}

function NewVersionBanner({ onOpen, onDiscard, busy, reducedMotion }: {
  onOpen: () => void
  onDiscard: () => void
  busy: boolean
  reducedMotion: boolean
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const appear = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current
  useEffect(() => {
    if (reducedMotion) return
    Animated.timing(appear, { toValue: 1, duration: CROSSFADE_MS, useNativeDriver: true }).start()
  }, [appear, reducedMotion])
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.markerSoft, opacity: appear }]}
    >
      <Text style={[styles.bannerText, { color: colors.ink }]}>{t('Nowa wersja jest gotowa', 'A new version is ready')}</Text>
      <Button compact variant="quiet" label={t('Odrzuć', 'Discard')} onPress={onDiscard} disabled={busy} />
      <Button compact variant="primary" label={t('Zobacz', 'View')} onPress={onOpen} disabled={busy} />
    </Animated.View>
  )
}

function ProposalChoice({
  label,
  value,
  selected,
  disabled = false,
  onPress,
  children,
  compareTo,
}: {
  label: string
  value?: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  children?: ReactNode
  compareTo?: string
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
          backgroundColor: selected ? colors.markerSoft : colors.paper,
          borderLeftColor: selected ? colors.markerLine : 'transparent',
          opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.brand : colors.faint },
          selected && { backgroundColor: colors.brand },
        ]}
      >
        {selected && <Icon name="check" size={14} color={colors.onBrand} />}
      </View>
      <View style={styles.choiceValueContent}>
        <Text style={[styles.choiceLabel, { color: colors.muted }]}>{label}</Text>
        {children ?? (compareTo !== undefined ? (
          <Text style={[styles.choiceValue, { color: colors.body }]}>
            {addedWords(compareTo, value ?? '').map((segment, index) => (
              <Text key={index} style={segment.added ? { color: colors.onMarker, backgroundColor: colors.marker } : undefined}>{segment.text}</Text>
            ))}
          </Text>
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
  const { id, recordingNotice } = useLocalSearchParams<{
    id: string
    recordingNotice?: string
  }>()
  const { colors } = useTheme()
  const { t, language } = useI18n()
  const insets = useSafeAreaInsets()
  const reducedMotion = useReducedMotion()
  const reprocessSweep = useRef(new Animated.Value(1)).current
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === id),
  )
  const loaded = useNotesStore((state) => state.loaded)
  const processingPhase = useNotesStore((state) =>
    id ? state.processing[id]?.phase : undefined,
  )
  const processingLive = useNotesStore((state) =>
    id ? state.processing[id]?.live : undefined,
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
  const choiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [appliedNotice, setAppliedNotice] = useState(false)
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
  // One staged flag drives every visual swap, so a single layout transition
  // and one crossfade replace the processing card with the result.
  const shownProcessing = useLayoutTransition(processing, String(processing), id ?? '', isFocused, reducedMotion)
  // While the model works the note keeps its previous content; the result
  // appears all at once when processing ends.
  const stable = useRef<Note | undefined>(note)
  if (note && (!shownProcessing || stable.current?.id !== note.id)) stable.current = note
  const display: Note | undefined = note && shownProcessing && stable.current?.id === note.id ? stable.current : note
  const provisionalTitle = shownProcessing && !display?.summary?.trim()
  const summaryDocument = useMemo(
    () => display ? parseSummaryDocument(display.summaryDocument, display.content, display.summary) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [display?.summaryDocument, display?.content, display?.summary],
  )
  const playerRef = useRef<AudioNotePlayerHandle>(null)
  const audioSpans = display?.audioTimeline?.spans ?? EMPTY_SPANS
  const pointTime = useCallback((point: SummaryPoint) => timeForRanges(audioSpans, point.sources), [audioSpans])
  const audioMarks = useMemo<AudioMark[]>(
    () => summaryDocument && audioSpans.length > 0 && !shownProcessing
      ? summaryDocument.points.flatMap(point => pointTime(point) ?? [])
      : [],
    [summaryDocument, audioSpans, shownProcessing, pointTime],
  )

  useEffect(() => {
    if (proposal) setSelection(NO_SELECTION)
  }, [proposal])

  useEffect(() => {
    if (!isFocused) setSheetMode(null)
  }, [isFocused])

  useEffect(() => () => {
    if (choiceTimer.current) clearTimeout(choiceTimer.current)
  }, [])

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
      const noteTasks = useTasksStore.getState().tasks.filter((task) => task.noteId === note.id)
      await Share.share({
        message: formatNoteAsText(note, noteTasks, language),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirmDelete = async () => {
    if (!note) return
    setSheetMode(null)
    try {
      await remove(note.id)
      goToList()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const openChoices = () => {
    setSelection(NO_SELECTION)
    setSheetMode('choose')
  }

  const startReprocessing = async (background?: boolean) => {
    if (!note || processing || taskAnalysisBusy) return
    if (note.transcriptionIncomplete) return
    if (proposal) {
      openChoices()
      return
    }
    setError(null)
    setSheetMode(null)
    const generated = await proposeWithLlm(
      note.id,
      background === undefined ? undefined : { background },
    )
    if (!generated || !isFocusedRef.current) return
    const noteId = note.id
    const openWhenReady = () => {
      choiceTimer.current = null
      if (isFocusedRef.current && useNotesStore.getState().proposals[noteId]) openChoices()
    }
    if (reducedMotion) openWhenReady()
    else choiceTimer.current = setTimeout(openWhenReady, CHOICE_OPEN_DELAY_MS)
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

  if (!note || !display) {
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

  const finalSummary = display.summary?.trim() ? (
    <SummaryWithSources
      noteId={display.id}
      revision={display.updatedAt}
      content={display.content}
      summary={display.summary}
      document={display.summaryDocument}
      active={isFocused}
      pointTime={pointTime}
      onPlayFrom={display.audioUri && audioSpans.length > 0 ? (ms) => playerRef.current?.playFrom(ms) : undefined}
    />
  ) : (
    <Text style={[styles.body, { color: colors.muted }]}>{t('Brak podsumowania', 'No summary')}</Text>
  )

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: t('Notatka', 'Note'),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={openEdit}
                disabled={processing}
                accessibilityRole="button"
                accessibilityLabel={t('Edytuj notatkę', 'Edit note')}
                accessibilityState={{ disabled: processing }}
                style={({ pressed }) => [
                  styles.editAction,
                  { borderColor: colors.line, backgroundColor: colors.paper, opacity: processing ? 0.4 : pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.editText, { color: colors.ink }]}>
                  {t('Edytuj', 'Edit')}
                </Text>
              </Pressable>
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
              styles.notePanel,
              { backgroundColor: colors.paper, borderColor: colors.line },
            ]}
            accessibilityRole="alert"
          >
            <Icon name="alert" size={20} color={colors.muted} />
            <Text style={[styles.notePanelText, { color: colors.body }]}>
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
        <Crossfade id={`${provisionalTitle ? 'draft' : 'final'}:${display.title}`} active={isFocused} reducedMotion={reducedMotion}>
          <Text
            accessibilityRole="header"
            style={[styles.noteTitle, { color: provisionalTitle ? colors.faint : colors.ink }]}
          >
            {display.title.trim() || t('Bez tytułu', 'Untitled')}
          </Text>
        </Crossfade>

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

        {(display.tags.length > 0 || shownProcessing) && (
          <Crossfade
            id={`tags:${display.tags.join('|')}`}
            active={isFocused}
            reducedMotion={reducedMotion}
            style={shownProcessing ? styles.tagsSlot : undefined}
          >
            {display.tags.length > 0 ? (
              <NoteTags
                tags={display.tags}
                onChange={() => undefined}
                editable={false}
                showLabel={false}
                compact
              />
            ) : null}
          </Crossfade>
        )}

        {note.audioUri && (
          <AudioNotePlayer
            ref={playerRef}
            uri={note.audioUri}
            durationMs={note.durationMs}
            timeline={note.audioTimeline}
            marks={audioMarks}
          />
        )}

        {proposal && !shownProcessing && sheetMode !== 'choose' && (
          <NewVersionBanner
            onOpen={openChoices}
            onDiscard={() => void discardSuggestions()}
            busy={discarding || processing}
            reducedMotion={reducedMotion}
          />
        )}

        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {t('Podsumowanie', 'Summary')}
            </Text>
            <Pressable
              onPress={() => {
                if (note.transcriptionIncomplete) {
                  if (note.audioUri) router.push({ pathname: '/import', params: { noteId: note.id } })
                  return
                }
                if (!reducedMotion) {
                  reprocessSweep.setValue(0)
                  Animated.timing(reprocessSweep, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
                }
                setSheetMode(proposal ? 'choose' : 'confirm')
              }}
              disabled={reprocessDisabled || shownProcessing}
              accessibilityElementsHidden={shownProcessing}
              importantForAccessibility={shownProcessing ? 'no-hide-descendants' : 'auto'}
              accessibilityLabel={note.transcriptionIncomplete ? t('Uzupełnij i przetwórz', 'Complete and process') : t('Opracuj na nowo', 'Process again')}
              accessibilityRole="button"
              accessibilityState={{
                disabled: reprocessDisabled,
              }}
              style={({ pressed }) => [
                styles.reprocessAction,
                {
                  borderColor: colors.line,
                  backgroundColor: colors.paper,
                  opacity: shownProcessing ? 0 : reprocessDisabled ? 0.45 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
              ]}
            >
              {note.transcriptionIncomplete ? (
                <Text style={[styles.reprocessText, { color: colors.ink }]}>
                  {t('Uzupełnij i przetwórz', 'Complete and process')}
                </Text>
              ) : (
                <MarkedLabel lead={t('Opracuj', 'Process')} marked={t('na nowo', 'again')} sweep={reprocessSweep} />
              )}
            </Pressable>
          </View>
          <Crossfade
            id={shownProcessing ? 'live' : `final:${display.summary ?? ''}`}
            active={isFocused}
            reducedMotion={reducedMotion}
          >
            {shownProcessing ? (
              <View style={{ gap: spacing.md }}>
                <ProcessingLive content={note.content} live={processingLive} phase={processingPhase} reducedMotion={reducedMotion} />
                <Button
                  label={t('Wstrzymaj', 'Pause')}
                  variant="secondary"
                  onPress={() =>
                    void useNotesStore.getState().pauseProcessing(note.id)
                  }
                />
              </View>
            ) : finalSummary}
          </Crossfade>
          {processError && !processing && (
            <View
              style={[
                styles.notePanel,
                { backgroundColor: colors.paper, borderColor: colors.line },
              ]}
            >
              <Icon name="alert" size={16} color={colors.danger} />
              <Text
                style={[styles.notePanelText, { color: colors.body }]}
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
          {!processing && !modelReady && (
            <Text style={[styles.hint, { color: colors.muted }]}>
              {getModelMissingMessage()}
            </Text>
          )}
        </View>

        <View style={{ height: spacing.sm }} />
        <NoteTasks
          noteId={note.id}
          content={note.content}
          onBusyChange={setTaskAnalysisBusy}
        />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            {note.content.trim()
              ? t(`Transkrypt · ${note.content.trim() ? note.content.trim().split(/\s+/u).length : 0} sł.`, `Transcript · ${note.content.trim() ? note.content.trim().split(/\s+/u).length : 0} words`)
              : t('Transkrypt', 'Transcript')}
          </Text>
          {note.transcriptionIncomplete && (
            <View style={{ gap: spacing.sm }}>
              <Text accessibilityRole="alert" style={[styles.hint, { color: colors.danger }]}>
                {t(
                  'Audio zostało zapisane. Transkrypcja może być niepełna.',
                  'Audio has been saved. The transcript may be incomplete.',
                )}
              </Text>
              {note.audioUri && (
                <Button
                  label={t('Uzupełnij transkrypcję', 'Complete transcript')}
                  variant="secondary"
                  disabled={processing || taskAnalysisBusy}
                  onPress={() => router.push({ pathname: '/import', params: { noteId: note.id } })}
                />
              )}
            </View>
          )}
          <View style={[styles.transcriptCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
            <Text
              selectable
              style={[
                styles.transcript,
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
          {note.audioUri && !note.transcriptionIncomplete && (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('Ponowna transkrypcja zastąpi obecny tekst.', 'Transcribing again replaces the current text.')}
              disabled={processing || taskAnalysisBusy}
              onPress={() => router.push({ pathname: '/import', params: { noteId: note.id } })}
              style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: processing || taskAnalysisBusy ? 0.45 : pressed ? 0.6 : 1 })}
            >
              <Text style={[styles.retranscribe, { color: colors.ink, textDecorationColor: colors.markerLine }]}>
                {t('Brakuje fragmentów? Przepisz nagranie jeszcze raz', 'Parts missing? Transcribe the recording again')}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.line, marginTop: spacing.lg }]} />
        <Button
          label={t('Usuń notatkę', 'Delete note')}
          variant="danger"
          onPress={() => setSheetMode('delete')}
          disabled={processing}
        />
      </ScrollView>

      <BottomSheet
        visible={sheetMode === 'delete' && isFocused}
        onClose={() => setSheetMode(null)}
        title={t('Usunąć notatkę?', 'Delete note?')}
      >
        <Text style={[styles.sheetMessage, { color: colors.muted }]}>
          {t('Tej operacji nie można cofnąć.', 'This action cannot be undone.')}
        </Text>
        <Button label={t('Usuń', 'Delete')} variant="danger" onPress={() => void confirmDelete()} />
        <Button label={t('Anuluj', 'Cancel')} variant="quiet" onPress={() => setSheetMode(null)} />
      </BottomSheet>

      <BottomSheet
        visible={sheetMode === 'confirm' && isFocused}
        onClose={() => setSheetMode(null)}
        title={t('Opracować na nowo?', 'Process again?')}
      >
        {sheetMode === 'confirm' && (
          <>
            <Text style={[styles.sheetMessage, { color: colors.muted }]}>
              {t(
                'Model przeczyta transkrypt jeszcze raz i przygotuje propozycję. Potem porównasz ją z obecną wersją i wybierzesz, co zmienić.',
                'The model reads the transcript again and prepares a suggestion. Then you compare it with the current version and choose what to change.',
              )}
            </Text>
            <View>
              <Text style={[styles.choiceSectionTitle, { color: colors.muted }]}>
                {t('Co przygotuję', 'What I will prepare')}
              </Text>
              {[
                { label: t('Streszczenie', 'Summary'), detail: note.summary?.trim() ? t('zastąpi obecne, jeśli wybierzesz', 'replaces the current one if you choose') : t('notatka nie ma jeszcze streszczenia', 'the note has no summary yet') },
                { label: t('Tytuł', 'Title'), detail: `„${note.title.trim() || t('Bez tytułu', 'Untitled')}”` },
                { label: t('Kategorie', 'Categories'), detail: note.tags.length ? t(`teraz: ${note.tags.length}`, `now: ${note.tags.length}`) : t('teraz brak', 'none yet') },
              ].map((row, index) => (
                <View key={row.label} style={[styles.prepareRow, index < 2 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
                  <View style={[styles.prepareDot, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: colors.ink, fontFamily: fonts.medium }]}>{row.label}</Text>
                    <Text style={[type.meta, { color: colors.muted }]} numberOfLines={1}>{row.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
            <View style={[styles.offlineNote, { backgroundColor: colors.canvas }]}>
              <Icon name="lock" size={18} color={colors.ink} />
              <Text style={[type.meta, { color: colors.body, flex: 1, fontSize: 13, lineHeight: 19 }]}>
                {t('Działa na telefonie, bez internetu. Możesz w tym czasie wrócić do listy.', 'Runs on this phone, without internet. You can go back to the list meanwhile.')}
              </Text>
            </View>
            <Button
              label={t('Przygotuj propozycję', 'Prepare suggestion')}
              variant="primary"
              onPress={() => void startReprocessing()}
              disabled={!modelReady || processing || taskAnalysisBusy}
            />
            {supportsBackgroundProcessing() && (
              <Button
                label={t('Przygotuj w tle', 'Prepare in the background')}
                variant="secondary"
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
              variant="quiet"
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
            <View style={styles.choiceCancel}>
              <Button
                compact
                variant="quiet"
                label={t('Anuluj', 'Cancel')}
                onPress={closeChoices}
                disabled={discarding}
              />
            </View>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.choiceScreenTitle, { color: colors.ink }]}
            >
              {t('Nowa wersja', 'New version')}
            </Text>
            <View style={styles.choiceCancel} />
          </View>

          <ScrollView
            style={styles.choiceScroll}
            contentContainerStyle={styles.choiceScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: spacing.xs }}>
              <Text style={[type.display, { fontSize: 28, lineHeight: 34, color: colors.ink }]}>
                {t('Co zmienić?', 'What should change?')}
              </Text>
              <Text style={[styles.choiceIntro, { color: colors.muted }]}>
                {t(
                  'Nowe fragmenty są zakreślone. Dopóki nic nie wybierzesz, zostaje obecna wersja.',
                  'New parts are highlighted. Until you pick something, the current version stays.',
                )}
              </Text>
            </View>
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
                    style={[styles.choiceValue, { color: colors.muted }]}
                  >
                    {warning}
                  </Text>
                ))}
                {error && (
                  <Text
                    accessibilityRole="alert"
                    style={[styles.error, { color: colors.danger }]}
                  >
                    {error}
                  </Text>
                )}
                <View style={styles.proposalSection}>
                  <Text
                    style={[styles.choiceSectionTitle, { color: colors.muted }]}
                  >
                    {t('Tytuł', 'Title')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line, backgroundColor: colors.paper }]}
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
                          label={t('Nowy', 'New')}
                          value={proposal.generated.title}
                          compareTo={note.title}
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
                    style={[styles.choiceSectionTitle, { color: colors.muted }]}
                  >
                    {t('Podsumowanie', 'Summary')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line, backgroundColor: colors.paper }]}
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
                          label={t('Nowe', 'New')}
                          value={
                            proposal.generated.summary.trim() || t('Brak podsumowania', 'No summary')
                          }
                          compareTo={note.summary ?? ''}
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
                    style={[styles.choiceSectionTitle, { color: colors.muted }]}
                  >
                    {t('Kategorie', 'Categories')}
                  </Text>
                  <View
                    style={[styles.choiceGroup, { borderColor: colors.line, backgroundColor: colors.paper }]}
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
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  editText: { ...type.label, fontSize: 15 },
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
  sectionTitle: { ...type.label, fontSize: 13, lineHeight: 18 },
  reprocessAction: {
    minHeight: 36,
    maxWidth: '62%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 1,
  },
  reprocessText: {
    ...type.label,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  body: { ...type.body, fontSize: 15, lineHeight: 23 },
  transcriptCard: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  transcript: { ...type.body, fontSize: 16, lineHeight: 26 },
  retranscribe: { ...type.label, textDecorationLine: 'underline', textDecorationStyle: 'solid' },
  hint: { ...type.meta },
  error: { ...type.body },
  notePanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notePanelText: { fontSize: 14, lineHeight: 20, flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bannerText: { ...type.label, flex: 1 },
  clipped: { overflow: 'hidden' },
  tagsSlot: { minHeight: 28 },
  sheetIntro: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetMessage: { ...type.body, fontSize: 15, lineHeight: 22 },
  prepareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  prepareDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  offlineNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  proposalSection: { gap: spacing.sm },
  choiceSectionTitle: { ...type.label },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 66,
    padding: spacing.md,
    borderLeftWidth: 3,
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
  choiceLabel: { ...type.meta, fontFamily: fonts.semibold },
  choiceValue: { ...type.body, fontSize: 15, lineHeight: 22 },
  choiceScreen: { flex: 1 },
  choiceHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  choiceCancel: { width: 96, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  choiceScreenTitle: { ...type.label, fontSize: 15, textAlign: 'center', flex: 1 },
  choiceScroll: { flex: 1 },
  choiceScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  choiceIntro: { ...type.body, fontSize: 15, lineHeight: 22 },
  choiceGroup: {
    borderWidth: 1,
    borderRadius: radius.lg,
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
