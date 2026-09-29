import { Stack, useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTasksStore } from '../state/tasksStore'
import { useNotesStore } from '../state/notesStore'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'

export default function TasksScreen() {
  const tasks = useTasksStore((s) => s.tasks)
  const toggle = useTasksStore((s) => s.toggle)
  const notes = useNotesStore((s) => s.notes)
  const router = useRouter()
  const pending = tasks.filter((task) => !task.done).length

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
            Otwórz notatkę i wybierz „Zaproponuj zadania”, aby wyciągnąć z niej listę do zrobienia.
          </Text>
          <Button label="Wróć do notatek" onPress={() => router.replace('/')} style={styles.emptyAction} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={tasks}
          keyExtractor={(t) => t.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Do zrobienia</Text>
              <Text style={styles.count}>{pending} z {tasks.length}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                onPress={() => toggle(item.id)}
                style={styles.checkboxButton}
                accessibilityRole="checkbox"
                accessibilityLabel={item.text}
                accessibilityState={{ checked: item.done }}
              >
                <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
                  {item.done && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </Pressable>
              <View style={styles.body}>
                <Text style={[styles.text, item.done && styles.done]}>{item.text}</Text>
                <Pressable
                  onPress={() => router.push(`/note/${item.noteId}`)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Otwórz notatkę ${titleFor(item.noteId)}`}
                >
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
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: {
    flexGrow: 0,
    margin: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  listContent: { paddingBottom: spacing.sm },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listTitle: { ...type.title, color: colors.ink },
  count: { ...type.label, color: colors.navy },
  empty: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...type.title, color: colors.ink },
  emptyBody: { ...type.body, color: colors.muted },
  emptyAction: { alignSelf: 'flex-start', marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  checkboxButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.navy },
  checkmark: { color: colors.paper, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  body: { flex: 1, gap: spacing.xs },
  text: { ...type.body, color: colors.ink },
  done: { textDecorationLine: 'line-through', color: colors.faint },
  link: { ...type.label, color: colors.navy, fontWeight: '500' },
  separator: { height: 1, backgroundColor: colors.line, marginLeft: 68 },
})
