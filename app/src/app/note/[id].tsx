import { useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useNotesStore } from '../../state/notesStore'
import { summarizeNoteContent, type SummarizationProgress } from '../../ai/summarization'
import { AudioNotePlayer } from '../../audio/AudioNotePlayer'

export default function EditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const note = useNotesStore((state) => state.notes.find((n) => n.id === id))
  const update = useNotesStore((state) => state.update)
  const remove = useNotesStore((state) => state.remove)
  const router = useRouter()

  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [summary, setSummary] = useState(note?.summary ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryStatus, setSummaryStatus] = useState<string | null>(null)

  if (!note) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Notatka' }} />
        <Text style={styles.error}>Nie znaleziono notatki.</Text>
      </View>
    )
  }

  const save = async () => {
    if (content.trim().length === 0) {
      setError('Treść nie może być pusta')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await update(note.id, {
        title: title.trim(),
        content: content.trim(),
        summary: summary.trim().length > 0 ? summary.trim() : null,
        audioUri: note.audioUri,
        durationMs: note.durationMs,
      })
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const formatSummaryStatus = (progress: SummarizationProgress): string => {
    if (progress.phase === 'downloading') {
      return `Pobieranie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
    }
    if (progress.phase === 'loading') {
      return `Ładowanie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
    }
    return 'Generowanie streszczenia…'
  }

  const summarize = async () => {
    const trimmedContent = content.trim()
    if (trimmedContent.length === 0) {
      setError('Treść nie może być pusta')
      return
    }

    setError(null)
    setSummarizing(true)
    setSummaryStatus('Przygotowanie modelu…')
    try {
      const generatedSummary = await summarizeNoteContent(trimmedContent, (progress) => {
        setSummaryStatus(formatSummaryStatus(progress))
      })
      setSummary(generatedSummary)
      await update(note.id, {
        title: title.trim(),
        content: trimmedContent,
        summary: generatedSummary,
        audioUri: note.audioUri,
        durationMs: note.durationMs,
      })
      setSummaryStatus('Streszczenie zapisane')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSummaryStatus(null)
    } finally {
      setSummarizing(false)
    }
  }

  const confirmDelete = () => {
    Alert.alert('Usunąć notatkę?', 'Tej operacji nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          await remove(note.id)
          router.back()
        },
      },
    ])
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Edycja notatki' }} />
      {error && <Text style={styles.error}>{error}</Text>}
      {note.audioUri && <AudioNotePlayer uri={note.audioUri} durationMs={note.durationMs} />}
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
        editable={!summarizing}
      />
      <Button
        title={summarizing ? 'Streszczanie…' : 'Wygeneruj streszczenie'}
        onPress={summarize}
        disabled={saving || summarizing}
      />
      {summaryStatus && <Text style={styles.status}>{summaryStatus}</Text>}
      {summarizing && <ActivityIndicator />}
      <Button
        title={saving ? 'Zapisywanie…' : 'Zapisz'}
        onPress={save}
        disabled={saving || summarizing}
      />
      <View style={styles.deleteWrap}>
        <Button title="Usuń" color="#B91C1C" onPress={confirmDelete} />
      </View>
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
  deleteWrap: { marginTop: 8 },
  status: { color: '#1F4E79', fontSize: 14 },
  error: { color: '#B91C1C', fontSize: 14 },
})
