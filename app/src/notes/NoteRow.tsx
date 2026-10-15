import { useI18n } from '../i18n/useI18n'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { categoryLabel, isCategory } from '../domain/categories'
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
  groupPosition = 'only',
  onPress,
}: {
  note: Note
  timestamp: number
  groupPosition?: 'first' | 'middle' | 'last' | 'only'
  onPress: () => void
}) {
  const { colors } = useTheme()
  const { t, language, locale } = useI18n()
  const processingPhase = useNotesStore((s) => s.processing[note.id]?.phase)
  const processing = processingPhase !== undefined
  const categories = note.tags.filter(isCategory)
  const preview = note.summary?.trim() || note.content.trim()
  const time = new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const hasSeparator = groupPosition === 'first' || groupPosition === 'middle'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles[groupPosition],
        { backgroundColor: pressed ? colors.surface : colors.paper },
      ]}
    >
      <View style={styles.copy}>
        <Text
          style={{
            ...type.title,
            fontSize: 16,
            lineHeight: 21,
            color: colors.ink,
          }}
          numberOfLines={1}
        >
          {note.title.trim() || t('Bez tytułu', 'Untitled')}
        </Text>
        {!!preview && (
          <Text
            style={{
              ...type.body,
              fontSize: 14,
              lineHeight: 19,
              color: colors.body,
            }}
            numberOfLines={1}
          >
            {preview}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 1,
          }}
        >
          <Icon
            name={processing ? 'sparkles' : note.audioUri ? 'waveform' : 'note'}
            size={13}
            color={processing ? colors.accent : colors.muted}
          />
          <Text style={{ ...type.meta, color: colors.muted }}>
            {processing
              ? processingPhase === 'loading'
                ? t('Wczytywanie modelu', 'Loading model')
                : processingPhase === 'queued'
                  ? t('Oczekiwanie na model', 'Waiting for model')
                  : t('Opracowywanie', 'Processing')
              : note.audioUri && note.durationMs !== null
                ? formatDuration(note.durationMs)
                : note.audioUri
                  ? t('Nagranie', 'Recording')
                  : t('Tekst', 'Text')}
          </Text>
          <Text style={{ ...type.meta, color: colors.muted }}>· {time}</Text>
          {!!categories.length && (
            <Text
              numberOfLines={1}
              style={{
                ...type.meta,
                color: colors.accent,
                flexShrink: 1,
                marginLeft: 2,
              }}
            >
              {categories
                .slice(0, 2)
                .map((category) => categoryLabel(category, language))
                .join(' · ')}
              {categories.length > 2 ? ` +${categories.length - 2}` : ''}
            </Text>
          )}
        </View>
      </View>
      <Icon name="chevron-right" color={colors.faint} size={17} />
      {hasSeparator && (
        <View
          pointerEvents="none"
          style={[styles.separator, { backgroundColor: colors.line }]}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 88,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  only: { borderRadius: 16 },
  first: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  middle: { borderRadius: 0 },
  last: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  copy: { flex: 1, gap: 4, minWidth: 0 },
  separator: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    height: StyleSheet.hairlineWidth,
  },
})
