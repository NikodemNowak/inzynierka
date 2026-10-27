import { useI18n } from '../i18n/useI18n'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { EmptyIllustration } from '../ui/EmptyIllustration'
import { spacing, type, useTheme } from '../ui/theme'

export function TasksEmptyState({ onOpenNotes }: { onOpenNotes: () => void }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <EmptyIllustration
        kind="tasks"
        label={t('Ilustracja listy zadañ', 'Task list illustration')}
      />
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.ink }]}
      >
        {t('Jeszcze bez zadañ', 'No tasks yet')}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        {t(
          'Otwórz notatkê i wybierz „Zaproponuj zadania”.',
          'Open a note and choose “Suggest tasks”.',
        )}
      </Text>
      <Button
        compact
        variant="secondary"
        label={t('PrzejdŸ do notatek', 'Go to notes')}
        onPress={onOpenNotes}
        style={styles.action}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  title: { ...type.display, fontSize: 24, lineHeight: 32, textAlign: 'center' },
  description: {
    ...type.body,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  action: { marginTop: spacing.sm },
})
