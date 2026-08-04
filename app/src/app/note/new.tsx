import { useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { colors, spacing, type } from '../../ui/theme'
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
        tags: [],
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
      <Field label="Tytuł" value={title} onChangeText={setTitle} placeholder="Bez tytułu" />
      <Field
        label="Treść"
        value={content}
        onChangeText={setContent}
        placeholder="Wpisz treść notatki"
        multiline
        minHeight={160}
      />
      <Field
        label="Streszczenie"
        value={summary}
        onChangeText={setSummary}
        placeholder="Opcjonalne"
        multiline
        minHeight={80}
      />
      <Button
        label={saving ? 'Zapisuję…' : 'Zapisz notatkę'}
        variant="primary"
        onPress={save}
        disabled={saving}
        busy={saving}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.paper },
  error: { ...type.body, color: colors.danger },
})
