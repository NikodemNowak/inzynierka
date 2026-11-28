import { useI18n } from '../i18n/useI18n'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { categoryLabel, NOTE_CATEGORIES } from '../domain/categories'
import { radius, spacing, type, useTheme, font } from '../ui/theme'

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
                  backgroundColor: active ? colors.tint : colors.track,
                  opacity: pressed && editable ? 0.6 : 1,
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
                  { color: active ? colors.onTint : colors.ink },
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
    paddingHorizontal: 14,
  },
  compactChip: {
    borderRadius: radius.pill,
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  text: { ...type.meta, ...font.semibold },
  compactText: { ...type.caption },
})
