import { useI18n } from '../../i18n/useI18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
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
import { spacing, type, useTheme } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { useTasksStore } from '../../state/tasksStore'
import { useModelStore } from '../../state/modelStore'
import { formatNoteAsText } from '../../export/noteText'
import { ModelDownloadBanner } from '../../notes/ModelDownloadBanner'
import { AudioNotePlayer, type AudioMark, type AudioNotePlayerHandle } from '../../audio/AudioNotePlayer'
import { timeForRanges } from '../../domain/audioTimeline'
import type { Note } from '../../domain/note'
import { NoteTasks } from '../../tasks/NoteTasks'
import { parseSummaryDocument, type SummaryPoint } from '../../domain/summary'
import { SummaryWithSources } from '../../notes/SummaryWithSources'
import { ProcessingLive } from '../../notes/ProcessingLive'
import {
  getEffectiveNoteProposalSelection,
  getNoteProposalChanges,
  isNoteProposalCurrent,
  type NoteProposalSelection,
} from '../../notes/noteProposals'
import { Crossfade } from '../../notes/detail/Crossfade'
import { NewVersionBanner } from '../../notes/detail/NewVersionBanner'
import { NoteDetailHeader } from '../../notes/detail/NoteDetailHeader'
import { NoteMeta } from '../../notes/detail/NoteMeta'
import { noteMenuActions, type NoteMenuKey } from '../../notes/detail/noteMenuActions'
import { ProposalChooser, type ProposalField } from '../../notes/detail/ProposalChooser'
import { ReprocessConfirmSheet } from '../../notes/detail/ReprocessConfirmSheet'
import { TranscriptRow } from '../../notes/detail/TranscriptRow'

type SheetMode = 'confirm' | 'choose' | 'delete' | null

// The choice screen opens after the processing card has crossfaded away.
const CHOICE_OPEN_DELAY_MS = 420
const EMPTY_SPANS: readonly never[] = []

