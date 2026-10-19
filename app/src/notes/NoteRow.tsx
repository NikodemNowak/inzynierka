import { useI18n } from '../i18n/useI18n'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { categoryLabel, isCategory } from '../domain/categories'
import { Icon } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { fonts, radius, type, useTheme } from '../ui/theme'
import { useNotesStore } from '../state/notesStore'
import { liveTrailFraction } from './ProcessingLive'

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

// Shown on the card while the model works, so nobody has to wait on the note screen.
function ProcessingStrip({ noteId }: { noteId: string }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const progress = useNotesStore((s) => s.processing[noteId])
  const sweep = useRef(new Animated.Value(1)).current
  const fill = useRef(new Animated.Value(0)).current
  const live = progress?.live
  const fraction = live ? liveTrailFraction(live) : 0
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [reduced, sweep])
  useEffect(() => {
    Animated.timing(fill, { toValue: fraction, duration: reduced ? 0 : 500, useNativeDriver: false }).start()
  }, [fraction, fill, reduced])
  const label = progress?.phase === 'loading'
    ? t('Wczytuję model', 'Loading the model')
    : progress?.phase === 'queued'
      ? t('Czekam na model', 'Waiting for the model')
      : progress?.phase === 'title' || progress?.phase === 'tags'
        ? t('Dobieram tytuł', 'Choosing a title')
        : t('Zakreślam', 'Highlighting')
  const points = live?.drafts.length ?? 0
  return (
    <View style={{ gap: 8, marginTop: 2 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[styles.labelMark, { backgroundColor: colors.marker }]}>
          <Animated.View style={[styles.pulse, { backgroundColor: colors.onMarker, opacity: sweep }]} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.onMarker }}>{label}</Text>
        </View>
        {points > 0 && (
          <Text style={{ ...type.meta, fontSize: 13, color: colors.muted }}>
            {t(`${points} ${points === 1 ? 'punkt' : points < 5 ? 'punkty' : 'punktów'}`, `${points} ${points === 1 ? 'point' : 'points'}`)}
          </Text>
        )}
      </View>
      {live && (
        <View style={[styles.track, { backgroundColor: colors.surface }]}>
          <Animated.View style={[styles.trackInk, { backgroundColor: colors.ink, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
      )}
    </View>
  )
}

export function NoteRow({
  note,
  timestamp,
  onPress,
}: {
  note: Note
  timestamp: number
  groupPosition?: 'first' | 'middle' | 'last' | 'only'
  onPress: () => void
}) {
  const { colors } = useTheme()
  const { t, language, locale } = useI18n()
  const processing = useNotesStore((s) => s.processing[note.id] !== undefined)
  const categories = note.tags.filter(isCategory)
  const preview = note.summary?.trim() || note.content.trim()
  const time = new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const untitled = !note.title.trim()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.paper, borderColor: colors.line, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      <View style={styles.head}>
        <Text
          style={{ ...type.display, fontSize: 19, lineHeight: 25, flex: 1, color: untitled || processing ? colors.faint : colors.ink }}
          numberOfLines={1}
        >
          {note.title.trim() || t('Nowa notatka', 'New note')}
        </Text>
        <Text style={{ ...type.meta, color: colors.muted, fontVariant: ['tabular-nums'] }}>
          {time}{note.audioUri && note.durationMs !== null ? ` · ${formatDuration(note.durationMs)}` : ''}
        </Text>
      </View>
      {processing ? (
        <ProcessingStrip noteId={note.id} />
      ) : (
        <>
          {!!preview && (
            <Text style={{ ...type.body, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={2}>
              {preview.replace(/^[•\-–]\s*/u, '').replace(/\n+[•\-–]?\s*/gu, ' · ')}
            </Text>
          )}
          <View style={styles.chips}>
            {!note.audioUri && (
              <View style={[styles.chip, { backgroundColor: colors.surface }]}>
                <Icon name="note" size={12} color={colors.muted} />
                <Text style={[styles.chipText, { color: colors.muted }]}>{t('Tekst', 'Text')}</Text>
              </View>
            )}
            {categories.slice(0, 2).map((category) => (
              <View key={category} style={[styles.chip, { backgroundColor: colors.surface }]}>
                <Text style={[styles.chipText, { color: colors.ink }]}>{categoryLabel(category, language)}</Text>
              </View>
            ))}
            {categories.length > 2 && (
              <Text style={[styles.chipText, { color: colors.muted }]}>+{categories.length - 2}</Text>
            )}
          </View>
        </>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
    marginBottom: 10,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, paddingHorizontal: 9, borderRadius: 12 },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  labelMark: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, minHeight: 24, borderRadius: 12 },
  pulse: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  trackInk: { height: 3, borderRadius: 2 },
})
