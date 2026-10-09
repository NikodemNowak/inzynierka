import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { parseSummaryDocument, type SummaryDocument, type SummaryPoint } from '../domain/summary'
import { useI18n } from '../i18n/useI18n'
import { BottomSheet } from '../ui/BottomSheet'
import { type, useTheme } from '../ui/theme'

export interface SummaryWithSourcesProps {
  readonly noteId: string
  readonly revision: number
  readonly content: string
  readonly summary: string
  readonly document: SummaryDocument | null | undefined
  readonly active: boolean
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

export function SummaryWithSources({ noteId, revision, content, summary, document, active }: SummaryWithSourcesProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  const parsed = parseSummaryDocument(document, content, summary)
  const documentSignature = JSON.stringify(document ?? null)
  // Validate in render: an effect alone could publish one frame of stale quotes.
  const currentSelection = active && parsed && selection && selection.noteId === noteId
    && selection.revision === revision && selection.content === content && selection.summary === summary
    && selection.document === document && selection.documentSignature === documentSignature ? selection : null
  const selectedPoint = currentSelection ? parsed?.points[currentSelection.pointIndex] : undefined
  useEffect(() => {
    if (selection && !currentSelection) setSelection(null)
  }, [selection, currentSelection])

  const sourceProps = (point: SummaryPoint, pointIndex: number) => ({
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: t(`Pokaż źródło: ${point.text}`, `Show source: ${point.text}`),
    accessibilityHint: t('Otwiera fragment transkrypcji.', 'Opens the transcript excerpt.'),
    onPress: () => setSelection({ noteId, revision, content, summary, document, documentSignature, pointIndex }),
  })
  const row = (point: SummaryPoint, pointIndex: number) => (
    <Pressable key={pointIndex} {...sourceProps(point, pointIndex)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.78 : 1 }]}>
      <Text style={[styles.body, { color: colors.body }]}>{`• ${point.text}`}</Text>
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
    {!active || !parsed ? <Text style={[styles.body, { color: colors.body }]}>{summary}</Text>
      : parsed.format === 'paragraph' ? (
        <View style={styles.paragraph} accessible={false}>
          <Text style={[styles.body, { color: colors.body }]} accessible={false}>
            {parsed.points.map((point, index) => [index > 0 ? ' ' : null,
              <Text key={index} {...sourceProps(point, index)}>{point.text}</Text>])}
          </Text>
        </View>
      ) : parsed.format === 'grouped' ? (
        <View style={styles.groups}>
          {Array.from(groups, ([group, entries]) => <View key={group}>
            <Text accessibilityRole="header" style={[styles.body, { color: colors.body }]}>{group}</Text>
            {entries.map(({ point, index }) => row(point, index))}
          </View>)}
        </View>
      ) : <View>{parsed.points.map(row)}</View>}
    <BottomSheet visible={Boolean(selectedPoint)} title={t('Fragment transkrypcji', 'Transcript excerpt')}
      onClose={() => setSelection(null)}>
      {selectedPoint?.sources.map(range => <Text key={`${range.start}:${range.end}`} testID="summary-source-quote"
        style={[styles.body, { color: colors.ink }]}>{content.slice(range.start, range.end)}</Text>)}
    </BottomSheet>
  </>
}

const styles = StyleSheet.create({
  body: { ...type.body, fontSize: 15, lineHeight: 23 },
  row: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  paragraph: { minHeight: 44 },
  groups: { gap: 23 },
})
