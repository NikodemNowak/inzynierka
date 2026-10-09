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
import { radius, spacing, type, useTheme } from '../../ui/theme'

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
  const sections = useMemo(
    () => [
      {
        key: 'pending' as const,
        title: t(
          `Do zrobienia (${pending.length})`,
          `To do (${pending.length})`,
        ),
        data: pending,
      },
      {
        key: 'completed' as const,
        title: t(
          `Ukończone · ${completed.length}`,
          `Completed · ${completed.length}`,
        ),
        data: completed,
      },
    ],
    [pending, completed, t],
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
            {t(`${pending.length} do zrobienia`, `${pending.length} to do`)}
          </Text>
        )}
        <View style={[styles.summaryRule, { backgroundColor: colors.line }]} />
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
          renderSectionHeader={({ section }) => (
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.ink },
                section.key === 'completed' && styles.completedSectionTitle,
              ]}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <TaskArrival
              index={index + (section.key === 'completed' ? pending.length : 0)}
              active={motionActive}
              reducedMotion={reducedMotion}
              style={styles.taskRow}
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
                      borderColor: item.done ? colors.action : colors.faint,
                      backgroundColor: item.done
                        ? colors.action
                        : 'transparent',
                    },
                  ]}
                />
              </Pressable>
              <View style={styles.taskCopy}>
                <TaskText
                  text={item.text}
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
                      `Z notatki „${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}”`,
                      `From note “${noteTitles.get(item.noteId) ?? t('Bez tytułu', 'Untitled')}”`,
                    )}
                  </Text>
                  <Icon name="chevron-right" color={colors.faint} size={17} />
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
    paddingTop: 0,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  summaryLabel: { ...type.body, fontSize: 15, lineHeight: 21 },
  summaryRule: { height: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 20 },
  sectionTitle: {
    ...type.label,
    fontSize: 16,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  completedSectionTitle: { marginTop: spacing.xl },
  taskRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  checkboxHitArea: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 25,
    height: 25,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCopy: { flex: 1, minWidth: 0, gap: 2 },
  taskLabel: { ...type.body, fontSize: 16, lineHeight: 21 },
  sourceLink: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceLabel: { ...type.meta, flex: 1 },
  separator: { position: 'absolute', bottom: 0, left: 54, right: 0, height: 1 },
})
