import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { useTasksStore } from '../../state/tasksStore'
import { useNotesStore } from '../../state/notesStore'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { type, useTheme } from '../../ui/theme'

export default function TasksScreen() {
  const { colors } = useTheme()
  const tasks = useTasksStore((s) => s.tasks)
  const toggle = useTasksStore((s) => s.toggle)
  const notes = useNotesStore((s) => s.notes)
  const router = useRouter()
  const [completed, setCompleted] = useState(false)
  const pending = useMemo(() => tasks.filter((task) => !task.done).length, [tasks])
  const noteTitles = useMemo(
    () => new Map(notes.map((note) => [note.id, note.title.trim() || 'Bez tytułu'])),
    [notes],
  )
  const titleFor = (id: string) => noteTitles.get(id) ?? 'Bez tytułu'
  const visible = useMemo(
    () => tasks.filter((task) => task.done === completed),
    [tasks, completed],
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
      {!!tasks.length && (
        <View
          style={{
            flexDirection: 'row',
            margin: 24,
            marginTop: 8,
            marginBottom: 16,
            padding: 4,
            backgroundColor: colors.surface,
            borderRadius: 13,
          }}
        >
          {[false, true].map((done) => (
            <Pressable
              key={String(done)}
              accessibilityRole="tab"
              accessibilityState={{ selected: done === completed }}
              onPress={() => setCompleted(done)}
              style={{
                flex: 1,
                minHeight: 42,
                backgroundColor:
                  done === completed ? colors.paper : 'transparent',
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  ...type.label,
                  color: done === completed ? colors.accent : colors.muted,
                }}
              >
                {done
                  ? `Ukończone · ${tasks.length - pending}`
                  : `Do zrobienia · ${pending}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {!visible.length ? (
        <EmptyState
          icon="tasks"
          title={
            completed
              ? 'Brak ukończonych zadań'
              : tasks.length
                ? 'Wszystko zrobione'
                : 'Od myśli do działania'
          }
          description={
            completed
              ? 'Zaznaczone zadania będą widoczne tutaj.'
              : tasks.length
                ? 'Możesz wrócić do notatek lub przejrzeć ukończone zadania.'
                : 'W notatce wybierz „Zaproponuj zadania” i dodaj te, które chcesz wykonać.'
          }
          action={{
            label: 'Przejdź do notatek',
            onPress: () => router.navigate('/'),
          }}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(task) => task.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: 'row',
                padding: 12,
                paddingVertical: 15,
                borderRadius: 16,
                marginBottom: 8,
                backgroundColor: colors.paper,
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.text}
                onPress={() => void onToggle(item.id)}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 23,
                    height: 23,
                    borderRadius: 7,
                    borderWidth: 1.5,
                    borderColor: item.done ? colors.accent : colors.faint,
                    backgroundColor: item.done ? colors.accent : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.done && (
                    <Icon name="check" color={colors.onAccent} size={16} />
                  )}
                </View>
              </Pressable>
              <View style={{ flex: 1, paddingTop: 8, gap: 2 }}>
                <Text
                  style={{
                    ...type.body,
                    color: item.done ? colors.muted : colors.ink,
                    textDecorationLine: item.done ? 'line-through' : 'none',
                  }}
                >
                  {item.text}
                </Text>
                <Pressable
                  onPress={() => router.push(`/note/${item.noteId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Otwórz notatkę ${titleFor(item.noteId)}`}
                  style={{ minHeight: 38, justifyContent: 'center' }}
                >
                  <Text
                    numberOfLines={2}
                    style={{ ...type.meta, color: colors.accent }}
                  >
                    {titleFor(item.noteId)}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}
