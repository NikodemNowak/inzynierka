import { useI18n } from '../../i18n/useI18n'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTasksStore } from '../../state/tasksStore'
import { useNotesStore } from '../../state/notesStore'
import { useNoteCreatedMap } from '../../notes/useNoteCreatedMap'
import type { Task } from '../../domain/task'
import { ModelDownloadBanner } from '../../notes/ModelDownloadBanner'
import { TasksEmptyState } from '../../tasks/TasksEmptyState'
import { useReducedMotion } from '../../ui/Motion'
import { TaskCheck, TaskText, subscribePersistedTaskText, useTaskMotionActive, useTaskTextReveal } from '../../tasks/TaskMotion'
import { TaskDueChip, formatResolvedDue } from '../../tasks/TaskDueChip'
import { splitTaskText, taskDuePhrase } from '../../tasks/taskDue'
import { TASK_GROUP_ORDER, groupTasksByDue, type TaskGroup } from '../../tasks/taskGroups'
import { ScreenTitle, SettingsButton } from '../../ui/ScreenTitle'
import { Separator, SectionTitle } from '../../ui/Grouped'
import { type, useTheme } from '../../ui/theme'

interface TaskRowProps {
  item: Task
  isFirst: boolean
  isLast: boolean
  motionActive: boolean
  reducedMotion: boolean
  created: number | undefined
  noteTitle: string
  overdue: boolean
  locale: string
  feedback: object | null
  reveal: boolean
  onToggle: (id: string) => void
  onOpenNote: (noteId: string) => void
  onFeedbackComplete: (token: object) => void
  onRevealConsumed: (id: string) => void
}

const TaskRow = memo(function TaskRow({
  item, isFirst, isLast, motionActive, reducedMotion, created, noteTitle, overdue, locale,
  feedback, reveal, onToggle, onOpenNote, onFeedbackComplete, onRevealConsumed,
}: TaskRowProps) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const hasNote = created !== undefined
  const duePhrase = hasNote ? taskDuePhrase(item.text) : null
  const dueLabel = duePhrase && created !== undefined ? formatResolvedDue(duePhrase, new Date(created), locale) : null
  const showChip = hasNote && (!item.done || dueLabel !== null)
  return (
    <View style={[{ backgroundColor: colors.group }, isFirst && styles.rowFirst, isLast && styles.rowLast]}>
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.text}
        onPress={() => onToggle(item.id)}
        hitSlop={{ top: 11, bottom: 11, left: 16, right: 8 }}
        style={styles.checkHit}
      >
        <TaskCheck
          checked={item.done}
          active={motionActive}
          reducedMotion={reducedMotion}
          feedback={feedback !== null}
          onFeedbackComplete={() => {
            if (feedback) onFeedbackComplete(feedback)
          }}
          size={16}
          style={[
            styles.check,
            {
              borderColor: item.done ? colors.accent : colors.faint,
              backgroundColor: item.done ? colors.accent : 'transparent',
            },
          ]}
        />
      </Pressable>
      <View style={styles.copy}>
        <TaskText
          text={hasNote ? splitTaskText(item.text).title : item.text}
          reveal={reveal}
          active={motionActive}
          reducedMotion={reducedMotion}
          onRevealConsumed={() => onRevealConsumed(item.id)}
          numberOfLines={2}
          style={[
            styles.title,
            {
              color: item.done ? colors.faint : colors.ink,
              textDecorationLine: item.done ? 'line-through' : 'none',
            },
          ]}
        />
        <View style={styles.metaRow}>
          {showChip && created !== undefined ? (
            <TaskDueChip text={item.text} recordedAt={new Date(created)} noteTitle={noteTitle} done={item.done} overdue={overdue} />
          ) : null}
          <Pressable
            onPress={() => onOpenNote(item.noteId)}
            accessibilityRole="button"
            accessibilityLabel={t(`Otwórz notatkę ${noteTitle}`, `Open note ${noteTitle}`)}
            style={styles.noteLink}
          >
            <Text numberOfLines={1} style={[styles.secondary, { color: colors.secondary }]}>
              {showChip ? `· ${noteTitle}` : noteTitle}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
    {!isLast && <Separator inset={50} />}
    </View>
  )
})

