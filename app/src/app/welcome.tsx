import { Stack, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { colors, spacing, type } from '../ui/theme'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { MODEL_CONFIG } from '../ai/modelConfig'

const POINTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Nagrywanie i transkrypcja działają bez sieci',
    body: 'Zamianę mowy na tekst wykonuje silnik wbudowany w system telefonu. Nagranie ani transkrypt nigdy nie opuszczają urządzenia.',
  },
  {
    title: 'Streszczenia powstają na telefonie',
    body: 'Tytuły, streszczenia, kategorie i zadania tworzy model językowy uruchamiany lokalnie — nie ma tu żadnej usługi w chmurze.',
  },
  {
    title: 'Jedyne połączenie z siecią to pobranie modelu',
    body: `Model ${MODEL_CONFIG.displayName} zajmuje około ${Math.round(MODEL_CONFIG.approxSizeMb / 10) / 100} GB i pobiera się raz. Potem możesz wyłączyć internet i korzystać ze wszystkiego.`,
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

      <Text style={styles.heading}>Notatki głosowe, które zostają u Ciebie</Text>

      {POINTS.map((point) => (
        <View key={point.title} style={styles.point}>
          <Text style={styles.pointTitle}>{point.title}</Text>
          <Text style={styles.pointBody}>{point.body}</Text>
        </View>
      ))}

      {status === 'ready' ? (
        <Text style={styles.ready}>Model jest już pobrany — wszystko gotowe.</Text>
      ) : (
        <View style={styles.actions}>
          <Button
            label={
              downloading
                ? `Pobieram… ${progress.toFixed(0)}%`
                : `Pobierz model (~${Math.round(MODEL_CONFIG.approxSizeMb / 10) / 100} GB)`
            }
            variant="primary"
            onPress={startDownload}
            disabled={downloading}
            busy={downloading}
          />
          <Text style={styles.hint}>
            Możesz też zacząć bez modelu — nagrywanie, transkrypcja i notatki działają od razu, a
            streszczenia włączysz później w Ustawieniach.
          </Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        label={downloading ? 'Przejdź do notatek — pobieranie trwa w tle' : 'Przejdź do notatek'}
        variant={downloading ? 'secondary' : 'primary'}
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
  actions: { gap: spacing.md },
  hint: { ...type.meta, color: colors.muted, lineHeight: 18 },
  ready: { ...type.body, color: colors.success, fontWeight: '600' },
  error: { ...type.body, color: colors.danger },
})
