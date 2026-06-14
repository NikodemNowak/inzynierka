import { useCallback, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { useNotesStore } from '../state/notesStore'
import { useSpeechRecorder, type RecordingResult } from '../stt/useSpeechRecorder'
import { saveRecordingFile } from '../audio/audioFiles'

const defaultTitle = (): string =>
  `Import ${new Date().toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`

const statusLabel = (status: string): string => {
  if (status === 'starting') return 'Przygotowanie…'
  if (status === 'recording') return 'Transkrypcja pliku…'
  if (status === 'stopping') return 'Kończenie…'
  return 'Wybierz plik audio do transkrypcji'
}

export default function ImportAudioScreen() {
  const router = useRouter()
  const add = useNotesStore((state) => state.add)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      const transcript = result.transcript.trim()
      if (transcript.length === 0) {
        // Import exists to transcribe, so an empty result is a failure worth
        // surfacing (usually an unsupported format) rather than a silent save.
        setSaveError(
          'Nie rozpoznano mowy w pliku. Wspierane są 16 kHz WAV/MP3/OGG — inne formaty (np. 44 kHz m4a) mogą nie działać na Androidzie.',
        )
        return
      }
      setSaving(true)
      try {
        const note = await add({
          title: defaultTitle(),
          content: transcript,
          summary: null,
          audioUri: result.audioUri,
          durationMs: null,
        })
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

  const pickAndTranscribe = useCallback(async () => {
    setSaveError(null)
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      })
      if (picked.canceled) return
      const asset = picked.assets?.[0]
      if (!asset) return
      // Persist a copy first so the note keeps its audio after the cache clears,
      // then transcribe that stable file.
      const stored = await saveRecordingFile(asset.uri)
      await recorder.start({ uri: stored })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }, [recorder])

  const busy =
    recorder.status === 'starting' ||
    recorder.status === 'recording' ||
    recorder.status === 'stopping' ||
    saving
  const error = saveError ?? recorder.error

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Import audio' }} />
      <Text style={styles.status}>{statusLabel(recorder.status)}</Text>
      {recorder.info && <Text style={styles.status}>{recorder.info}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.transcriptBox}>
        {recorder.transcript.length > 0 ? (
          <Text style={styles.transcript}>{recorder.transcript}</Text>
        ) : (
          <Text style={styles.placeholder}>
            Wybierz nagranie z pliku. Transkrypcja pojawi się tutaj.
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <Button title="Wybierz plik audio" onPress={pickAndTranscribe} disabled={busy} />
      </View>
      {busy && <ActivityIndicator />}
      {saving && <Text style={styles.status}>Zapisywanie notatki…</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
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
