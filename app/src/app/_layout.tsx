import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { useSettingsStore } from '../state/settingsStore'
import { startModelMemoryGuard } from '../ai/modelMemory'

export default function RootLayout() {
  const load = useNotesStore((state) => state.load)
  const loadTasks = useTasksStore((state) => state.load)
  const loadSettings = useSettingsStore((state) => state.load)

  useEffect(() => {
    load()
    loadTasks()
    loadSettings()
  }, [load, loadTasks, loadSettings])

  useEffect(startModelMemoryGuard, [])

  return (
    <SafeAreaProvider>
      <Stack />
    </SafeAreaProvider>
  )
}
