import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import { useNotesStore } from '../state/notesStore'
import { saveRecordingFile } from '../audio/audioFiles'

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

export default function RecordNoteScreen() {
  const router = useRouter()
  const add = useNotesStore((state) => state.add)
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(audioRecorder, 250)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
    })
  }, [])

  const startRecording = async () => {
    setError(null)
    const permission = await AudioModule.requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setError('Brak zgody na użycie mikrofonu')
      return
    }
    await audioRecorder.prepareToRecordAsync()
    audioRecorder.record()
  }

  const stopRecording = async () => {
    setError(null)
    setSaving(true)
    const durationMs = recorderState.durationMillis
    try {
      await audioRecorder.stop()
      const temporaryUri = audioRecorder.uri ?? recorderState.url
      if (!temporaryUri) throw new Error('Nie udało się odczytać pliku nagrania')
      const audioUri = await saveRecordingFile(temporaryUri)
      const note = await add({
        title: defaultTitle(),
        content: '',
        summary: null,
        audioUri,
        durationMs,
      })
      router.replace(`/note/${note.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const recording = recorderState.isRecording

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Nagrywanie' }} />
      <Text style={styles.duration}>{formatDuration(recorderState.durationMillis)}</Text>
      <Text style={styles.status}>
        {recording ? 'Nagrywanie trwa' : 'Gotowe do nagrywania'}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Button
          title={recording ? 'Zatrzymaj i zapisz' : 'Rozpocznij nagrywanie'}
          onPress={recording ? stopRecording : startRecording}
          disabled={saving}
        />
      </View>
      {saving && <Text style={styles.status}>Zapisywanie nagrania…</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  duration: { fontSize: 48, fontWeight: '700', textAlign: 'center', marginVertical: 24 },
  status: { color: '#1F4E79', fontSize: 16, textAlign: 'center' },
  actions: { marginTop: 12 },
  error: { color: '#B91C1C', fontSize: 14 },
})
