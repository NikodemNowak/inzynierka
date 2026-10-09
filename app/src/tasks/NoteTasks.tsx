import { useI18n } from '../i18n/useI18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useIsFocused } from 'expo-router/react-navigation'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProcessingIndicator, SkeletonText, useReducedMotion } from '../ui/Motion'
import { TaskArrival, TaskCheck, TaskText, TaskPlaceholder, publishPersistedTaskText, useTaskMotionActive, useTaskTextReveal, usePlaceholderExit, useTaskRevealSequence } from './TaskMotion'
import { useLayoutTransition } from '../ui/LayoutMotion'
import { radius, spacing, type, useTheme } from '../ui/theme'
import { useTasksStore } from '../state/tasksStore'
import { useNotesStore } from '../state/notesStore'
import { useModelStore } from '../state/modelStore'
import { enqueueLlm } from '../ai/llmQueue'
import { createTaskProposal, type TaskProposal } from '../ai/taskProposal'
import { ensureModelReady, getModelMissingMessage } from '../ai/noteProcessing'
import type { Language } from '../i18n/language'
import { runDurableProcessing } from '../processing/jobRunner'
import { jobSourceIdentity } from '../processing/jobIdentity'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { PIPELINE_VERSION } from '../ai/processingContext'
import { recordOperationTiming } from '../ai/generationMetrics'
import { useSettingsStore } from '../state/settingsStore'
import {
  discardPendingProcessingResult,
  findPendingProcessingResult,
} from '../data/processingJobsRepository'
import {
  isTaskProposalResult,
  parseSavedProcessingResult,
} from '../processing/savedResults'

