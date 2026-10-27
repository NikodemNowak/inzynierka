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
import { Icon } from '../../ui/Icon'
import { useReducedMotion } from '../../ui/Motion'
import { TaskArrival, TaskCheck, TaskText, subscribePersistedTaskText, useTaskMotionActive, useTaskTextReveal } from '../../tasks/TaskMotion'
import { TaskDueChip } from '../../tasks/TaskDueChip'
import { splitTaskText } from '../../tasks/taskDue'
import { TASK_GROUP_ORDER, groupTasksByDue, type TaskGroup } from '../../tasks/taskGroups'
import { fonts, radius, spacing, type, useTheme } from '../../ui/theme'

const ENTRANCE_WINDOW_MS = 1400
const STAGGER_ROWS = 20

interface TaskRowProps {
  item: Task
  rowIndex: number
  staggerCount: number
  isFirst: boolean
  isLast: boolean
  motionActive: boolean
  entranceActive: boolean
  reducedMotion: boolean
  created: number | undefined
  noteTitle: string
  feedback: object | null
  reveal: boolean
  onToggle: (id: string) => void
  onOpenNote: (noteId: string) => void
  onFeedbackComplete: (token: object) => void
  onRevealConsumed: (id: string) => void
}

const TaskRow = memo(function TaskRow({
  item, rowIndex, staggerCount, isFirst, isLast, motionActive, entranceActive, reducedMotion,
  created, noteTitle, feedback, reveal, onToggle, onOpenNote, onFeedbackComplete, onRevealConsumed,
}: TaskRowProps) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const hasNote = created !== undefined
  return (
    <TaskArrival
      index={rowIndex}
      count={staggerCount}
      active={motionActive && entranceActive}
      reducedMotion={reducedMotion}
      style={[
        styles.taskRow,
        { backgroundColor: colors.paper, borderColor: colors.line },
        isFirst && styles.cardTop,
        isLast && styles.cardBottom,
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.text}
        onPress={() => onToggle(item.id)}
        style={styles.checkboxHitArea}
      >
        <TaskCheck
          checked={item.done}
          active={motionActive}
          reducedMotion={reducedMotion}
          feedback={feedback !== null}
          onFeedbackComplete={() => {
            if (feedback) onFeedbackComplete(feedback)
          }}
          size={17}
          style={[
            styles.checkbox,
            {
              borderColor: item.done ? colors.brand : colors.ink,
              backgroundColor: item.done ? colors.brand : 'transparent',
            },
          ]}
        />
      </Pressable>
      <View style={styles.taskCopy}>
        <TaskText
          text={hasNote ? splitTaskText(item.text).title : item.text}
          reveal={reveal}
          active={motionActive}
          reducedMotion={reducedMotion}
          onRevealConsumed={() => onRevealConsumed(item.id)}
          numberOfLines={2}
          style={[
            styles.taskLabel,
            {
              color: item.done ? colors.muted : colors.ink,
              textDecorationLine: item.done ? 'line-through' : 'none',
            },
          ]}
        />
        {hasNote && (
          <TaskDueChip text={item.text} recordedAt={new Date(created)} noteTitle={noteTitle} done={item.done} />
        )}
        <Pressable
          onPress={() => onOpenNote(item.noteId)}
          accessibilityRole="button"
          accessibilityLabel={t(`Otwórz notatkę ${noteTitle}`, `Open note ${noteTitle}`)}
          style={styles.sourceLink}
        >
          <Text numberOfLines={1} style={[styles.sourceLabel, { color: colors.muted }]}>
            {t(`z notatki „${noteTitle}”`, `from “${noteTitle}”`)}
          </Text>
        </Pressable>
      </View>
      {!isLast && (
        <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.line }]} />
      )}
    </TaskArrival>
  )
})

