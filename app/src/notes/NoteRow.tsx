import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { isCategory } from '../domain/categories'
import { colors, spacing, type } from '../ui/theme'

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000)
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`
}

interface NoteRowProps {
  note: Note
  // Which date the row shows: the caller passes the one the list is sorted by,
  // so a list ordered by recording date does not display modification dates.
  timestamp: number
  onPress: () => void
}

export function NoteRow({ note, timestamp, onPress }: NoteRowProps) {
  const categories = note.tags.filter(isCategory)
  const preview = note.summary?.trim() || note.content.trim()

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.title} numberOfLines={1}>
        {note.title.trim().length > 0 ? note.title : 'Bez tytułu'}
      </Text>

      {preview.length > 0 && (
        <Text style={styles.preview} numberOfLines={2}>
          {preview}
        </Text>
      )}

      <View style={styles.meta}>
        <Text style={styles.time}>{formatDate(timestamp)}</Text>
        {note.durationMs !== null && (
          <Text style={styles.time}>· {formatDuration(note.durationMs)}</Text>
        )}
        {categories.length > 0 && <Text style={styles.categories}>· {categories.join(' · ')}</Text>}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.xs },
  pressed: { backgroundColor: colors.surface },
  title: { ...type.title, color: colors.ink, fontSize: 17, lineHeight: 23 },
  preview: { ...type.body, color: colors.body },
  // Time, length and categories read as one line of record metadata rather than
  // three competing decorations.
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  time: { ...type.meta, color: colors.muted },
  categories: { ...type.label, color: colors.navy, fontSize: 12 },
})