const NO_SELECTION: NoteProposalSelection = {
  title: false,
  summary: false,
  tags: false,
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

  if (!note || !display) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.canvas }]}>
        <Stack.Screen options={{ title: t('Notatka', 'Note') }} />
        <Text style={[styles.body, { color: colors.secondary }]}>
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

  const reprocessDisabled = !modelReady || taskAnalysisBusy ||
    (note.transcriptionIncomplete ? !note.audioUri : !note.content.trim())
  const proposalChangeCount = Object.values(effectiveSelection).filter(Boolean).length
  const openImport = () => router.push({ pathname: '/import', params: { noteId: note.id } })

  // An incomplete transcript is completed first; otherwise the existing
  // proposal opens, or the confirmation before a new one.
  const requestReprocess = () => {
    if (reprocessDisabled || shownProcessing) return
    if (note.transcriptionIncomplete) {
      if (note.audioUri) openImport()
      return
    }
    setSheetMode(proposal ? 'choose' : 'confirm')
  }

  const menuActions = noteMenuActions({
    language,
    hasAudio: Boolean(note.audioUri),
    transcriptionIncomplete: Boolean(note.transcriptionIncomplete),
    resumable: Boolean(resumableProcessing),
    processing,
    modelReady,
    reprocessDisabled: reprocessDisabled || shownProcessing,
    taskAnalysisBusy: processing || taskAnalysisBusy,
  })
  const onMenuSelect = (key: NoteMenuKey) => {
    if (key === 'edit') openEdit()
    else if (key === 'resume') void useNotesStore.getState().resumeProcessing(note.id)
    else if (key === 'reprocess') requestReprocess()
    else if (key === 'retranscribe') openImport()
    else if (key === 'export') void shareNote()
    else setSheetMode('delete')
  }

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
    <Text style={[styles.body, { color: colors.secondary }]}>{t('Brak podsumowania', 'No summary')}</Text>
  )

  return (
    <>
      <NoteDetailHeader
        actions={menuActions}
        disabled={processing}
        onShare={() => void shareNote()}
        onSelect={onMenuSelect}
      />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        style={{ backgroundColor: colors.canvas }}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.lg) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {recordingNotice && (
          <View
            style={[styles.notePanel, styles.notePanelTop, { backgroundColor: colors.group }]}
            accessibilityRole="alert"
          >
            <Icon name="alert" size={20} color={colors.secondary} />
            <Text style={[styles.notePanelText, { color: colors.ink }]}>
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
        <NoteMeta createdAt={note.createdAt} tags={display.tags} />

        {note.transcriptionIncomplete && (
          <View style={styles.incomplete}>
            <Text accessibilityRole="alert" style={[type.meta, { color: colors.secondary }]}>
              {t(
                'Audio zostało zapisane. Transkrypcja może być niepełna.',
                'Audio has been saved. The transcript may be incomplete.',
              )}
            </Text>
            <Button
              label={t('Uzupełnij i przetwórz', 'Complete and process')}
              variant="secondary"
              onPress={openImport}
              disabled={!note.audioUri || processing || shownProcessing || taskAnalysisBusy}
            />
          </View>
        )}

        {note.audioUri && (
          <View style={styles.player}>
            <AudioNotePlayer
              ref={playerRef}
              uri={note.audioUri}
              durationMs={note.durationMs}
              timeline={note.audioTimeline}
              marks={audioMarks}
            />
          </View>
        )}

        {proposal && !shownProcessing && sheetMode !== 'choose' && (
          <NewVersionBanner
            onOpen={openChoices}
            onDiscard={() => void discardSuggestions()}
            busy={discarding || processing}
            reducedMotion={reducedMotion}
          />
        )}

        <Text accessibilityRole="header" style={[styles.caption, { color: colors.secondary }]}>
          {t('Podsumowanie', 'Summary')}
        </Text>
        <View style={styles.section}>
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
            <View style={[styles.notePanel, { backgroundColor: colors.group }]}>
              <Icon name="alert" size={16} color={colors.danger} />
              <Text style={[styles.notePanelText, { color: colors.ink }]}>
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
          {!processing && !modelReady && <ModelDownloadBanner inset={0} />}
        </View>

        <View style={styles.tasks}>
          <NoteTasks
            noteId={note.id}
            content={note.content}
            onBusyChange={setTaskAnalysisBusy}
          />
        </View>

        <TranscriptRow content={note.content} hasAudio={Boolean(note.audioUri)} />
      </ScrollView>

      <BottomSheet
        visible={sheetMode === 'delete' && isFocused}
        onClose={() => setSheetMode(null)}
        title={t('Usunąć notatkę?', 'Delete note?')}
      >
        <Text style={[styles.body, { color: colors.secondary }]}>
          {t('Tej operacji nie można cofnąć.', 'This action cannot be undone.')}
        </Text>
        <Button label={t('Usuń', 'Delete')} variant="danger" onPress={() => void confirmDelete()} />
        <Button label={t('Anuluj', 'Cancel')} variant="quiet" onPress={() => setSheetMode(null)} />
      </BottomSheet>

      <ReprocessConfirmSheet
        visible={sheetMode === 'confirm' && isFocused}
        note={note}
        modelReady={modelReady}
        disabled={!modelReady || processing || taskAnalysisBusy}
        onStart={(background) => void startReprocessing(background)}
        onClose={() => setSheetMode(null)}
      />

      <ProposalChooser
        visible={sheetMode === 'choose' && isFocused}
        reducedMotion={reducedMotion}
        note={note}
        proposal={proposal}
        proposalCurrent={proposalCurrent}
        selection={selection}
        changeCount={proposalChangeCount}
        error={error}
        discarding={discarding}
        processing={processing}
        onChoose={choose}
        onApply={() => void applySelected()}
        onDiscard={() => void discardSuggestions()}
        onClose={closeChoices}
      />

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
            style={[styles.notice, { backgroundColor: colors.accent }]}
          >
            <Icon name="check" size={20} color={colors.onAccent} />
            <Text style={[styles.noticeText, { color: colors.onAccent }]}>
              {t('Zapisano zmiany', 'Changes saved')}
            </Text>
            <Icon name="close" size={18} color={colors.onAccent} />
          </Pressable>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  noteTitle: { ...type.noteTitle, letterSpacing: -0.2 },
  incomplete: { marginTop: 16, gap: spacing.sm },
  player: { marginTop: 16 },
  caption: {
    ...type.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 24,
    marginBottom: 8,
  },
  section: { gap: spacing.md },
  tasks: { marginTop: 24 },
  body: { ...type.body },
  error: { ...type.body, marginBottom: spacing.sm },
  notePanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notePanelTop: { marginBottom: spacing.md },
  notePanelText: { ...type.meta, flex: 1 },
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
    borderRadius: 12,
    paddingHorizontal: spacing.md,
  },
  noticeText: { ...type.label, flex: 1 },
})
