import { useEffect, useMemo, useRef, useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { colors, spacing, type } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { useTasksStore } from '../../state/tasksStore'
import { useModelStore } from '../../state/modelStore'
import { formatNoteAsText } from '../../export/noteText'
import { MODEL_MISSING_MESSAGE, type ProcessingProgress } from '../../ai/noteProcessing'
import { AudioNotePlayer } from '../../audio/AudioNotePlayer'
import { NoteTasks } from '../../tasks/NoteTasks'
import { NoteTags } from '../../tags/NoteTags'
import { isCategory } from '../../domain/categories'

const formatProcessingStatus = (progress: ProcessingProgress): string => {
  if (progress.phase === 'loading') {
    return `Ładowanie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
  }
  if (progress.phase === 'title') return 'Generowanie tytułu…'
  if (progress.phase === 'tags') return 'Dobieranie kategorii…'
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
  // Selected whole and filtered here on purpose: a selector that builds a new
  // array on every read is never reference-equal, which spins the store
  // subscription into an endless re-render.
  const modelReady = useModelStore((state) => state.status === 'ready')
  const allTasks = useTasksStore((state) => state.tasks)
  const noteTasks = useMemo(() => allTasks.filter((t) => t.noteId === id), [allTasks, id])
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
  const [tags, setTags] = useState<string[]>((note?.tags ?? []).filter(isCategory))
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
      setTags(note.tags.filter(isCategory))
    }
    wasProcessing.current = processing
  }, [processing, note])

  if (!note) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Notatka' }} />
        <Text style={styles.error}>Ta notatka już nie istnieje.</Text>
        <Button label="Wróć do listy" onPress={goToList} />
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
        tags,
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
      tags,
      audioUri: note.audioUri,
      durationMs: note.durationMs,
    })
    await processWithLlm(note.id)
  }

  // Shares what is on screen rather than what is stored, so unsaved edits are
  // not silently dropped from the shared text. A cancelled share sheet is a
  // normal outcome, not an error.
  const shareNote = async () => {
    const text = formatNoteAsText(
      { ...note, title: title.trim(), content: content.trim(), summary: summary.trim() || null, tags },
      noteTasks,
    )
    try {
      await Share.share({ message: text })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
          goToList()
        },
      },
    ])
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Edycja notatki',
          headerRight: () => (
            <Pressable
              onPress={shareNote}
              style={styles.headerButton}
              disabled={processing}
              accessibilityRole="button"
              accessibilityState={{ disabled: processing }}
            >
              <Text style={[styles.headerAction, processing && styles.headerActionDisabled]}>
                Udostępnij
              </Text>
            </Pressable>
          ),
        }}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {processError && !processing && <Text style={styles.error}>{processError}</Text>}
      {note.audioUri && <AudioNotePlayer uri={note.audioUri} durationMs={note.durationMs} />}

      <Field
        label="Tytuł"
        value={title}
        onChangeText={setTitle}
        placeholder="Bez tytułu"
        editable={!processing}
        textStyle={styles.titleText}
      />
      <Field
        label="Transkrypcja"
        value={content}
        onChangeText={setContent}
        placeholder="Treść notatki"
        multiline
        minHeight={140}
        editable={!processing}
      />
      <Field
        label="Streszczenie"
        value={summary}
        onChangeText={setSummary}
        placeholder="Wygeneruj lub napisz własne"
        multiline
        minHeight={80}
        editable={!processing}
      />

      <NoteTags tags={tags} onChange={setTags} editable={!processing} />

      <Button
        label={processing ? 'Przetwarzam…' : 'Przetwórz lokalnym modelem'}
        onPress={processNote}
        disabled={saving || processing || !modelReady}
        busy={processing}
      />
      {!modelReady && <Text style={styles.hint}>{MODEL_MISSING_MESSAGE}</Text>}
      {progress && <Text style={styles.status}>{formatProcessingStatus(progress)}</Text>}
      <Button
        label={saving ? 'Zapisuję…' : 'Zapisz zmiany'}
        variant="primary"
        onPress={save}
        disabled={saving || processing}
        busy={saving}
      />

      <View style={styles.divider} />
      <NoteTasks noteId={note.id} content={content} />

      <View style={styles.divider} />
      <Button label="Usuń notatkę" variant="danger" onPress={confirmDelete} disabled={processing} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.paper },
  titleText: { ...type.title },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xs },
  status: { ...type.meta, color: colors.navy },
  error: { ...type.body, color: colors.danger },
  hint: { ...type.meta, color: colors.muted },
  headerButton: { minHeight: 44, justifyContent: 'center' },
  headerAction: { ...type.label, color: colors.navy },
  headerActionDisabled: { color: colors.faint },
})
