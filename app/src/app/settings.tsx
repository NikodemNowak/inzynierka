import { useState } from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { shareNotesExport } from '../export/exportNotes'

export default function SettingsScreen() {
  const notes = useNotesStore((state) => state.notes)
  const tasks = useTasksStore((state) => state.tasks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exportAll = async () => {
    setError(null)
    setBusy(true)
    try {
      await shareNotesExport(notes, tasks)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Ustawienia' }} />

      <View style={styles.section}>
        <Text style={styles.heading}>Twoje dane</Text>
        <Text style={styles.description}>
          Notatki nie są nigdzie wysyłane. Eksport zapisuje je do pliku JSON, który możesz
          przenieść, gdzie chcesz — bez nagrań audio, które zostają na urządzeniu.
        </Text>
        <Button
          title={`Eksportuj notatki (${notes.length})`}
          onPress={exportAll}
          disabled={busy || notes.length === 0}
        />
        {notes.length === 0 && <Text style={styles.hint}>Brak notatek do wyeksportowania.</Text>}
        {busy && <ActivityIndicator />}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 24 },
  section: { gap: 10 },
  heading: { fontSize: 17, fontWeight: '700', color: '#111827' },
  description: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  hint: { fontSize: 13, color: '#6B7280', fontStyle: 'italic' },
  error: { color: '#B91C1C', fontSize: 14 },
})
