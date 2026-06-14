import { useCallback, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNotesStore } from '../state/notesStore'
import { useSpeechRecorder, type RecordingResult } from '../stt/useSpeechRecorder'

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const defaultTitle = (): string =>
  `Nagranie ${new Date().toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`

const statusLabel = (status: string): string => {
  if (status === 'starting') return 'Uruchamianie…'
  if (status === 'recording') return 'Nagrywanie i transkrypcja…'
  if (status === 'stopping') return 'Kończenie…'
  return 'Gotowe do nagrywania'
}

export default function RecordNoteScreen() {
  const router = useRouter()
  const add = useNotesStore((state) => state.add)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      if (result.transcript.trim().length === 0 && !result.audioUri) {
        setSaveError('Nie rozpoznano mowy ani nie zapisano nagrania')
        return
      }
      setSaving(true)
      try {
        const transcript = result.transcript.trim()
        const note = await add({
          title: defaultTitle(),
          content: transcript,
          summary: null,
          tags: [],
          audioUri: result.audioUri,
          durationMs: result.durationMs,
        })
        // Generate title + summary in the background; the store keeps running it
        // after we navigate away, and the note/list update when it lands.
        if (transcript.length > 0) void processWithLlm(note.id)
        router.replace(`/note/${note.id}`)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, processWithLlm, router],
  )

  const recorder = useSpeechRecorder(handleComplete)

  const onStart = () => {
    setSaveError(null)
    void recorder.start()
  }

  const active = recorder.status === 'recording' || recorder.status === 'starting'
  const busy = recorder.status === 'stopping' || saving
  const error = saveError ?? recorder.error

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Nagrywanie' }} />
      <Text style={styles.duration}>{formatDuration(recorder.durationMs)}</Text>
      <Text style={styles.status}>{statusLabel(recorder.status)}</Text>
      {recorder.info && <Text style={styles.status}>{recorder.info}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.transcriptBox}>
        {recorder.transcript.length > 0 ? (
          <Text style={styles.transcript}>{recorder.transcript}</Text>
        ) : (
          <Text style={styles.placeholder}>
            Transkrypcja pojawi się tutaj na żywo.
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          title={active ? 'Zatrzymaj i zapisz' : 'Rozpocznij nagrywanie'}
          onPress={active ? recorder.stop : onStart}
          disabled={busy}
        />
      </View>
      {busy && <ActivityIndicator />}
      {saving && <Text style={styles.status}>Zapisywanie notatki…</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  duration: { fontSize: 48, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
  status: { color: '#1F4E79', fontSize: 16, textAlign: 'center' },
  transcriptBox: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    minHeight: 160,
    backgroundColor: '#F9FAFB',
  },
  transcript: { fontSize: 17, lineHeight: 24, color: '#111827' },
  placeholder: { fontSize: 15, color: '#9CA3AF', fontStyle: 'italic' },
  actions: { marginTop: 8 },
  error: { color: '#B91C1C', fontSize: 14, textAlign: 'center' },
})
