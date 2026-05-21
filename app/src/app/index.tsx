import { Link, Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

export default function NotesListScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Notatki' }} />
      <Text style={styles.placeholder}>Lista notatek (wkrótce)</Text>
      <Link href="/dev/poc" style={styles.link}>
        Ekran dev: POC LLM
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
  placeholder: { fontSize: 16, color: '#666' },
  link: { fontSize: 16, color: '#1F4E79' },
})
