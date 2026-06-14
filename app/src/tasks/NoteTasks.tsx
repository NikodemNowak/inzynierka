import { useState } from 'react'
import { ActivityIndicator, Button, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTasksStore } from '../state/tasksStore'
import { enqueueLlm } from '../ai/llmQueue'
import { extractTasks } from '../ai/taskExtraction'

export function NoteTasks({ noteId, content }: { noteId: string; content: string }) {
  const allTasks = useTasksStore((s) => s.tasks)
  const addForNote = useTasksStore((s) => s.addForNote)
  const toggle = useTasksStore((s) => s.toggle)
  const remove = useTasksStore((s) => s.remove)
  const tasks = allTasks.filter((t) => t.noteId === noteId)

  const [proposals, setProposals] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = status !== null

  const propose = async () => {
    if (content.trim().length === 0) {
      setError('Notatka jest pusta')
      return
    }
    setError(null)
    setProposals([])
    setStatus('Przygotowanie…')
    try {
      const found = await enqueueLlm(() => extractTasks(content.trim(), setStatus))
      // Skip proposals already present among this note's tasks.
      const existing = new Set(tasks.map((t) => t.text.toLowerCase()))
      const fresh = found.filter((t) => !existing.has(t.toLowerCase()))
      setProposals(fresh)
      if (fresh.length === 0) setError('Model nie znalazł nowych zadań w tej notatce')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus(null)
    }
  }

  const addProposal = async (text: string) => {
    await addForNote(noteId, [text])
    setProposals((prev) => prev.filter((p) => p !== text))
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Zadania</Text>

      {tasks.map((task) => (
        <View key={task.id} style={styles.row}>
          <Pressable onPress={() => toggle(task.id)} hitSlop={8}>
            <View style={[styles.checkbox, task.done && styles.checkboxDone]} />
          </Pressable>
          <Text style={[styles.taskText, task.done && styles.taskDone]}>{task.text}</Text>
          <Pressable onPress={() => remove(task.id)} hitSlop={8}>
            <Text style={styles.removeX}>✕</Text>
          </Pressable>
        </View>
      ))}
      {tasks.length === 0 && proposals.length === 0 && !busy && (
        <Text style={styles.empty}>Brak zadań — zaproponuj je na podstawie treści.</Text>
      )}

      {proposals.length > 0 && (
        <View style={styles.proposals}>
          <Text style={styles.proposalsTitle}>Propozycje (dotknij, aby dodać):</Text>
          {proposals.map((text) => (
            <Pressable key={text} style={styles.proposalRow} onPress={() => addProposal(text)}>
              <Text style={styles.proposalPlus}>＋</Text>
              <Text style={styles.proposalText}>{text}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {status && <Text style={styles.status}>{status}</Text>}
      {busy && <ActivityIndicator />}

      <Button title="Zaproponuj zadania" onPress={propose} disabled={busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 4 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#1F4E79',
  },
  checkboxDone: { backgroundColor: '#1F4E79' },
  taskText: { flex: 1, fontSize: 15, color: '#111827' },
  taskDone: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  removeX: { fontSize: 16, color: '#B91C1C', paddingHorizontal: 4 },
  empty: { fontSize: 14, color: '#6B7280', fontStyle: 'italic' },
  proposals: { gap: 6, paddingVertical: 4 },
  proposalsTitle: { fontSize: 13, color: '#6B7280' },
  proposalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 10,
  },
  proposalPlus: { fontSize: 18, color: '#1F4E79', fontWeight: '700' },
  proposalText: { flex: 1, fontSize: 15, color: '#1F2937' },
  error: { color: '#B91C1C', fontSize: 14 },
  status: { color: '#1F4E79', fontSize: 14 },
})
