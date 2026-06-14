import { useState } from 'react'
import { Link, Stack, useRouter } from 'expo-router'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNotesStore } from '../state/notesStore'
import type { Note } from '../domain/note'

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function NoteRow({ note, onPress }: { note: Note; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {note.title.trim().length > 0 ? note.title : '(bez tytułu)'}
      </Text>
      {note.content.trim().length > 0 && (
        <Text style={styles.rowPreview} numberOfLines={2}>
          {note.summary?.trim() || note.content}
        </Text>
      )}
      {note.tags.length > 0 && (
        <View style={styles.rowTags}>
          {note.tags.map((tag) => (
            <Text key={tag} style={styles.rowTag}>
              {tag}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.rowDate}>{formatDate(note.updatedAt)}</Text>
    </Pressable>
  )
}

export default function NotesListScreen() {
  const notes = useNotesStore((state) => state.notes)
  const router = useRouter()
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags))).sort()
  const visibleNotes = selectedTag ? notes.filter((n) => n.tags.includes(selectedTag)) : notes

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Notatki',
          headerLeft: () => (
            <Pressable onPress={() => router.push('/tasks')} hitSlop={8}>
              <Text style={styles.headerAdd}>Zadania</Text>
            </Pressable>
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push('/record')} hitSlop={8}>
                <Text style={styles.headerAdd}>Nagraj</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/import')} hitSlop={8}>
                <Text style={styles.headerAdd}>Wczytaj</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/note/new')} hitSlop={8}>
                <Text style={styles.headerAdd}>+ Nowa</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      {allTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterBar}
        >
          <Pressable onPress={() => setSelectedTag(null)}>
            <Text style={[styles.filterChip, !selectedTag && styles.filterChipActive]}>Wszystkie</Text>
          </Pressable>
          {allTags.map((tag) => (
            <Pressable key={tag} onPress={() => setSelectedTag(tag)}>
              <Text style={[styles.filterChip, selectedTag === tag && styles.filterChipActive]}>
                {tag}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {notes.length === 0 ? (
        <Text style={styles.empty}>Brak notatek. Dodaj pierwszą przyciskiem „+ Nowa".</Text>
      ) : (
        <FlatList
          data={visibleNotes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NoteRow note={item} onPress={() => router.push(`/note/${item.id}`)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
        />
      )}
      <Link href="/dev/poc" style={styles.devLink}>
        Ekran dev: POC LLM
      </Link>
      <Link href="/dev/stt-probe" style={styles.devLink}>
        Ekran dev: STT probe
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingVertical: 8 },
  empty: { padding: 16, fontSize: 16, color: '#666' },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowPreview: { fontSize: 14, color: '#444' },
  rowDate: { fontSize: 12, color: '#999' },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 16 },
  headerActions: { flexDirection: 'row', gap: 12 },
  headerAdd: { fontSize: 16, color: '#1F4E79', fontWeight: '600', paddingHorizontal: 4 },
  devLink: { padding: 16, fontSize: 13, color: '#999', textAlign: 'center' },
  rowTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  rowTag: {
    fontSize: 12,
    color: '#1F4E79',
    backgroundColor: '#E0F2FE',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  filterScroll: { flexGrow: 0 },
  filterBar: { gap: 8, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' },
  filterChip: {
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  filterChipActive: { backgroundColor: '#1F4E79', color: '#FFFFFF' },
})
