import { Pressable, StyleSheet, Text, View } from 'react-native'
import { NOTE_CATEGORIES } from '../domain/categories'
import { colors, radius, spacing, type } from '../ui/theme'

export function NoteTags({
  tags,
  onChange,
  editable,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  editable: boolean
}) {
  const toggle = (category: string) =>
    onChange(tags.includes(category) ? tags.filter((t) => t !== category) : [...tags, category])

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Kategorie</Text>
      <View style={styles.chips}>
        {NOTE_CATEGORIES.map((category) => {
          const active = tags.includes(category)
          return (
            <Pressable
              key={category}
              disabled={!editable}
              onPress={() => toggle(category)}
              style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={active ? styles.textActive : styles.textInactive}>{category}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  heading: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipInactive: { backgroundColor: colors.paper, borderColor: colors.line },
  textActive: { ...type.label, color: colors.paper },
  textInactive: { ...type.label, color: colors.body },
})
