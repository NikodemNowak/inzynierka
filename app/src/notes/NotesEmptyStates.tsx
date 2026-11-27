import { useI18n } from '../i18n/useI18n'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { EmptyIllustration } from '../ui/EmptyIllustration'
import { spacing, type, useTheme } from '../ui/theme'

export function NotesEmptyState() {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <EmptyIllustration
        kind="note"
        label={t(
          'Ilustracja notatki z falą dźwiękową',
          'Illustration of a note with a sound wave',
        )}
      />
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.ink }]}
      >
        {t('Miejsce na Twoje myśli', 'A place for your thoughts')}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        {t(
          'Nagraj, zaimportuj lub napisz pierwszą notatkę.',
          'Record, import, or write your first note.',
        )}
      </Text>
    </View>
  )
}

export function NotesNoResultsState({
  hasSearch,
  onClear,
}: {
  hasSearch: boolean
  onClear: () => void
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <EmptyIllustration kind="search" label={t('Ilustracja wyszukiwania', 'Search illustration')} />
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.ink }]}
      >
        {t('Brak wyników', 'No results')}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        {t(
          'Spróbuj innego hasła lub usuń filtry.',
          'Try another search or clear the filters.',
        )}
      </Text>
      <Button
        compact
        variant="secondary"
        onPress={onClear}
        label={
          hasSearch
            ? t('Wyczyść wyszukiwanie', 'Clear search')
            : t('Wyczyść filtry', 'Clear filters')
        }
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
    maxWidth: 300,
  },
  action: { marginTop: spacing.sm },
})
