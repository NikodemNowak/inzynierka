import { Pressable, StyleSheet, Text } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { type, useTheme, fonts } from '../ui/theme'
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

// The task's deadline under its title; tapping it offers Reminders or Calendar.
export function TaskDueChip({ text, recordedAt, noteTitle, done }: { text: string; recordedAt: Date; noteTitle: string; done: boolean }) {
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
      style={({ pressed }) => [
        styles.chip,
        label
          ? { backgroundColor: colors.surface, borderColor: colors.surface }
          : { borderColor: colors.faint, borderStyle: 'dashed' },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon name="calendar" size={12} color={label ? colors.ink : colors.muted} />
      <Text style={[styles.label, { color: label ? colors.ink : colors.muted, fontFamily: label ? fonts.semibold : fonts.regular }]}>{label ?? t('Przypomnij', 'Remind me')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 6, minHeight: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1 },
  label: { ...type.meta, fontVariant: ['tabular-nums'] },
})
