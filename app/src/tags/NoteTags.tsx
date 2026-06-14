import { useState } from 'react'
import { Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

export function NoteTags({
  tags,
  onChange,
  editable,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  editable: boolean
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const tag = input.trim().toLowerCase()
    if (tag.length > 0 && !tags.includes(tag)) onChange([...tags, tag])
    setInput('')
  }
  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag))

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Tagi</Text>
      <View style={styles.chips}>
        {tags.map((tag) => (
          <View key={tag} style={styles.chip}>
            <Text style={styles.chipText}>{tag}</Text>
            {editable && (
              <Pressable onPress={() => remove(tag)} hitSlop={6}>
                <Text style={styles.chipX}>×</Text>
              </Pressable>
            )}
          </View>
        ))}
        {tags.length === 0 && <Text style={styles.empty}>Brak tagów</Text>}
      </View>
      {editable && (
        <View style={styles.addRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Dodaj tag"
            autoCapitalize="none"
            style={styles.input}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Button title="Dodaj" onPress={add} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 4 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E0F2FE',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  chipText: { fontSize: 14, color: '#1F4E79' },
  chipX: { fontSize: 16, color: '#1F4E79', fontWeight: '700' },
  empty: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic' },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, fontSize: 15 },
})
