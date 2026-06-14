import { Pressable, StyleSheet, Text, View } from 'react-native'
import { NOTE_CATEGORIES } from '../domain/categories'

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
  container: { gap: 8, marginTop: 4 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1 },
  chipActive: { backgroundColor: '#1F4E79', borderColor: '#1F4E79' },
  chipInactive: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1' },
  textActive: { color: '#FFFFFF', fontSize: 14 },
  textInactive: { color: '#374151', fontSize: 14 },
})