export function NoteTasks({
  noteId,
  content,
  onBusyChange,
}: {
  noteId: string
  content: string
  onBusyChange?: (busy: boolean) => void
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const reducedMotion = useReducedMotion()
  const allTasks = useTasksStore((state) => state.tasks)
  const tasks = useMemo(
    () => allTasks.filter((task) => task.noteId === noteId),
    [allTasks, noteId],
  )
  const addForNote = useTasksStore((state) => state.addForNote)
  const toggle = useTasksStore((state) => state.toggle)
  const remove = useTasksStore((state) => state.remove)
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === noteId),
  )
  const noteProcessing = useNotesStore((state) =>
    Boolean(state.processing[noteId]),
  )
  const modelReady = useModelStore((state) => state.status === 'ready')
  const isFocused = useIsFocused()
  const motionActive = useTaskMotionActive(isFocused)

  const [proposals, setProposals] = useState<string[]>([])
  const [proposalWarnings, setProposalWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [sourceContent, setSourceContent] = useState<string | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<Language | null>(null)
  const [sourceIdentity, setSourceIdentity] = useState<string | null>(null)
  const suggestionVersion = useRef(0)
  const generationInFlight = useRef<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [statusStage, setStatusStage] = useState<'queued' | 'loading' | 'processing'>('queued')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const actionInFlight = useRef(false)
  const [addedCount, setAddedCount] = useState(0)
  const busy = status !== null || saving || discarding
  const currentIdentity = note ? jobSourceIdentity(note) : null
  const proposalReveal = useTaskTextReveal(motionActive, reducedMotion, `${noteId}:${currentIdentity}`)
  const savedReveal = useTaskTextReveal(motionActive, reducedMotion, `${noteId}:${currentIdentity}`)
  const [proposalBatch, setProposalBatch] = useState(0)

  useEffect(() => {
    // Proposals and warnings describe one source revision. Invalidate them
    // before looking up a saved result for the new content or language.
    suggestionVersion.current += 1
    generationInFlight.current = null
    actionInFlight.current = false
    setStatus(null)
    setSaving(false)
    setDiscarding(false)
    setProposals([])
    setProposalWarnings([])
    setSelected(new Set())
    setSourceContent(null)
    setSourceLanguage(null)
    setSourceIdentity(null)
    setError(null)
    setAddedCount(0)
    setProposalBatch(0)
  }, [noteId, content, currentIdentity])

  useEffect(() => () => {
    suggestionVersion.current += 1
    generationInFlight.current = null
  }, [])

  useEffect(() => {
    if (!currentIdentity) return
    let active = true
    const version = suggestionVersion.current
    void findPendingProcessingResult({
      noteId,
      kind: 'tasks',
      source: currentIdentity,
      model: MODEL_CONFIG.url,
      pipeline: PIPELINE_VERSION,
    })
      .then((saved) => {
        if (!active || version !== suggestionVersion.current) return
        const found = parseSavedProcessingResult(
          saved,
          (value): value is TaskProposal =>
            isTaskProposalResult(value, content),
        )
        if (!found || note?.transcriptionIncomplete) return
        const existing = new Set(
          useTasksStore
            .getState()
            .tasks.filter((task) => task.noteId === noteId)
            .map((task) => task.text.trim().toLocaleLowerCase()),
        )
        const fresh = [...new Set(found.tasks)].filter(
          (task) => !existing.has(task.trim().toLocaleLowerCase()),
        )
        setSourceContent(content)
        setSourceLanguage(note?.language ?? 'pl')
        setSourceIdentity(currentIdentity)
        setProposals(fresh)
        setProposalWarnings(found.warnings)
        setSelected(new Set(fresh))
      })
      .catch((cause: unknown) => {
        if (active && version === suggestionVersion.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [noteId, currentIdentity, content, note?.language])

  useEffect(() => {
    onBusyChange?.(busy)
    return () => {
      if (busy) onBusyChange?.(false)
    }
  }, [busy, onBusyChange])

  const propose = async () => {
    if (busy || actionInFlight.current || generationInFlight.current !== null) return
    if (
      proposals.length > 0 &&
      sourceContent === content &&
      sourceLanguage === (note?.language ?? 'pl')
    ) {
      return
    }
    if (!note) {
      setError(t('Ta notatka już nie istnieje.', 'This note no longer exists.'))
      return
    }
    if (note.transcriptionIncomplete) {
      setError(t(
        'Najpierw uzupełnij transkrypcję z zachowanego audio.',
        'Complete the transcript from the saved audio first.',
      ))
      return
    }
    if (useNotesStore.getState().processing[noteId]) {
      setError(
        t(
          'Poczekaj na zakończenie opracowywania notatki.',
          'Wait until the note has finished processing.',
        ),
      )
      return
    }
    if (content.trim().length === 0) {
      setError(t('Notatka jest pusta', 'The note is empty'))
      return
    }
    setError(null)
    setAddedCount(0)
    setProposalWarnings([])
    const version = ++suggestionVersion.current
    generationInFlight.current = version
    const snapshot = content
    const snapshotLanguage = note.language ?? 'pl'
    const snapshotIdentity = jobSourceIdentity(note)
    const ownsView = () => suggestionVersion.current === version && generationInFlight.current === version
    const sourceIsCurrent = () => {
      const current = useNotesStore.getState().notes.find((item) => item.id === noteId)
      return Boolean(current && !current.transcriptionIncomplete && jobSourceIdentity(current) === snapshotIdentity)
    }
    const reportStatus = (label: string) => {
      if (ownsView() && sourceIsCurrent()) setStatus(label)
    }
    setStatus(t('Przygotowuję propozycje…', 'Preparing suggestions…'))
    setStatusStage('queued')
    const requestedAt = Date.now()
    let queueMs = 0
    let modelLoadMs: number | null = null
    let succeeded = false
    const revealFreshProposal = proposalReveal.prepare()
    try {
      const found = await enqueueLlm(async () => {
        queueMs = Date.now() - requestedAt
        if (!sourceIsCurrent()) return null
        return runDurableProcessing(
          {
            noteId,
            kind: 'tasks',
            source: jobSourceIdentity(note),
            model: MODEL_CONFIG.url,
            pipeline: PIPELINE_VERSION,
          },
          async (execution) => {
            await ensureModelReady(
              () => {
                if (ownsView() && sourceIsCurrent()) setStatusStage('loading')
                reportStatus(t('Wczytuję model…', 'Loading model…'))
              },
              (durationMs) => {
                modelLoadMs = durationMs
              },
              execution,
            )
            if (ownsView() && sourceIsCurrent()) setStatusStage('processing')
            reportStatus(t('Opracowuję tekst…', 'Processing text…'))
            return createTaskProposal(
              snapshot.trim(),
              reportStatus,
              snapshotLanguage,
              execution,
            )
          },
          async () => {
            succeeded = sourceIsCurrent()
            return succeeded
          },
          { background: useSettingsStore.getState().backgroundProcessing },
          (progress) => {
            reportStatus(
              t(
                `Analizuję · ${progress.completed}/${progress.total}`,
                `Analyzing · ${progress.completed}/${progress.total}`,
              ),
            )
          },
          (value): value is TaskProposal =>
            isTaskProposalResult(value, snapshot),
        )
      })
      if (!ownsView()) return
      if (!found || !sourceIsCurrent()) {
        setError(
          t(
            'Treść lub język notatki zmieniły się podczas analizy. Spróbuj ponownie.',
            'The note content or language changed during analysis. Try again.',
          ),
        )
        return
      }
      const existing = new Set(
        useTasksStore
          .getState()
          .tasks.filter((task) => task.noteId === noteId)
          .map((task) => task.text.trim().toLocaleLowerCase()),
      )
      const seen = new Set<string>()
      const fresh = found.tasks.filter((text) => {
        const key = text.trim().toLocaleLowerCase()
        if (!key || existing.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      setSourceContent(snapshot)
      setSourceLanguage(snapshotLanguage)
      setSourceIdentity(snapshotIdentity)
      setProposals(fresh)
      const revealAccepted = revealFreshProposal(fresh)
      setProposalBatch(batch => revealAccepted ? batch + 1 : 0)
      setProposalWarnings(found.warnings)
      setSelected(new Set(fresh))
      if (fresh.length === 0) {
        setError(
          t(
            'Model nie znalazł nowych zadań w tej notatce',
            'The model found no new tasks in this note',
          ),
        )
      }
    } catch (cause) {
      if (ownsView()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      recordOperationTiming({
        operation: 'tasks',
        inputChars: content.trim().length,
        queueMs,
        modelLoadMs,
        totalMs: Date.now() - requestedAt,
        succeeded,
      })
      if (ownsView()) {
        generationInFlight.current = null
        setStatus(null)
      }
    }
  }

  const toggleProposal = (text: string) => {
    if (actionInFlight.current) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(text)) next.delete(text)
      else next.add(text)
      return next
    })
  }

  const addSelected = async () => {
    if (actionInFlight.current) return
    const currentNote = useNotesStore
      .getState()
      .notes.find((item) => item.id === noteId)
    if (!currentNote) {
      setError(t('Ta notatka już nie istnieje.', 'This note no longer exists.'))
      return
    }
    if (useNotesStore.getState().processing[noteId]) {
      setError(
        t(
          'Poczekaj na zakończenie opracowywania notatki.',
          'Wait until the note has finished processing.',
        ),
      )
      return
    }
    if (
      sourceContent === null ||
      sourceIdentity !== jobSourceIdentity(currentNote) ||
      currentNote.transcriptionIncomplete ||
      currentNote.content !== sourceContent ||
      (currentNote.language ?? 'pl') !== sourceLanguage
    ) {
      setError(
        t(
          'Treść lub język notatki zmieniły się. Wygeneruj propozycje ponownie.',
          'The note content or language has changed. Generate suggestions again.',
        ),
      )
      setProposals([])
      setProposalWarnings([])
      setSelected(new Set())
      return
    }
    const chosen = proposals.filter((text) => selected.has(text))
    if (chosen.length === 0) return
    actionInFlight.current = true
    setSaving(true)
    const existingIds = new Set(useTasksStore.getState().tasks.map((task) => task.id))
    const revealSavedTasks = savedReveal.prepare()
    const version = ++suggestionVersion.current
    try {
      await addForNote(noteId, chosen)
      const chosenTexts = new Set(chosen.map((text) => text.trim()))
      const createdIds = useTasksStore.getState().tasks
        .filter((task) => task.noteId === noteId && !existingIds.has(task.id) && chosenTexts.has(task.text.trim())).map((task) => task.id)
      const currentSource = useNotesStore.getState().notes.find((item) => item.id === noteId)
      if (currentSource?.content === sourceContent && (currentSource.language ?? 'pl') === sourceLanguage &&
          revealSavedTasks(createdIds)) publishPersistedTaskText(createdIds)
      if (sourceIdentity)
        await discardPendingProcessingResult(noteId, 'tasks', sourceIdentity)
      if (version !== suggestionVersion.current) return
      setAddedCount(useTasksStore.getState().tasks.filter((task) => task.noteId === noteId && !existingIds.has(task.id)).length)
      setError(null)
      setProposals([])
      setProposalWarnings([])
      setSelected(new Set())
      setSourceContent(null)
      setSourceLanguage(null)
      setSourceIdentity(null)
    } catch (cause) {
      if (version === suggestionVersion.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (version === suggestionVersion.current) {
        actionInFlight.current = false
        setSaving(false)
      }
    }
  }

  const cancelProposals = async () => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setDiscarding(true)
    const version = ++suggestionVersion.current
    try {
      if (sourceIdentity)
        await discardPendingProcessingResult(noteId, 'tasks', sourceIdentity)
      if (version !== suggestionVersion.current) return
      setProposals([])
      setProposalWarnings([])
      setSelected(new Set())
      setSourceContent(null)
      setSourceLanguage(null)
      setSourceIdentity(null)
      setError(null)
    } catch (cause: unknown) {
      if (version === suggestionVersion.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (version === suggestionVersion.current) {
        actionInFlight.current = false
        setDiscarding(false)
      }
    }
  }

  const desiredView = { tasks, proposals, loading: Boolean(status) && proposals.length === 0, noteProcessing, addedCount, proposalWarnings }
  const viewScope = currentIdentity ?? noteId
  const shown = useLayoutTransition(desiredView, JSON.stringify(desiredView), viewScope, motionActive, reducedMotion)
  const exitingPlaceholders = usePlaceholderExit(shown.loading, shown.proposals.length, viewScope, motionActive, reducedMotion)
  const proposalSequence = useTaskRevealSequence(shown.proposals, proposalBatch > 0 ? String(proposalBatch) : null, viewScope, motionActive, reducedMotion)
  const proposalSlots = [...new Set([
    ...shown.proposals.map((_, index) => index),
    ...(shown.loading && motionActive ? [0, 1, 2] : exitingPlaceholders),
  ])].sort((left, right) => left - right)

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.ink }]}>
        {t('Zadania', 'Tasks')}
      </Text>

      {shown.tasks.map((task, index) => (
        <TaskArrival key={task.id} index={index} active={motionActive} reducedMotion={reducedMotion} style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={task.text}
            accessibilityState={{ checked: task.done }}
            onPress={() => {
              void toggle(task.id).catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
            }}
            style={styles.checkPressable}
          >
            <TaskCheck
              checked={task.done}
              active={motionActive}
              reducedMotion={reducedMotion}
              size={15}
              style={[
                styles.checkbox,
                {
                  borderColor: task.done ? colors.action : colors.faint,
                  backgroundColor: task.done ? colors.action : 'transparent',
                },
              ]}
            />
          </Pressable>
          <TaskText
            key={`${currentIdentity}:${task.id}`}
            text={task.text}
            index={index}
            reveal={savedReveal.ids.has(task.id)}
            active={motionActive}
            reducedMotion={reducedMotion}
            onRevealConsumed={() => savedReveal.consume(task.id)}
            style={[
              styles.taskText,
              { color: task.done ? colors.muted : colors.ink },
              task.done && styles.taskDone,
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              `Usuń zadanie: ${task.text}`,
              `Delete task: ${task.text}`,
            )}
            onPress={() => {
              Alert.alert(
                t('Usunąć zadanie?', 'Delete task?'),
                task.text,
                [
                  { text: t('Anuluj', 'Cancel'), style: 'cancel' },
                  {
                    text: t('Usuń', 'Delete'),
                    style: 'destructive',
                    onPress: () => {
                      void remove(task.id).catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : String(cause),
                        ),
                      )
                    },
                  },
                ],
                { cancelable: true },
              )
            }}
            hitSlop={8}
          >
            <Icon name="close" size={18} color={colors.faint} />
          </Pressable>
        </TaskArrival>
      ))}
      {shown.tasks.length === 0 &&
        shown.proposals.length === 0 &&
        !busy &&
        !noteProcessing && (
          <Text style={[styles.empty, { color: colors.muted }]}>
            {!content.trim()
              ? t(
                  'Propozycje zadań wymagają treści lub transkrypcji.',
                  'Task suggestions need note content or a transcript.',
                )
              : modelReady
                ? t(
                    'Nie ma jeszcze zadań. Możesz zaproponować je na podstawie notatki.',
                    'No tasks yet. You can suggest them from this note.',
                  )
                : `${t('Nie ma jeszcze zadań.', 'No tasks yet.')} ${getModelMissingMessage()}`}
          </Text>
        )}

      {error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>
      )}
      {shown.addedCount > 0 && <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.accent }]}>
        {t(`Dodano zadania (${shown.addedCount})`, `Tasks added (${shown.addedCount})`)}
      </Text>}
      {shown.proposalWarnings.map((warning) => (
        <Text key={warning} accessibilityRole="alert" style={[styles.status, { color: colors.body }]}>
          {warning}
        </Text>
      ))}
      {proposalSlots.length > 0 && (
        <View style={styles.proposalList}>
          {shown.loading && motionActive && <ProcessingIndicator label={status ?? undefined} stage={statusStage} active={motionActive} />}
          {shown.proposals.length > 0 && <Text accessibilityLiveRegion="polite" style={[styles.description, { color: colors.muted }]}>
            {t('Zaznacz zadania, które chcesz dodać.', 'Select the tasks you want to add.')}
          </Text>}
          {proposalSlots.map(index => {
            const text = shown.proposals[index]
            const checked = selected.has(text)
            const disabled = busy || noteProcessing || Boolean(note?.transcriptionIncomplete)
            const ready = Boolean(text) && proposalSequence.ready(index)
            return (
              <TaskArrival key={`proposal-slot-${index}`} index={0} active={motionActive} reducedMotion={reducedMotion}
                enter={proposalSequence.enter(index)} eventKey={ready ? `${proposalBatch}:${text}` : undefined}
                onArrivalComplete={() => proposalSequence.arrivalComplete(text)}>
                <TaskPlaceholder index={index} count={shown.proposals.length} exiting={!shown.loading && !text} active={motionActive} reducedMotion={reducedMotion}>
                <Pressable
                  onPress={text ? () => toggleProposal(text) : undefined}
                  disabled={!text || disabled}
                  pointerEvents={text ? 'auto' : 'none'}
                  accessibilityRole={text ? 'checkbox' : undefined}
                  accessibilityLabel={text}
                  accessibilityElementsHidden={!text}
                  importantForAccessibility={text ? 'auto' : 'no-hide-descendants'}
                  accessibilityState={text ? { checked, disabled } : undefined}
                  style={({ pressed }) => [styles.proposalRow, { borderBottomColor: colors.line, opacity: pressed ? 0.72 : 1 }]}
                >
                  {text ? <TaskCheck
                    checked={checked}
                    active={motionActive}
                    reducedMotion={reducedMotion}
                    style={[styles.proposalCheckbox, { borderColor: checked ? colors.action : colors.faint, backgroundColor: checked ? colors.action : 'transparent' }]}
                  /> : <View style={[styles.proposalCheckbox, { borderColor: colors.faint }]} />}
                  <View style={styles.placeholderText}>
                  {ready ? <TaskText
                    key={`${proposalBatch}:${text}`}
                    text={text}
                    index={0}
                    placeholderLines={index === 1 ? 1 : 2}
                    reveal={proposalReveal.ids.has(text)}
                    active={motionActive}
                    reducedMotion={reducedMotion}
                    onRevealConsumed={() => proposalReveal.consume(text)}
                    onRevealComplete={proposalSequence.textComplete}
                    style={[styles.proposalText, { color: colors.ink }]}
                  /> : <SkeletonText lines={index === 1 ? 1 : 2} animate={shown.loading && motionActive && statusStage === 'processing'} active={motionActive} />}
                  </View>
                </Pressable>
                </TaskPlaceholder>
              </TaskArrival>
            )
          })}
          {shown.proposals.length > 0 && <View style={styles.proposalActions}>
            {(saving || discarding) && motionActive && (
              <ProcessingIndicator
                label={saving ? t('Zapisuję zadania…', 'Saving tasks…') : t('Odrzucam propozycje…', 'Discarding suggestions…')}
                stage="saving"
                active={motionActive}
              />
            )}
            <Button
              label={saving ? t('Zapisuję zadania…', 'Saving tasks…') : t(`Dodaj zaznaczone (${selected.size})`, `Add selected (${selected.size})`)}
              variant="primary"
              onPress={() => void addSelected()}
              disabled={selected.size === 0 || busy || noteProcessing || Boolean(note?.transcriptionIncomplete)}
            />
            <Button
              label={t('Odrzuć propozycje', 'Discard suggestions')}
              variant="secondary"
              onPress={() => void cancelProposals()}
              disabled={busy || noteProcessing}
            />
          </View>}
        </View>
      )}
      {!shown.loading && shown.noteProcessing && (
        <Text style={[styles.status, { color: colors.muted }]}>
          {t('Poczekaj na zakończenie opracowywania notatki.', 'Wait until the note has finished processing.')}
        </Text>
      )}
      {!noteProcessing && note?.transcriptionIncomplete && (
        <Text style={[styles.status, { color: colors.muted }]}>
          {t('Najpierw uzupełnij transkrypcję z zachowanego audio.', 'Complete the transcript from the saved audio first.')}
        </Text>
      )}
      {shown.proposals.length === 0 && (
        <Button
          label={t('Zaproponuj zadania', 'Suggest tasks')}
          icon="sparkles"
          onPress={() => void propose()}
          disabled={busy || noteProcessing || !modelReady || !content.trim() || Boolean(note?.transcriptionIncomplete)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  heading: { ...type.title },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 46,
  },
  checkPressable: {
    minWidth: 36,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskText: { ...type.body, flex: 1 },
  taskDone: { textDecorationLine: 'line-through' },
  empty: { ...type.body },
  error: { ...type.body },
  status: { ...type.meta },
  description: { ...type.body, fontSize: 14, lineHeight: 20 },
  proposalList: { gap: spacing.sm },
  placeholderText: { flex: 1, minWidth: 0 },
  proposalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.lg,
  },
  proposalCheckbox: {
    width: 23,
    height: 23,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  proposalText: { ...type.body, flex: 1, lineHeight: 23 },
  proposalActions: { gap: spacing.sm, paddingTop: spacing.md },
})
