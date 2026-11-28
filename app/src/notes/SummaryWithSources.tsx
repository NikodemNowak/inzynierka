import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { parseSummaryDocument, type SummaryDocument, type SummaryPoint } from '../domain/summary'
import { useI18n } from '../i18n/useI18n'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { formatAudioTime } from '../audio/audioTime'
import { font, type, useTheme } from '../ui/theme'

const CONTEXT_CHARS = 80

// The quoted range with up to CONTEXT_CHARS of surrounding text, cut at word
// boundaries so a surrogate pair or a word is never split.
export const quoteContext = (content: string, range: { readonly start: number; readonly end: number }) => {
  const from = Math.max(0, range.start - CONTEXT_CHARS)
  const to = Math.min(content.length, range.end + CONTEXT_CHARS)
  let before = content.slice(from, range.start)
  let after = content.slice(range.end, to)
  if (from > 0) {
    const space = before.search(/\s/u)
    before = space < 0 ? '' : `…${before.slice(space + 1)}`
  }
  if (to < content.length) {
    const space = after.search(/\s\S*$/u)
    after = space < 0 ? '' : `${after.slice(0, space)}…`
  }
  return { before, quote: content.slice(range.start, range.end), after }
}

export interface SummaryWithSourcesProps {
  readonly noteId: string
  readonly revision: number
  readonly content: string
  readonly summary: string
  readonly document: SummaryDocument | null | undefined
  readonly active: boolean
  // Where a point was spoken, when the recording measured it.
  readonly pointTime?: (point: SummaryPoint) => { readonly startMs: number } | null
  readonly onPlayFrom?: (ms: number) => void
}

interface SourceSelection {
  readonly noteId: string
  readonly revision: number
  readonly content: string
  readonly summary: string
  readonly document: SummaryDocument | null | undefined
  readonly documentSignature: string
  readonly pointIndex: number
}

export function SummaryWithSources({ noteId, revision, content, summary, document, active, pointTime, onPlayFrom }: SummaryWithSourcesProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  // The hint shows until the first source sheet of this screen visit.
  const [sourceOpened, setSourceOpened] = useState(false)
  const parsed = useMemo(() => parseSummaryDocument(document, content, summary), [document, content, summary])
  const documentSignature = useMemo(() => JSON.stringify(document ?? null), [document])
  // Validate in render: an effect alone could publish one frame of stale quotes.
  const currentSelection = active && parsed && selection && selection.noteId === noteId
    && selection.revision === revision && selection.content === content && selection.summary === summary
    && selection.document === document && selection.documentSignature === documentSignature ? selection : null
  const selectedPoint = currentSelection ? parsed?.points[currentSelection.pointIndex] : undefined
  const selectedTime = selectedPoint && onPlayFrom ? pointTime?.(selectedPoint) ?? null : null
  useEffect(() => {
    if (selection && !currentSelection) setSelection(null)
  }, [selection, currentSelection])

  const sourceProps = (point: SummaryPoint, pointIndex: number) => ({
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: t(`Pokaż źródło: ${point.text}`, `Show source: ${point.text}`),
    accessibilityHint: t('Otwiera fragment transkrypcji.', 'Opens the transcript excerpt.'),
    onPress: () => {
      setSourceOpened(true)
      setSelection({ noteId, revision, content, summary, document, documentSignature, pointIndex })
    },
  })
  const row = (point: SummaryPoint, pointIndex: number) => (
    <Pressable key={pointIndex} {...sourceProps(point, pointIndex)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.78 : 1 }]}>
      <Text style={[styles.body, { color: colors.ink }]}>{`• ${point.text}`}</Text>
    </Pressable>
  )
  const groups = new Map<string, { point: SummaryPoint; index: number }[]>()
  if (parsed?.format === 'grouped') {
    parsed.points.forEach((point, index) => {
      const group = point.group ?? ''
      const entries = groups.get(group) ?? []
      entries.push({ point, index })
      groups.set(group, entries)
    })
  }

  return <>
    {!active || !parsed ? <Text style={[styles.body, { color: colors.ink }]}>{summary}</Text>
      : parsed.format === 'paragraph' ? (
        <View style={styles.paragraph} accessible={false}>
          <Text style={[styles.body, { color: colors.ink }]} accessible={false}>
            {parsed.points.map((point, index) => [index > 0 ? ' ' : null,
              <Text key={index} {...sourceProps(point, index)}>{point.text}</Text>])}
          </Text>
        </View>
      ) : parsed.format === 'grouped' ? (
        <View style={styles.groups}>
          {Array.from(groups, ([group, entries]) => <View key={group}>
            <Text accessibilityRole="header" style={[styles.body, styles.groupTitle, { color: colors.ink }]}>{group}</Text>
            {entries.map(({ point, index }) => row(point, index))}
          </View>)}
        </View>
      ) : <View>{parsed.points.map(row)}</View>}
    {active && parsed && !sourceOpened && (
      <Text style={[styles.hint, { color: colors.secondary }]}>
        {t('Dotknij punktu, aby zobaczyć, skąd pochodzi', 'Tap a point to see where it comes from')}
      </Text>
    )}
    <BottomSheet visible={Boolean(selectedPoint)} title={t('Skąd ten punkt', 'Where this point comes from')}
      onClose={() => setSelection(null)}>
      {selectedPoint && <Text style={[styles.point, { color: colors.ink }]}>{selectedPoint.text}</Text>}
      {selectedPoint && <View style={[styles.quoteCard, { backgroundColor: colors.group }]}>
        <Text style={[styles.origin, { color: colors.secondary }]}>
          {selectedTime
            ? t(`Z nagrania · ${formatAudioTime(selectedTime.startMs / 1000)}`, `From the recording · ${formatAudioTime(selectedTime.startMs / 1000)}`)
            : t('Z tekstu nagrania', 'From the recording text')}
        </Text>
        {selectedPoint.sources.map(range => {
          const { before, quote, after } = quoteContext(content, range)
          return <Text key={`${range.start}:${range.end}`} style={[styles.quote, { color: colors.secondary }]}>
            {before}
            <Text testID="summary-source-quote" style={{ color: colors.ink, backgroundColor: colors.tint }}>{quote}</Text>
            {after}
          </Text>
        })}
      </View>}
      {selectedTime && onPlayFrom && <Button variant="primary" icon="play"
        label={t(`Odtwórz od ${formatAudioTime(selectedTime.startMs / 1000)}`, `Play from ${formatAudioTime(selectedTime.startMs / 1000)}`)}
        onPress={() => {
          setSelection(null)
          onPlayFrom(selectedTime.startMs)
        }} />}
    </BottomSheet>
  </>
}

const styles = StyleSheet.create({
  body: { ...type.body, lineHeight: 24 },
  groupTitle: { ...font.semibold },
  hint: { ...type.caption, ...font.regular, marginTop: 8 },
  point: { ...type.body, ...font.semibold, lineHeight: 24 },
  quoteCard: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  origin: { ...type.caption, ...font.regular },
  quote: { ...type.meta, lineHeight: 22 },
  row: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  paragraph: { minHeight: 44 },
  groups: { gap: 23 },
})
