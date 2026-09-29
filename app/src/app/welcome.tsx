import { Stack, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { MODEL_CONFIG } from '../ai/modelConfig'

const POINTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Nagraj i zobacz tekst na żywo',
    body: 'Mowa jest przetwarzana na urządzeniu, gdy systemowy model języka jest dostępny.',
  },
  {
    title: 'Dodaj podsumowanie na telefonie',
    body: 'Lokalny model AI tworzy tytuły, streszczenia, kategorie i zadania. Możesz pobrać go teraz lub później.',
  },
]

export default function WelcomeScreen() {
  const router = useRouter()
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding)

  const finish = async () => {
    await completeOnboarding()
    router.replace('/')
  }

  // Downloading gigabytes should not hold the user hostage on this screen: the
  // model store keeps the transfer running, so they can start taking notes and
  // watch the progress in settings.
  const downloading = status === 'downloading'

  const startDownload = () => {
    void download()
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Witaj', headerBackVisible: false }} />

      <Text style={styles.heading} accessibilityRole="header">
        Notatki głosowe, które zostają u Ciebie
      </Text>

      {POINTS.map((point) => (
        <View key={point.title} style={styles.point}>
          <Text style={styles.pointTitle}>{point.title}</Text>
          <Text style={styles.pointBody}>{point.body}</Text>
        </View>
      ))}

      <View style={styles.modelSection}>
        <Text style={styles.modelTitle}>Model do podsumowań</Text>
        <Text style={styles.modelDetail}>
          {MODEL_CONFIG.displayName} · około {Math.round(MODEL_CONFIG.approxSizeMb / 10) / 100} GB.
          Pobiera się tylko na Twoje żądanie.
        </Text>
        {status === 'ready' ? (
          <Text style={styles.ready}>Model jest pobrany i gotowy do pracy offline.</Text>
        ) : (
          <Button
            label={
              downloading
                ? `Pobieram… ${progress.toFixed(0)}%`
                : 'Pobierz model'
            }
            variant="primary"
            onPress={startDownload}
            disabled={downloading || status === 'checking'}
            busy={downloading}
          />
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        label={
          status === 'ready'
            ? 'Przejdź do notatek'
            : downloading
              ? 'Przejdź do notatek · pobieranie trwa'
              : 'Zacznij bez pobierania'
        }
        variant={status === 'ready' ? 'primary' : 'secondary'}
        onPress={finish}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, gap: spacing.xl, backgroundColor: colors.paper },
  heading: { ...type.display, color: colors.ink },
  point: { gap: spacing.xs },
  pointTitle: { ...type.label, color: colors.navy, fontSize: 14 },
  pointBody: { ...type.body, color: colors.body },
  modelSection: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  modelTitle: { ...type.title, color: colors.ink },
  modelDetail: { ...type.body, color: colors.body },
  ready: { ...type.body, color: colors.success, fontWeight: '600' },
  error: { ...type.body, color: colors.danger },
})