export default function TasksScreen() {
  const { colors } = useTheme()
  const { t } = useI18n()
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
  // Rows on screen when the list opens enter on one quick stagger; rows that
  // mount later while scrolling appear without an entrance.
  const [entranceOpen, setEntranceOpen] = useState(true)
  useEffect(() => {
    if (!motionActive) {
      setEntranceOpen(true)
      return
    }
    const timer = setTimeout(() => setEntranceOpen(false), ENTRANCE_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [motionActive])
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
  const todayCount = grouped.get('today')?.length ?? 0
  const sections = useMemo(
    () => [
      ...TASK_GROUP_ORDER
        .map((group) => ({ key: group as TaskGroup | 'completed', title: groupTitles[group], data: (grouped.get(group) ?? []).map((item) => item.task) }))
        .filter((section) => section.data.length > 0),
      {
        key: 'completed' as const,
        title: t(`Zrobione · ${completed.length}`, `Done · ${completed.length}`),
        data: showCompleted || pending.length === 0 ? completed : [],
      },
    ],
    // groupTitles follows t
    [grouped, completed, showCompleted, pending.length, t],
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
      <View style={styles.summary}>
        {tasks.length > 0 && (
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>
            {todayCount > 0
              ? t(`${pending.length} do zrobienia · ${todayCount} na dziś`, `${pending.length} to do · ${todayCount} today`)
              : t(`${pending.length} do zrobienia`, `${pending.length} to do`)}
          </Text>
        )}
      </View>
      {toggleFailed && (
        <View style={[styles.errorCard, { backgroundColor: colors.paper, borderColor: colors.line }]}>
          <View style={[styles.errorDot, { backgroundColor: colors.danger }]} />
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
          renderSectionHeader={({ section }) =>
            section.key === 'completed' && pending.length > 0 ? (
              completed.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showCompleted }}
                  onPress={() => setShowCompleted((value) => !value)}
                  style={({ pressed }) => [styles.doneToggle, { borderColor: colors.line, backgroundColor: colors.paper, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[styles.doneText, { color: colors.ink }]}>{section.title}</Text>
                  <Icon name={showCompleted ? 'chevron-left' : 'chevron-right'} color={colors.faint} size={16} />
                </Pressable>
              ) : null
            ) : (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.muted }]}>{section.title}</Text>
                {section.key === 'today' && (
                  <Text style={[styles.sectionTitle, { color: colors.ink }]}>
                    {new Date().toLocaleDateString(t('pl-PL', 'en-GB'), { weekday: 'short', day: 'numeric', month: 'short' })}
                  </Text>
                )}
              </View>
            )
          }
          renderItem={({ item, index, section }) => (
            <TaskRow
              item={item}
              rowIndex={index + (section.key === 'completed' ? pending.length : 0)}
              staggerCount={Math.min(tasks.length, STAGGER_ROWS)}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
              motionActive={motionActive}
              entranceActive={entranceOpen}
              reducedMotion={reducedMotion}
              created={noteCreated.get(item.noteId)}
              noteTitle={noteTitles.get(item.noteId) ?? untitled}
              feedback={lastToggled?.id === item.id ? lastToggled : null}
              reveal={textReveal.ids.has(item.id)}
              onToggle={pressToggle}
              onOpenNote={openNote}
              onFeedbackComplete={clearFeedback}
              onRevealConsumed={consumeReveal}
            />
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 24, marginBottom: spacing.sm, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  errorDot: { width: 8, height: 8, borderRadius: 4 },
  errorText: { ...type.body, flex: 1, fontSize: 15, lineHeight: 21 },
  summary: {
    marginHorizontal: 24,
    paddingBottom: spacing.sm,
  },
  summaryLabel: { ...type.body, fontSize: 15, lineHeight: 21 },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: 4 },
  sectionTitle: { ...type.label, fontSize: 13, lineHeight: 18 },
  taskRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingRight: 14,
    paddingLeft: 4,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    position: 'relative',
  },
  cardTop: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  cardBottom: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  checkboxHitArea: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCopy: { flex: 1, minWidth: 0, gap: 2 },
  taskLabel: { ...type.body, fontSize: 16, lineHeight: 21 },
  sourceLink: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceLabel: { ...type.meta, flex: 1 },
  separator: { position: 'absolute', bottom: 0, left: 52, right: 14, height: StyleSheet.hairlineWidth },
  doneToggle: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, marginTop: spacing.xl },
  doneText: { fontFamily: fonts.semibold, fontSize: 14 },
})
