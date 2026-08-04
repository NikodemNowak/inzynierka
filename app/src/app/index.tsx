import { useState } from 'react'
import { Link, Stack, useRouter } from 'expo-router'
import { Button, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNotesStore } from '../state/notesStore'
import { useSettingsStore } from '../state/settingsStore'
import { NOTE_CATEGORIES } from '../domain/categories'
import { NoteRow } from '../notes/NoteRow'
import { NotesToolbar } from '../notes/NotesToolbar'
import { selectVisibleNotes } from '../notes/noteListView'

export default function NotesListScreen() {
  const notes = useNotesStore((state) => state.notes)
  const sortMode = useSettingsStore((state) => state.sortMode)
  const setSortMode = useSettingsStore((state) => state.setSortMode)
  const router = useRouter()

  // Search text and the selected category are transient: reopening the list
  // should show everything, the way any search box behaves. Only the sort mode
  // is a preference worth persisting.
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const usedCategories = NOTE_CATEGORIES.filter((c) => notes.some((n) => n.tags.includes(c)))
  const visibleNotes = selectVisibleNotes(notes, { query, category, sortMode })

  const clearFilters = () => {
    setQuery('')
    setCategory(null)
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Notatki',
          headerLeft: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push('/tasks')} hitSlop={8}>
                <Text style={styles.headerAction}>Zadania</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
                <Text style={styles.headerAction}>Ustawienia</Text>
              </Pressable>
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push('/record')} hitSlop={8}>
                <Text style={styles.headerAction}>Nagraj</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/import')} hitSlop={8}>
                <Text style={styles.headerAction}>Wczytaj</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/note/new')} hitSlop={8}>
                <Text style={styles.headerAction}>+ Nowa</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      {notes.length === 0 ? (
        <Text style={styles.empty}>Brak notatek. Dodaj pierwszą przyciskiem „+ Nowa".</Text>
      ) : (
        <>
          <NotesToolbar
            query={query}
            onQueryChange={setQuery}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            categories={usedCategories}
            selectedCategory={category}
            onSelectCategory={setCategory}
          />
          {visibleNotes.length === 0 ? (
            <View style={styles.noResults}>
              <Text style={styles.empty}>
                {query.trim().length > 0
                  ? `Nic nie pasuje do „${query.trim()}".`
                  : 'Brak notatek w tej kategorii.'}
              </Text>
              <Button title="Wyczyść filtry" onPress={clearFilters} />
            </View>
          ) : (
            <FlatList
              data={visibleNotes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <NoteRow
                  note={item}
                  timestamp={sortMode === 'created' ? item.createdAt : item.updatedAt}
                  onPress={() => router.push(`/note/${item.id}`)}
                />
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </>
      )}

      {__DEV__ && (
        <>
          <Link href="/dev/poc" style={styles.devLink}>
            Ekran dev: POC LLM
          </Link>
          <Link href="/dev/stt-probe" style={styles.devLink}>
            Ekran dev: STT probe
          </Link>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingVertical: 8 },
  empty: { padding: 16, fontSize: 16, color: '#666' },
  noResults: { alignItems: 'flex-start', gap: 4, paddingHorizontal: 16 },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 16 },
  headerActions: { flexDirection: 'row', gap: 12 },
  headerAction: { fontSize: 16, color: '#1F4E79', fontWeight: '600', paddingHorizontal: 4 },
  devLink: { padding: 16, fontSize: 13, color: '#999', textAlign: 'center' },
})
