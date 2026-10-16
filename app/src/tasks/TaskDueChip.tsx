import { Pressable, StyleSheet, Text } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'
import { resolveDue, splitTaskText } from './taskDue'
import { offerTaskExport } from './taskExport'

// "czw. 15 paź · 18:00": the deadline as a date, relative to when the note was recorded.
export const formatResolvedDue = (due: string, recordedAt: Date, locale: string): string => {
  const resolved = resolveDue(due, recordedAt)
  if (!resolved) return due
  const day = resolved.date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  if (resolved.allDay) return day
  const time = resolved.date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

// The task's deadline under its title; tapping it offers Reminders or Calendar.
export function TaskDueChip({ text, recordedAt, noteTitle, done }: { text: string; recordedAt: Date; noteTitle: string; done: boolean }) {
  const { colors } = useTheme()
  const { t, locale } = useI18n()
  const { due } = splitTaskText(text)
  if (!due) return null
  const label = formatResolvedDue(due, recordedAt, locale)
  if (done) return <Text style={[styles.label, { color: colors.faint }]}>{label}</Text>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`Termin: ${label}. Dodaj do kalendarza`, `Due: ${label}. Add to calendar`)}
      onPress={() => offerTaskExport(text, recordedAt, noteTitle)}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name="calendar" size={13} color={colors.muted} />
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 3 },
  label: { ...type.meta, fontVariant: ['tabular-nums'] },
})
