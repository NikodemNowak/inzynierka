import { useI18n } from '../i18n/useI18n'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { spacing, type, useTheme } from '../ui/theme'

export function TasksEmptyState({ onOpenNotes }: { onOpenNotes: () => void }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('Jeszcze bez zadań', 'No tasks yet')}
      </Text>
      <Text style={[styles.description, { color: colors.secondary }]}>
        {t(
          'Otwórz notatkę i wybierz „Zaproponuj zadania”.',
          'Open a note and choose “Suggest tasks”.',
        )}
      </Text>
      <Button
        compact
        variant="secondary"
        label={t('Przejdź do notatek', 'Go to notes')}
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
  title: { ...type.section, textAlign: 'center' },
  description: { ...type.body, textAlign: 'center' },
  action: { marginTop: spacing.sm },
})
