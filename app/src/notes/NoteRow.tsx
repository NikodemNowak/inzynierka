import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { isCategory } from '../domain/categories'

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

interface NoteRowProps {
  note: Note
  // Which date the row shows: the caller passes the one the list is sorted by,
  // so a list ordered by recording date does not display modification dates.
  timestamp: number
  onPress: () => void
}

export function NoteRow({ note, timestamp, onPress }: NoteRowProps) {
  const categories = note.tags.filter(isCategory)
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
      {categories.length > 0 && (
        <View style={styles.rowTags}>
          {categories.map((tag) => (
            <Text key={tag} style={styles.rowTag}>
              {tag}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.rowDate}>{formatDate(timestamp)}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowPreview: { fontSize: 14, color: '#444' },
  rowDate: { fontSize: 12, color: '#999' },
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
})
