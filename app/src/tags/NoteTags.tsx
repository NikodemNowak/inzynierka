import { useI18n } from '../i18n/useI18n'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { categoryLabel, NOTE_CATEGORIES } from '../domain/categories'
import { radius, spacing, type, useTheme, fonts } from '../ui/theme'

export function NoteTags({
  tags,
  onChange,
  editable,
  showLabel = editable,
  compact = false,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  editable: boolean
  showLabel?: boolean
  compact?: boolean
}) {
  const { colors } = useTheme()
  const { t, language } = useI18n()
  const categories = editable
    ? NOTE_CATEGORIES
    : NOTE_CATEGORIES.filter((tag) => tags.includes(tag))
  const toggle = (category: string) =>
    onChange(
      tags.includes(category)
        ? tags.filter((tag) => tag !== category)
        : [...tags, category],
    )

  if (!editable && categories.length === 0) return null

  return (
    <View style={styles.container}>
      {showLabel && (
        <Text style={[styles.heading, { color: colors.ink }]}>
          {t('Kategorie', 'Categories')}
        </Text>
      )}
      <View style={styles.chips}>
        {categories.map((category) => {
          const active = tags.includes(category)
          return (
            <Pressable
              key={category}
              disabled={!editable}
              onPress={() => toggle(category)}
              style={({ pressed }) => [
                compact ? styles.compactChip : styles.chip,
                {
                  backgroundColor: active ? colors.accentSoft : colors.surface,
                  borderColor: active ? colors.accentSoft : colors.surface,
                  opacity: pressed && editable ? 0.72 : 1,
                },
              ]}
              accessibilityRole={editable ? 'checkbox' : 'text'}
              accessibilityState={
                editable ? { checked: active, disabled: !editable } : undefined
              }
              accessibilityLabel={categoryLabel(category, language)}
            >
              <Text
                style={[
                  compact ? styles.compactText : styles.text,
                  { color: active ? colors.accent : colors.body },
                ]}
              >
                {categoryLabel(category, language)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  heading: { ...type.label },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  compactChip: {
    borderRadius: radius.pill,
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  text: { ...type.label, fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  compactText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium },
})
