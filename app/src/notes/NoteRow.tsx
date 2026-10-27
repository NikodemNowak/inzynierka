import { useI18n } from '../i18n/useI18n'
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { categoryLabel, isCategory } from '../domain/categories'
import { Icon } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { fonts, radius, type, useTheme } from '../ui/theme'
import { useNotesStore } from '../state/notesStore'
import { liveTrailFraction } from './ProcessingLive'

const timeFormats = new Map<string, Intl.DateTimeFormat>()
const formatTime = (timestamp: number, locale: string): string => {
  let format = timeFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    timeFormats.set(locale, format)
  }
  return format.format(timestamp)
}

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

// Shown on the card while the model works, so nobody has to wait on the note screen.
function ProcessingStrip({ noteId }: { noteId: string }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const phase = useNotesStore((s) => s.processing[noteId]?.phase)
  const live = useNotesStore((s) => s.processing[noteId]?.live)
  const sweep = useRef(new Animated.Value(1)).current
  const fill = useRef(new Animated.Value(0)).current
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
    Animated.timing(fill, { toValue: fraction, duration: reduced ? 0 : 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [fraction, fill, reduced])
  const label = phase === 'loading'
    ? t('Wczytuję model', 'Loading the model')
    : phase === 'queued'
      ? t('Czekam na model', 'Waiting for the model')
      : phase === 'title' || phase === 'tags'
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
      <View style={[styles.track, { backgroundColor: colors.surface }]}>
        <Animated.View style={[styles.trackInk, { backgroundColor: colors.ink, transform: [{ scaleX: fill }] }]} />
      </View>
    </View>
  )
}

function NoteRowView({
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
  const hasProposal = useNotesStore((s) => s.proposals[note.id] !== undefined)
  const reduced = useReducedMotion()
  const swap = useRef(new Animated.Value(1)).current
  const swapped = useRef(processing)
  useEffect(() => {
    if (swapped.current === processing) return
    swapped.current = processing
    if (reduced) return
    swap.setValue(0)
    Animated.timing(swap, { toValue: 1, duration: 200, useNativeDriver: true }).start()
  }, [processing, reduced, swap])
  const categories = note.tags.filter(isCategory)
  const preview = note.summary?.trim() || note.content.trim()
  const time = formatTime(timestamp, locale)
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
      <Text
        style={{ ...type.display, fontSize: 19, lineHeight: 25, color: untitled || processing ? colors.faint : colors.ink }}
        numberOfLines={2}
      >
        {note.title.trim() || t('Nowa notatka', 'New note')}
      </Text>
      <Animated.View style={[styles.slot, { opacity: swap }]}>
      {processing ? (
        <ProcessingStrip noteId={note.id} />
      ) : preview ? (
        <Text style={{ ...type.body, fontSize: 14, lineHeight: 20, color: colors.muted }} numberOfLines={2}>
          {preview.replace(/^[•\-–]\s*/u, '').replace(/\n+[•\-–]?\s*/gu, ' · ')}
        </Text>
      ) : (
        <Text style={{ ...type.body, fontSize: 14, lineHeight: 20, color: colors.faint, fontStyle: 'italic' }}>
          {note.audioUri ? t('Nagranie bez transkrypcji', 'Recording without a transcript') : t('Pusta notatka', 'Empty note')}
        </Text>
      )}
      </Animated.View>
      <View style={styles.meta}>
        <View style={[styles.chip, { backgroundColor: colors.surface }]}>
          <Icon name={note.audioUri ? 'waveform' : 'note'} size={12} color={colors.muted} />
          <Text style={[styles.chipText, { color: colors.muted, fontVariant: ['tabular-nums'] }]}>
            {note.audioUri
              ? note.durationMs !== null ? formatDuration(note.durationMs) : t('Nagranie', 'Recording')
              : t('Tekst', 'Text')}
          </Text>
        </View>
        {!processing && categories.slice(0, 2).map((category) => (
          <View key={category} style={[styles.chip, { backgroundColor: colors.surface }]}>
            <Text style={[styles.chipText, { color: colors.ink }]}>{categoryLabel(category, language)}</Text>
          </View>
        ))}
        {!processing && categories.length > 2 && (
          <Text style={[styles.chipText, { color: colors.muted }]}>+{categories.length - 2}</Text>
        )}
        {hasProposal && (
          <View style={[styles.chip, { backgroundColor: colors.marker }]}>
            <Text style={[styles.chipText, { color: colors.onMarker }]}>{t('Nowa wersja', 'New version')}</Text>
          </View>
        )}
        <Text style={{ ...type.meta, color: colors.muted, marginLeft: 'auto', fontVariant: ['tabular-nums'] }}>{time}</Text>
      </View>
    </Pressable>
  )
}

export const NoteRow = memo(NoteRowView)

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
    marginBottom: 10,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, paddingHorizontal: 9, borderRadius: 12 },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  labelMark: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, minHeight: 24, borderRadius: 12 },
  pulse: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  trackInk: { height: 3, borderRadius: 2, width: '100%', transformOrigin: 'left' },
  slot: { minHeight: 40, justifyContent: 'center' },
})
