import { Stack, useRouter } from 'expo-router'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
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
            title={
              downloading
                ? `Pobieranie… ${progress.toFixed(0)}%`
                : `Pobierz model (~${Math.round(MODEL_CONFIG.approxSizeMb / 10) / 100} GB)`
            }
            onPress={startDownload}
            disabled={downloading}
          />
          <Text style={styles.hint}>
            Możesz też zacząć bez modelu — nagrywanie, transkrypcja i notatki działają od razu, a
            streszczenia włączysz później w Ustawieniach.
          </Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        title={downloading ? 'Przejdź do notatek (pobieranie trwa w tle)' : 'Przejdź do notatek'}
        onPress={finish}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 18 },
  heading: { fontSize: 24, fontWeight: '700', color: '#111827', lineHeight: 30 },
  point: { gap: 4 },
  pointTitle: { fontSize: 16, fontWeight: '600', color: '#1F4E79' },
  pointBody: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  actions: { gap: 8, marginTop: 4 },
  hint: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  ready: { fontSize: 15, color: '#2E7D32', fontWeight: '600' },
  error: { color: '#B91C1C', fontSize: 14 },
})
