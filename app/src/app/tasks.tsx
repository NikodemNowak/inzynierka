import { Stack, useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTasksStore } from '../state/tasksStore'
import { useNotesStore } from '../state/notesStore'
import { colors, radius, spacing, type } from '../ui/theme'

export default function TasksScreen() {
  const tasks = useTasksStore((s) => s.tasks)
  const toggle = useTasksStore((s) => s.toggle)
  const notes = useNotesStore((s) => s.notes)
  const router = useRouter()

  const titleFor = (noteId: string): string => {
    const note = notes.find((n) => n.id === noteId)
    return note?.title?.trim() || 'Bez tytułu'
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Zadania' }} />
      {tasks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Brak zadań</Text>
          <Text style={styles.emptyBody}>
            Otwórz notatkę i wybierz „Zaproponuj zadania", aby wyciągnąć z niej listę do zrobienia.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                onPress={() => toggle(item.id)}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
              >
                <View style={[styles.checkbox, item.done && styles.checkboxDone]} />
              </Pressable>
              <View style={styles.body}>
                <Text style={[styles.text, item.done && styles.done]}>{item.text}</Text>
                <Pressable onPress={() => router.push(`/note/${item.noteId}`)} hitSlop={6}>
                  <Text style={styles.link}>{titleFor(item.noteId)}</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  listContent: { paddingVertical: spacing.sm },
  empty: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...type.title, color: colors.ink },
  emptyBody: { ...type.body, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.navy,
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: colors.navy },
  body: { flex: 1, gap: 2 },
  text: { ...type.body, color: colors.ink },
  done: { textDecorationLine: 'line-through', color: colors.faint },
  link: { ...type.meta, color: colors.navy },
  separator: { height: 1, backgroundColor: colors.line, marginLeft: 52 },
})
