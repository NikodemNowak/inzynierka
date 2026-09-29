import { Pressable, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { isCategory } from '../domain/categories'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'
import { useNotesStore } from '../state/notesStore'

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}
export function NoteRow({
  note,
  timestamp,
  onPress,
}: {
  note: Note
  timestamp: number
  onPress: () => void
}) {
  const { colors } = useTheme()
  const processing = useNotesStore((s) => Boolean(s.processing[note.id]))
  const categories = note.tags.filter(isCategory)
  const preview = note.summary?.trim() || note.content.trim()
  const time = new Date(timestamp).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 17,
        paddingHorizontal: 16,
        backgroundColor: pressed ? colors.surface : colors.paper,
        borderRadius: 16,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      })}
    >
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            ...type.title,
            fontSize: 17,
            lineHeight: 23,
            color: colors.ink,
          }}
          numberOfLines={2}
        >
          {note.title.trim() || 'Bez tytułu'}
        </Text>
        {!!preview && (
          <Text
            style={{
              ...type.body,
              fontSize: 14,
              lineHeight: 21,
              color: colors.body,
            }}
            numberOfLines={2}
          >
            {preview}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 5,
            marginTop: 3,
          }}
        >
          <Icon
            name={processing ? 'sparkles' : note.audioUri ? 'waveform' : 'note'}
            size={13}
            color={processing ? colors.accent : colors.muted}
          />
          <Text style={{ ...type.meta, color: colors.muted }}>
            {processing
              ? 'Opracowywanie'
              : note.audioUri
                ? `Nagranie${note.durationMs !== null ? ' · ' + formatDuration(note.durationMs) : ''}`
                : 'Tekst'}
          </Text>
          <Text style={{ ...type.meta, color: colors.muted }}>· {time}</Text>
          {!!categories.length && (
            <Text
              numberOfLines={1}
              style={{ ...type.meta, color: colors.accent, flexShrink: 1 }}
            >
              · {categories.slice(0, 2).join(' · ')}
              {categories.length > 2 ? ` +${categories.length - 2}` : ''}
            </Text>
          )}
        </View>
      </View>
      <Icon name="chevron-right" color={colors.faint} size={17} />
    </Pressable>
  )
}
