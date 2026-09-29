import { useEffect } from 'react'
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
import { useTheme } from '../ui/theme'

export default function RootLayout() {
  const { colors, isDark } = useTheme()
  const load = useNotesStore((state) => state.load)
  const loadTasks = useTasksStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)
  const refreshModel = useModelStore((state) => state.refresh)
  const loadDraft = useDraftStore((state) => state.load)

  useEffect(() => {
    load()
    loadTasks()
    loadSettings()
    refreshModel()
    loadDraft()
  }, [load, loadTasks, loadSettings, refreshModel, loadDraft])

  useEffect(startModelMemoryGuard, [])

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.canvas },
          header: (props) => <AppHeader {...props} />,
        }}
      />
    </SafeAreaProvider>
  )
}
