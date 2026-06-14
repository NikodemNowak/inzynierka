import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'

export default function RootLayout() {
  const load = useNotesStore((state) => state.load)
  const loadTasks = useTasksStore((state) => state.load)

  useEffect(() => {
    load()
    loadTasks()
  }, [load, loadTasks])

  return (
    <SafeAreaProvider>
      <Stack />
    </SafeAreaProvider>
  )
}
