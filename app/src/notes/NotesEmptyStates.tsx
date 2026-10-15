import { useI18n } from '../i18n/useI18n'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme } from '../ui/theme'

export function NotesEmptyState() {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel={t(
          'Ilustracja notatki z falą dźwiękową',
          'Illustration of a note with a sound wave',
        )}
        style={styles.illustration}
      >
        <View
          style={[styles.noteHalo, { backgroundColor: colors.accentSoft }]}
        />
        <View
          style={[
            styles.notePaper,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <View
            style={[
              styles.noteLine,
              { backgroundColor: colors.faint, width: '76%' },
            ]}
          />
          <View
            style={[
              styles.noteLine,
              { backgroundColor: colors.faint, width: '64%' },
            ]}
          />
          <View
            style={[
              styles.noteLine,
              { backgroundColor: colors.faint, width: '48%' },
            ]}
          />
          <View style={styles.noteWave}>
            {[12, 21, 15, 28, 18].map((height, index) => (
              <View
                key={index}
                style={{
                  width: 3,
                  height,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accent,
                }}
              />
            ))}
          </View>
        </View>
        <View style={[styles.noteSpark, { backgroundColor: colors.accent }]} />
        <View
          style={[styles.noteSparkSmall, { backgroundColor: colors.accent }]}
        />
      </View>
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
      <View
        style={[
          styles.searchIllustration,
          { backgroundColor: colors.accentSoft },
        ]}
      >
        <Icon name="search" color={colors.accent} size={42} />
        <View
          style={[styles.searchSpark, { backgroundColor: colors.accent }]}
        />
        <View
          style={[styles.searchSparkSmall, { backgroundColor: colors.accent }]}
        />
      </View>
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
      <Pressable
        accessibilityRole="button"
        onPress={onClear}
        style={({ pressed }) => [
          styles.clearAction,
          { backgroundColor: colors.accentSoft, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.clearActionText, { color: colors.accent }]}>
          {hasSearch
            ? t('Wyczyść wyszukiwanie', 'Clear search')
            : t('Wyczyść filtry', 'Clear filters')}
        </Text>
      </Pressable>
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
  illustration: {
    width: 154,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  noteHalo: {
    position: 'absolute',
    width: 138,
    height: 54,
    borderRadius: radius.pill,
    top: 48,
  },
  notePaper: {
    width: 76,
    height: 92,
    padding: 10,
    borderWidth: 1,
    borderRadius: radius.sm,
    gap: 8,
    justifyContent: 'center',
    transform: [{ rotate: '-5deg' }],
  },
  noteLine: { height: 4, borderRadius: radius.pill, opacity: 0.72 },
  noteWave: {
    height: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  noteSpark: {
    position: 'absolute',
    top: 21,
    right: 30,
    width: 3,
    height: 13,
    borderRadius: radius.pill,
    transform: [{ rotate: '22deg' }],
  },
  noteSparkSmall: {
    position: 'absolute',
    top: 33,
    right: 19,
    width: 3,
    height: 8,
    borderRadius: radius.pill,
    transform: [{ rotate: '52deg' }],
  },
  searchIllustration: {
    width: 102,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    marginBottom: spacing.lg,
  },
  searchSpark: {
    position: 'absolute',
    top: 5,
    right: 23,
    width: 3,
    height: 13,
    borderRadius: radius.pill,
    transform: [{ rotate: '20deg' }],
  },
  searchSparkSmall: {
    position: 'absolute',
    top: 17,
    right: 14,
    width: 3,
    height: 8,
    borderRadius: radius.pill,
    transform: [{ rotate: '50deg' }],
  },
  title: {
    ...type.title,
    fontSize: 23,
    lineHeight: 29,
    textAlign: 'center',
  },
  description: {
    ...type.body,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 300,
  },
  clearAction: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearActionText: { ...type.body, fontSize: 14, fontWeight: '500' },
})
