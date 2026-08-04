import { useCallback, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'
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
          tags: [],
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
        <Button label="Wybierz plik audio" variant="primary" onPress={pickAndTranscribe} disabled={busy} busy={busy} />
      </View>
      {saving && <Text style={styles.status}>Zapisywanie notatki…</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.paper },
  status: { ...type.body, color: colors.muted, textAlign: 'center' },
  transcriptBox: {
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 180,
    backgroundColor: colors.surface,
  },
  transcript: { ...type.body, fontSize: 17, lineHeight: 26, color: colors.ink },
  placeholder: { ...type.body, color: colors.faint },
  actions: { marginTop: spacing.xs },
  error: { ...type.body, color: colors.danger, textAlign: 'center' },
})
