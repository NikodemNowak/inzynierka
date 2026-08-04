import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { startModelMemoryGuard } from '../ai/modelMemory'

export default function RootLayout() {
  const load = useNotesStore((state) => state.load)
  const loadTasks = useTasksStore((state) => state.load)

  useEffect(() => {
    load()
    loadTasks()
  }, [load, loadTasks])

  useEffect(startModelMemoryGuard, [])

  return (
    <SafeAreaProvider>
      <Stack />
    </SafeAreaProvider>
  )
}
