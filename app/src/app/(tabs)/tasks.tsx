import { useMemo } from 'react'
import { useRouter } from 'expo-router'
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
import { radius, spacing, type, useTheme } from '../../ui/theme'

export default function TasksScreen() {
  const { colors } = useTheme()
  const tasks = useTasksStore((state) => state.tasks)
  const toggle = useTasksStore((state) => state.toggle)
  const notes = useNotesStore((state) => state.notes)
  const router = useRouter()
  const pending = useMemo(() => tasks.filter((task) => !task.done), [tasks])
  const completed = useMemo(() => tasks.filter((task) => task.done), [tasks])
  const noteTitles = useMemo(
    () =>
      new Map(
        notes.map((note) => [note.id, note.title.trim() || 'Bez tytułu']),
      ),
    [notes],
  )
  const sections = useMemo(
    () => [
      {
        key: 'pending' as const,
        title: `Do zrobienia (${pending.length})`,
        data: pending,
      },
      {
        key: 'completed' as const,
        title: `Ukończone · ${completed.length}`,
        data: completed,
      },
    ],
    [pending, completed],
  )

  const onToggle = async (id: string) => {
    try {
      await toggle(id)
    } catch {
      Alert.alert('Nie zapisano zmiany', 'Spróbuj ponownie.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={styles.summary}>
        {tasks.length > 0 && (
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>
            {pending.length} do zrobienia
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
            <View style={styles.taskRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.text}
                onPress={() => void onToggle(item.id)}
                style={styles.checkboxHitArea}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: item.done ? colors.action : colors.faint,
                      backgroundColor: item.done
                        ? colors.action
                        : 'transparent',
                    },
                  ]}
                >
                  {item.done && (
                    <Icon name="check" color={colors.onAction} size={17} />
                  )}
                </View>
              </Pressable>
              <View style={styles.taskCopy}>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.taskLabel,
                    {
                      color: item.done ? colors.muted : colors.ink,
                      textDecorationLine: item.done ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {item.text}
                </Text>
                <Pressable
                  onPress={() => router.push(`/note/${item.noteId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Otwórz notatkę ${noteTitles.get(item.noteId) ?? 'Bez tytułu'}`}
                  style={styles.sourceLink}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.sourceLabel, { color: colors.muted }]}
                  >
                    {`Z notatki „${noteTitles.get(item.noteId) ?? 'Bez tytułu'}”`}
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
            </View>
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
