import { useEffect } from 'react'
import { Alert, AppState } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppHeader } from '../ui/AppHeader'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { useSettingsStore } from '../state/settingsStore'
import { useModelStore } from '../state/modelStore'
import { useDraftStore } from '../state/draftStore'
import { startModelMemoryGuard } from '../ai/modelMemory'
import { startTaskPrefetch } from '../tasks/taskPrefetch'
import { startSearchIndexing } from '../ask/searchModel'
import { useTheme } from '../ui/theme'
import { recoverCapturedSessions } from '../audio/captureRecovery'
import { translate } from '../i18n/translate'

export default function RootLayout() {
  const { colors, isDark } = useTheme()
  const load = useNotesStore((state) => state.load)
  const loadTasks = useTasksStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)
  const refreshModel = useModelStore((state) => state.refresh)
  const loadDraft = useDraftStore((state) => state.load)

  useEffect(() => {
    let recovering = false
    let initialized = false
    let disposed = false
    const recover = async () => {
      if (recovering || disposed) return
      recovering = true
      try {
        const result = await recoverCapturedSessions(async (capture) => {
          await useNotesStore.getState().addRecovered(
            {
              title: translate('Odzyskane nagranie', 'Recovered recording'),
              content: capture.transcript,
              summary: null,
              tags: [],
              audioUri: capture.audioUri,
              durationMs: capture.durationMs,
              language: capture.language,
              transcriptionIncomplete: capture.needsTranscription,
            },
            capture.sessionId,
          )
        })
        if (result.errors.length > 0 && !disposed)
          Alert.alert(
            translate('Odzyskiwanie nagrań', 'Recording recovery'),
            translate(
              'Nie udało się odzyskać wszystkich nagrań. Zachowane pliki pozostają na urządzeniu.',
              'Some recordings could not be recovered. The saved files remain on your device.',
            ),
          )
      } finally {
        recovering = false
      }
    }
    void Promise.all([
      load(),
      loadTasks(),
      loadSettings(),
      refreshModel(),
      loadDraft(),
    ])
      .then(async () => {
        initialized = true
        await recover()
      })
      .catch(() => {
        if (!disposed)
          Alert.alert(
            translate(
              'Nie udało się wczytać danych',
              'Data could not be loaded',
            ),
            translate(
              'Uruchom aplikację ponownie. Zapisane dane nie zostały usunięte.',
              'Restart the app. Your saved data has not been deleted.',
            ),
          )
      })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && initialized)
        void recover().catch(() => undefined)
    })
    return () => {
      disposed = true
      subscription.remove()
    }
  }, [load, loadTasks, loadSettings, refreshModel, loadDraft])

  useEffect(startModelMemoryGuard, [])
  useEffect(startTaskPrefetch, [])
  useEffect(startSearchIndexing, [])

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          header: (props) => <AppHeader {...props} />,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  )
}
