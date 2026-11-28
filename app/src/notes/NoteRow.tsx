import { useI18n } from '../i18n/useI18n'
import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Note } from '../domain/note'
import { Separator } from '../ui/Grouped'
import { useReducedMotion } from '../ui/Motion'
import { type, useTheme } from '../ui/theme'
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

// Shown in the row while the model works, so nobody has to wait on the note screen.
function ProcessingStrip({ noteId }: { noteId: string }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const phase = useNotesStore((s) => s.processing[noteId]?.phase)
  const live = useNotesStore((s) => s.processing[noteId]?.live)
  const fill = useRef(new Animated.Value(0)).current
  const fraction = live ? liveTrailFraction(live) : 0
  useEffect(() => {
    Animated.timing(fill, { toValue: fraction, duration: reduced ? 0 : 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [fraction, fill, reduced])
  const stage = phase === 'loading'
    ? t('wczytuję model', 'loading the model')
    : phase === 'queued'
      ? t('czekam na model', 'waiting for the model')
      : phase === 'title' || phase === 'tags'
        ? t('tytuł', 'title')
        : t('podsumowanie', 'summary')
  return (
    <View style={styles.processing} accessibilityLiveRegion="polite">
      <Text style={{ ...type.meta, color: colors.secondary }}>
        {t(`Opracowuję · ${stage}`, `Processing · ${stage}`)}
      </Text>
      <View style={[styles.track, { backgroundColor: colors.track }]}>
        <Animated.View style={[styles.trackFill, { backgroundColor: colors.accent, transform: [{ scaleX: fill }] }]} />
      </View>
    </View>
  )
}

function NoteRowView({
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
  const { t, locale } = useI18n()
  const processing = useNotesStore((s) => s.processing[note.id] !== undefined)
  const hasProposal = useNotesStore((s) => s.proposals[note.id] !== undefined)
  const preview = note.summary?.trim() || note.content.trim()
  const time = formatTime(timestamp, locale)
  const top = groupPosition === 'first' || groupPosition === 'only'
  const bottom = groupPosition === 'last' || groupPosition === 'only'
  const body = preview
    ? preview.replace(/^[•\-–]\s*/u, '').replace(/\n+[•\-–]?\s*/gu, ' · ')
    : note.audioUri
      ? t('Nagranie bez transkrypcji', 'Recording without a transcript')
      : t('Pusta notatka', 'Empty note')
  return (
    <View
      style={{
        backgroundColor: colors.group,
        borderTopLeftRadius: top ? 12 : 0,
        borderTopRightRadius: top ? 12 : 0,
        borderBottomLeftRadius: bottom ? 12 : 0,
        borderBottomRightRadius: bottom ? 12 : 0,
        overflow: 'hidden',
      }}
    >
      {!top && <Separator />}
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({ paddingVertical: 11, paddingHorizontal: 16, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={styles.titleLine}>
          <Text style={{ ...type.title, color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
            {note.title.trim() || t('Nowa notatka', 'New note')}
          </Text>
          {hasProposal && (
            <Text style={{ ...type.caption, color: colors.accent }}>{t('Nowa wersja', 'New version')}</Text>
          )}
        </View>
        {processing ? (
          <ProcessingStrip noteId={note.id} />
        ) : (
          <Text style={{ ...type.meta, color: colors.secondary, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
            {`${time}  ${body}`}
          </Text>
        )}
      </Pressable>
    </View>
  )
}

export const NoteRow = memo(NoteRowView)

const styles = StyleSheet.create({
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, width: '100%', transformOrigin: 'left' },
})
