import { Pressable, StyleSheet, Text, View } from 'react-native'
import { NOTE_CATEGORIES } from '../domain/categories'
import { radius, spacing, type, useTheme } from '../ui/theme'

export function NoteTags({
  tags,
  onChange,
  editable,
  showLabel = editable,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  editable: boolean
  showLabel?: boolean
}) {
  const { colors } = useTheme()
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
        <Text style={[styles.heading, { color: colors.ink }]}>Kategorie</Text>
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
                styles.chip,
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
              accessibilityLabel={category}
            >
              <Text
                style={[
                  styles.text,
                  { color: active ? colors.accent : colors.body },
                ]}
              >
                {category}
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
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  text: { ...type.label },
})
