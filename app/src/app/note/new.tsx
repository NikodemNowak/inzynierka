import { useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { Button, ScrollView, StyleSheet, Text, TextInput } from 'react-native'
import { useNotesStore } from '../../state/notesStore'

export default function NewNoteScreen() {
  const add = useNotesStore((state) => state.add)
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (content.trim().length === 0) {
      setError('Treść nie może być pusta')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await add({
        title: title.trim(),
        content: content.trim(),
        summary: summary.trim().length > 0 ? summary.trim() : null,
        audioUri: null,
        durationMs: null,
      })
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Nowa notatka' }} />
      {error && <Text style={styles.error}>{error}</Text>}
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Tytuł (opcjonalny)"
        style={styles.title}
      />
      <TextInput
        value={content}
        onChangeText={setContent}
        placeholder="Treść notatki"
        multiline
        style={styles.content}
      />
      <TextInput
        value={summary}
        onChangeText={setSummary}
        placeholder="Streszczenie (opcjonalne)"
        multiline
        style={styles.summary}
      />
      <Button title={saving ? 'Zapisywanie…' : 'Zapisz'} onPress={save} disabled={saving} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  content: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  summary: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  error: { color: '#B91C1C', fontSize: 14 },
})
