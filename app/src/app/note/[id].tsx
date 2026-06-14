import { useEffect, useRef, useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useNotesStore } from '../../state/notesStore'
import type { ProcessingProgress } from '../../ai/noteProcessing'
import { AudioNotePlayer } from '../../audio/AudioNotePlayer'

const formatProcessingStatus = (progress: ProcessingProgress): string => {
  if (progress.phase === 'downloading') {
    return `Pobieranie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
  }
  if (progress.phase === 'loading') {
    return `Ładowanie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
  }
  if (progress.phase === 'title') return 'Generowanie tytułu…'
  return 'Generowanie streszczenia…'
}

export default function EditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const note = useNotesStore((state) => state.notes.find((n) => n.id === id))
  const update = useNotesStore((state) => state.update)
  const remove = useNotesStore((state) => state.remove)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const progress = useNotesStore((state) => (id ? state.processing[id] : undefined))
  const processError = useNotesStore((state) => (id ? state.processingError[id] : undefined))
  const router = useRouter()

  // Return to the list even when this screen was opened without a back entry
  // (deep link, notification, or a replace() from recording) — otherwise a
  // failed back() would strand the user, e.g. on the "note not found" screen
  // after a delete.
  const goToList = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [summary, setSummary] = useState(note?.summary ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const processing = progress !== undefined

  // When a background run finishes, the store note now holds the generated
  // title/summary — pull them into the editable fields. Fields are locked while
  // processing, so this never clobbers a user edit.
  const wasProcessing = useRef(processing)
  useEffect(() => {
    if (wasProcessing.current && !processing && note) {
      setTitle(note.title)
      setSummary(note.summary ?? '')
    }
    wasProcessing.current = processing
  }, [processing, note])

  if (!note) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Notatka' }} />
        <Text style={styles.error}>Nie znaleziono notatki.</Text>
        <Button title="Wróć do listy" onPress={goToList} />
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
      goToList()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const processNote = async () => {
    const trimmedContent = content.trim()
    if (trimmedContent.length === 0) {
      setError('Treść nie może być pusta')
      return
    }
    setError(null)
    // Persist current edits first so the LLM works on what the user sees.
    await update(note.id, {
      title: title.trim(),
      content: trimmedContent,
      summary: summary.trim().length > 0 ? summary.trim() : null,
      audioUri: note.audioUri,
      durationMs: note.durationMs,
    })
    await processWithLlm(note.id)
  }

  const confirmDelete = () => {
    Alert.alert('Usunąć notatkę?', 'Tej operacji nie można cofnąć.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          await remove(note.id)
          goToList()
        },
      },
    ])
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Edycja notatki' }} />
      {error && <Text style={styles.error}>{error}</Text>}
      {processError && !processing && <Text style={styles.error}>{processError}</Text>}
      {note.audioUri && <AudioNotePlayer uri={note.audioUri} durationMs={note.durationMs} />}
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Tytuł (opcjonalny)"
        style={styles.title}
        editable={!processing}
      />
      <TextInput
        value={content}
        onChangeText={setContent}
        placeholder="Treść notatki"
        multiline
        style={styles.content}
        editable={!processing}
      />
      <TextInput
        value={summary}
        onChangeText={setSummary}
        placeholder="Streszczenie (opcjonalne)"
        multiline
        style={styles.summary}
        editable={!processing}
      />
      <Button
        title={processing ? 'Przetwarzanie…' : 'Przetwórz przez LLM'}
        onPress={processNote}
        disabled={saving || processing}
      />
      {progress && <Text style={styles.status}>{formatProcessingStatus(progress)}</Text>}
      {processing && <ActivityIndicator />}
      <Button
        title={saving ? 'Zapisywanie…' : 'Zapisz'}
        onPress={save}
        disabled={saving || processing}
      />
      <View style={styles.deleteWrap}>
        <Button title="Usuń" color="#B91C1C" onPress={confirmDelete} disabled={processing} />
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
