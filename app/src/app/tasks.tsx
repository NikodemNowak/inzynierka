import { Stack, useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTasksStore } from '../state/tasksStore'
import { useNotesStore } from '../state/notesStore'

export default function TasksScreen() {
  const tasks = useTasksStore((s) => s.tasks)
  const toggle = useTasksStore((s) => s.toggle)
  const notes = useNotesStore((s) => s.notes)
  const router = useRouter()

  const titleFor = (noteId: string): string => {
    const note = notes.find((n) => n.id === noteId)
    return note?.title?.trim() || '(notatka)'
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Zadania' }} />
      {tasks.length === 0 ? (
        <Text style={styles.empty}>
          Brak zadań. Otwórz notatkę i użyj „Zaproponuj zadania", aby je dodać.
        </Text>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable onPress={() => toggle(item.id)} hitSlop={8}>
                <View style={[styles.checkbox, item.done && styles.checkboxDone]} />
              </Pressable>
              <View style={styles.body}>
                <Text style={[styles.text, item.done && styles.done]}>{item.text}</Text>
                <Pressable onPress={() => router.push(`/note/${item.noteId}`)} hitSlop={4}>
                  <Text style={styles.link}>← {titleFor(item.noteId)}</Text>
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
  container: { flex: 1 },
  listContent: { paddingVertical: 8 },
  empty: { padding: 16, fontSize: 16, color: '#666' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#1F4E79' },
  checkboxDone: { backgroundColor: '#1F4E79' },
  body: { flex: 1, gap: 2 },
  text: { fontSize: 16, color: '#111827' },
  done: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  link: { fontSize: 13, color: '#1F4E79' },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 52 },
})
