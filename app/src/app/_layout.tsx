import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'

export default function RootLayout() {
  const load = useNotesStore((state) => state.load)

  useEffect(() => {
    load()
  }, [load])

  return (
    <SafeAreaProvider>
      <Stack />
    </SafeAreaProvider>
  )
}
