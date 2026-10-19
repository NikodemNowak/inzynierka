import { useI18n } from '../../i18n/useI18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTasksStore } from '../../state/tasksStore'
import { useNotesStore } from '../../state/notesStore'
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

export default function TasksScreen() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const tasks = useTasksStore((state) => state.tasks)
  const toggle = useTasksStore((state) => state.toggle)
  const notes = useNotesStore((state) => state.notes)
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
  const noteCreated = useMemo(() => new Map(notes.map((note) => [note.id, note.createdAt])), [notes])
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

  const onToggle = async (id: string) => {
    const epoch = visibilityEpoch.current
    const startedVisible = motionActiveRef.current
    try {
      await toggle(id)
      if (startedVisible && motionActiveRef.current && visibilityEpoch.current === epoch)
        setLastToggled({ id })
    } catch {
      Alert.alert(
        t('Nie zapisano zmiany', 'Change not saved'),
        t('Spróbuj ponownie.', 'Try again.'),
      )
    }
  }

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
            <TaskArrival
              index={index + (section.key === 'completed' ? pending.length : 0)}
              count={Math.min(tasks.length, STAGGER_ROWS)}
              active={motionActive && entranceOpen}
              reducedMotion={reducedMotion}
              style={[
                styles.taskRow,
                { backgroundColor: colors.paper, borderColor: colors.line },
                index === 0 && styles.cardTop,
                index === section.data.length - 1 && styles.cardBottom,
              ]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.text}
                onPress={() => void onToggle(item.id)}
                style={styles.checkboxHitArea}
              >
                <TaskCheck
                  checked={item.done}
                  active={motionActive}
                  reducedMotion={reducedMotion}
                  feedback={lastToggled?.id === item.id}
                  onFeedbackComplete={() => {
                    if (motionActiveRef.current)
                      setLastToggled((current) => current === lastToggled ? null : current)
                  }}
                  size={17}
                  style={[
                    styles.checkbox,
                    {
                      borderColor: item.done ? colors.action : colors.ink,
                      backgroundColor: item.done
                        ? colors.action
                        : 'transparent',
                    },
                  ]}
                />
              </Pressable>
              <View style={styles.taskCopy}>
                <TaskText
                  text={noteCreated.has(item.noteId) ? splitTaskText(item.text).title : item.text}
                  reveal={textReveal.ids.has(item.id)}
                  active={motionActive}
                  reducedMotion={reducedMotion}
                  onRevealConsumed={() => textReveal.consume(item.id)}
                  numberOfLines={2}
                  style={[
                    styles.taskLabel,
                    {
                      color: item.done ? colors.muted : colors.ink,
                      textDecorationLine: item.done ? 'line-through' : 'none',
                    },
                  ]}
                />
                {noteCreated.has(item.noteId) && (
                  <TaskDueChip text={item.text} recordedAt={new Date(noteCreated.get(item.noteId)!)} noteTitle={noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')} done={item.done} />
                )}
                <Pressable
                  onPress={() => router.push(`/note/${item.noteId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    `Otwórz notatkę ${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}`,
                    `Open note ${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}`,
                  )}
                  style={styles.sourceLink}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.sourceLabel, { color: colors.muted }]}
                  >
                    {t(
                      `z notatki „${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}”`,
                      `from “${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}”`,
                    )}
                  </Text>
                </Pressable>
              </View>
              {index < section.data.length - 1 && (
                <View
                  pointerEvents="none"
                  style={[styles.separator, { backgroundColor: colors.line }]}
                />
              )}
            </TaskArrival>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
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