export default function TasksScreen() {
  const { colors } = useTheme()
  const { t, locale } = useI18n()
  const tasks = useTasksStore((state) => state.tasks)
  const toggle = useTasksStore((state) => state.toggle)
  const notes = useNotesStore((state) => state.notes)
  const noteCreated = useNoteCreatedMap()
  const [toggleFailed, setToggleFailed] = useState(false)
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const motionActive = useTaskMotionActive(useIsFocused())
  const textReveal = useTaskTextReveal(motionActive, reducedMotion, 'tasks-list')
  useEffect(() => subscribePersistedTaskText((ids) => { textReveal.prepare()(ids) }), [textReveal.prepare])
  const [lastToggled, setLastToggled] = useState<{ id: string } | null>(null)
  const motionActiveRef = useRef(motionActive)
  const visibilityEpoch = useRef(0)
  motionActiveRef.current = motionActive
  useEffect(() => {
    if (!motionActive) {
      visibilityEpoch.current += 1
      setLastToggled(null)
    }
  }, [motionActive])
  useEffect(() => () => {
    motionActiveRef.current = false
    visibilityEpoch.current += 1
  }, [])
  const pending = useMemo(() => tasks.filter((task) => !task.done), [tasks])
  const completed = useMemo(() => tasks.filter((task) => task.done), [tasks])
  const noteTitles = useMemo(
    () =>
      new Map(
        notes.map((note) => [
          note.id,
          note.title.trim() || t('Bez tytułu', 'Untitled'),
        ]),
      ),
    [notes, t],
  )
  const [showCompleted, setShowCompleted] = useState(false)
  const groupTitles: Record<TaskGroup, string> = {
    overdue: t('Po terminie', 'Overdue'),
    today: t('Dziś', 'Today'),
    week: t('Ten tydzień', 'This week'),
    later: t('Później', 'Later'),
    undated: t('Bez terminu', 'No due date'),
  }
  const grouped = useMemo(() => groupTasksByDue(pending, noteCreated, new Date()), [pending, noteCreated])
  // With nothing left to do the finished tasks are the list itself.
  const completedVisible = showCompleted || pending.length === 0
  const sections = useMemo(
    () => [
      ...TASK_GROUP_ORDER
        .map((group) => ({ key: group as TaskGroup | 'completed', title: groupTitles[group], data: (grouped.get(group) ?? []).map((item) => item.task) })),
      { key: 'completed' as const, title: t('Zrobione', 'Done'), data: completedVisible ? completed : [] },
    ].filter((section) => section.data.length > 0),
    // groupTitles follows t
    [grouped, completed, completedVisible, t],
  )

  const onToggle = useCallback(async (id: string) => {
    const epoch = visibilityEpoch.current
    const startedVisible = motionActiveRef.current
    try {
      await toggle(id)
      setToggleFailed(false)
      if (startedVisible && motionActiveRef.current && visibilityEpoch.current === epoch)
        setLastToggled({ id })
    } catch {
      setToggleFailed(true)
    }
  }, [toggle])
  const openNote = useCallback((noteId: string) => router.push(`/note/${noteId}`), [router])
  const clearFeedback = useCallback(
    (token: object) => {
      if (motionActiveRef.current) setLastToggled((current) => (current === token ? null : current))
    },
    [],
  )
  const consumeReveal = textReveal.consume
  const pressToggle = useCallback((id: string) => { void onToggle(id) }, [onToggle])
  const untitled = t('Bez tytułu', 'Untitled')

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenTitle title={t('Zadania', 'Tasks')} right={<SettingsButton />} />
      {toggleFailed && (
        <View style={[styles.errorCard, { backgroundColor: colors.group }]}>
          <View style={[styles.errorDot, { backgroundColor: colors.red }]} />
          <Text style={[styles.errorText, { color: colors.ink }]}>
            {t('Nie zapisano zmiany. Spróbuj ponownie.', 'Change not saved. Try again.')}
          </Text>
        </View>
      )}
      <ModelDownloadBanner />
      {tasks.length === 0 ? (
        <TasksEmptyState onOpenNotes={() => router.navigate('/')} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(task) => task.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <SectionTitle tone={section.key === 'overdue' ? 'red' : 'default'}>{section.title}</SectionTitle>
          )}
          renderItem={({ item, index, section }) => (
            <TaskRow
              item={item}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
              motionActive={motionActive}
              reducedMotion={reducedMotion}
              created={noteCreated.get(item.noteId)}
              noteTitle={noteTitles.get(item.noteId) ?? untitled}
              overdue={section.key === 'overdue'}
              locale={locale}
              feedback={lastToggled?.id === item.id ? lastToggled : null}
              reveal={textReveal.ids.has(item.id)}
              onToggle={pressToggle}
              onOpenNote={openNote}
              onFeedbackComplete={clearFeedback}
              onRevealConsumed={consumeReveal}
            />
          )}
          ListFooterComponent={
            pending.length > 0 && completed.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showCompleted }}
                onPress={() => setShowCompleted((value) => !value)}
                style={({ pressed }) => [styles.doneToggle, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.doneText, { color: colors.accent }]}>
                  {showCompleted
                    ? t(`Ukryj zrobione (${completed.length})`, `Hide done (${completed.length})`)
                    : t(`Pokaż zrobione (${completed.length})`, `Show done (${completed.length})`)}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  errorDot: { width: 8, height: 8, borderRadius: 4 },
  errorText: { ...type.meta, flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 28 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 11, paddingHorizontal: 16 },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  checkHit: { marginTop: 1 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { ...type.body },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteLink: { flexShrink: 1, minWidth: 0, minHeight: 24, justifyContent: 'center' },
  secondary: { ...type.meta, fontVariant: ['tabular-nums'] },
  doneToggle: { alignSelf: 'flex-start', justifyContent: 'center', height: 44, marginTop: 16, marginHorizontal: 4 },
  doneText: { ...type.meta },
})
