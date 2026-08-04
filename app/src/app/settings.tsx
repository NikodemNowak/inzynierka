import { useState } from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { useModelStore } from '../state/modelStore'
import { shareNotesExport } from '../export/exportNotes'
import { MODEL_CONFIG } from '../ai/modelConfig'

const formatGb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(2)} GB`

const approxGb = (megabytes: number): string => `${(megabytes / 1024).toFixed(1)} GB`

function ModelSection() {
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const sizeBytes = useModelStore((state) => state.sizeBytes)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const remove = useModelStore((state) => state.remove)

  const confirmRemove = () => {
    Alert.alert(
      'Usunąć model?',
      'Zwolni to miejsce na urządzeniu. Funkcje AI przestaną działać, dopóki nie pobierzesz modelu ponownie. Notatki zostaną nienaruszone.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => void remove() },
      ],
    )
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Model językowy</Text>
      <Text style={styles.description}>
        {MODEL_CONFIG.displayName} — odpowiada za tytuły, streszczenia, kategorie i zadania.
        Pobranie go to jedyny moment, w którym aplikacja łączy się z siecią.
      </Text>

      {status === 'checking' && <Text style={styles.value}>Sprawdzanie…</Text>}

      {status === 'absent' && (
        <>
          <Text style={styles.value}>Nie pobrany</Text>
          <Button
            title={`Pobierz model (~${approxGb(MODEL_CONFIG.approxSizeMb)})`}
            onPress={() => void download()}
          />
        </>
      )}

      {status === 'downloading' && (
        <>
          <Text style={styles.value}>Pobieranie: {progress.toFixed(0)}%</Text>
          <ActivityIndicator />
        </>
      )}

      {status === 'ready' && (
        <>
          <Text style={styles.value}>Pobrany — {formatGb(sizeBytes)} na urządzeniu</Text>
          <Button title="Usuń model" color="#B91C1C" onPress={confirmRemove} />
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

function PrivacySection() {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Prywatność</Text>
      <Text style={styles.description}>
        Nagrania, transkrypty i notatki zostają w pamięci tego urządzenia. Aplikacja nie ma konta,
        nie synchronizuje się z chmurą i nie wysyła żadnych danych o użytkowaniu.
      </Text>
      <Text style={styles.listItem}>
        • Rozpoznawanie mowy wykonuje silnik wbudowany w system — nie wymaga pobierania ani sieci.
      </Text>
      <Text style={styles.listItem}>
        • Streszczenia tworzy model uruchamiany lokalnie, na procesorze tego telefonu.
      </Text>
      <Text style={styles.listItem}>
        • Jedyne połączenie sieciowe to jednorazowe pobranie modelu, na Twoje wyraźne żądanie.
      </Text>
      <Text style={styles.description}>
        Po pobraniu modelu możesz wyłączyć internet — wszystkie funkcje działają dalej.
      </Text>
    </View>
  )
}

function DataSection() {
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
    <View style={styles.section}>
      <Text style={styles.heading}>Twoje dane</Text>
      <Text style={styles.description}>
        Eksport zapisuje notatki do pliku JSON, który możesz przenieść, gdzie chcesz — bez nagrań
        audio, które zostają na urządzeniu.
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
  )
}

export default function SettingsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Ustawienia' }} />
      <ModelSection />
      <PrivacySection />
      <DataSection />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 28 },
  section: { gap: 10 },
  heading: { fontSize: 17, fontWeight: '700', color: '#111827' },
  description: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  listItem: { fontSize: 14, color: '#4B5563', lineHeight: 20, paddingLeft: 4 },
  value: { fontSize: 15, color: '#1F4E79', fontWeight: '600' },
  hint: { fontSize: 13, color: '#6B7280', fontStyle: 'italic' },
  error: { color: '#B91C1C', fontSize: 14 },
})
