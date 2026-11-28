import { Pressable, StyleSheet, Text } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { type, useTheme } from '../ui/theme'
import { resolveDue, taskDuePhrase } from './taskDue'
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

// The task's deadline under its title as plain secondary text; tapping it offers Reminders or Calendar.
export function TaskDueChip({ text, recordedAt, noteTitle, done, overdue = false }: { text: string; recordedAt: Date; noteTitle: string; done: boolean; overdue?: boolean }) {
  const { colors } = useTheme()
  const { t, locale } = useI18n()
  const due = taskDuePhrase(text)
  const label = due ? formatResolvedDue(due, recordedAt, locale) : null
  if (done) return label ? <Text style={[styles.label, { color: colors.faint }]}>{label}</Text> : null
  // A task without a deadline can still go to Reminders or Calendar; the date is set there.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? t(`Termin: ${label}. Dodaj do kalendarza`, `Due: ${label}. Add to calendar`) : t('Dodaj przypomnienie lub wydarzenie', 'Add a reminder or event')}
      onPress={() => offerTaskExport(text, recordedAt, noteTitle)}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.label, { color: label ? (overdue ? colors.red : colors.secondary) : colors.accent }]}>{label ?? t('Przypomnij', 'Remind me')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', marginTop: 2, minHeight: 20, justifyContent: 'center' },
  label: { ...type.meta, fontVariant: ['tabular-nums'] },
})
