import { useState } from 'react'
import { Stack } from 'expo-router'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'
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
      <Text style={styles.heading} accessibilityRole="header">
        Model AI
      </Text>
      <Text style={styles.description}>
        Tworzy tytuły, streszczenia, kategorie i zadania bez wysyłania treści notatek.
      </Text>

      <View style={styles.statusPanel}>
        <Text style={styles.value}>
          {status === 'checking' && 'Sprawdzanie modelu…'}
          {status === 'absent' && 'Model nie jest pobrany'}
          {status === 'downloading' && `Pobieranie · ${progress.toFixed(0)}%`}
          {status === 'ready' && 'Gotowy do pracy offline'}
        </Text>
        <Text style={styles.detail}>
          {MODEL_CONFIG.displayName}
          {status === 'ready'
            ? ` · ${formatGb(sizeBytes)} na urządzeniu`
            : ` · około ${approxGb(MODEL_CONFIG.approxSizeMb)}`}
        </Text>
        {status === 'downloading' && (
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Pobieranie modelu"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
          >
            <View
              style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, progress))}%` }]}
            />
          </View>
        )}
      </View>

      {status === 'absent' && (
        <Button
          label={`Pobierz model · ${approxGb(MODEL_CONFIG.approxSizeMb)}`}
          variant="primary"
          onPress={() => void download()}
        />
      )}

      {status === 'ready' && (
        <Button
          label="Usuń pobrany model"
          variant="danger"
          onPress={confirmRemove}
          style={styles.removeButton}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

function PrivacySection() {
  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Prywatność
      </Text>
      <Text style={styles.description}>
        Nagrania i notatki są zapisane tylko na tym urządzeniu. Aplikacja nie wymaga konta ani nie
        synchronizuje danych.
      </Text>
      <View style={styles.privacyRow}>
        <Text style={styles.privacyLabel}>Transkrypcja</Text>
        <Text style={styles.privacyDetail}>Lokalnie, gdy systemowy model języka jest dostępny.</Text>
      </View>
      <View style={styles.privacyRow}>
        <Text style={styles.privacyLabel}>Podsumowania</Text>
        <Text style={styles.privacyDetail}>Model uruchamia się na tym telefonie.</Text>
      </View>
      <View style={styles.privacyRow}>
        <Text style={styles.privacyLabel}>Internet</Text>
        <Text style={styles.privacyDetail}>Model AI pobiera się tylko po Twojej decyzji.</Text>
      </View>
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
    <View style={styles.lastSection}>
      <Text style={styles.heading} accessibilityRole="header">
        Twoje dane
      </Text>
      <Text style={styles.description}>
        Wyeksportuj notatki do pliku JSON. Nagrania audio pozostają na urządzeniu.
      </Text>
      <Button
        label={`Eksportuj notatki (${notes.length})`}
        onPress={exportAll}
        disabled={busy || notes.length === 0}
        busy={busy}
      />
      {notes.length === 0 && <Text style={styles.hint}>Brak notatek do wyeksportowania.</Text>}
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
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.paper,
  },
  section: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    marginBottom: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lastSection: { gap: spacing.md },
  heading: { ...type.title, color: colors.ink },
  description: { ...type.body, color: colors.body },
  statusPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  value: { ...type.body, color: colors.ink, fontWeight: '600' },
  detail: { ...type.label, color: colors.muted, fontWeight: '400' },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: { height: '100%', backgroundColor: colors.navy },
  removeButton: { alignSelf: 'flex-start' },
  privacyRow: { flexDirection: 'row', gap: spacing.md },
  privacyDetail: { ...type.body, color: colors.body, flex: 1 },
  privacyLabel: { ...type.label, color: colors.ink, width: 110, paddingTop: 2 },
  hint: { ...type.meta, color: colors.muted },
  error: { ...type.body, color: colors.danger },
})
