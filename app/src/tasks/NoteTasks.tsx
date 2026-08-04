import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'
import { useTasksStore } from '../state/tasksStore'
import { useModelStore } from '../state/modelStore'
import { enqueueLlm } from '../ai/llmQueue'
import { extractTasks } from '../ai/taskExtraction'
import { MODEL_MISSING_MESSAGE } from '../ai/noteProcessing'

export function NoteTasks({ noteId, content }: { noteId: string; content: string }) {
  const allTasks = useTasksStore((s) => s.tasks)
  const addForNote = useTasksStore((s) => s.addForNote)
  const toggle = useTasksStore((s) => s.toggle)
  const remove = useTasksStore((s) => s.remove)
  const modelReady = useModelStore((s) => s.status === 'ready')
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
        <Text style={styles.empty}>
          {modelReady
            ? 'Brak zadań — zaproponuj je na podstawie treści.'
            : `Brak zadań. ${MODEL_MISSING_MESSAGE}`}
        </Text>
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

      <Button
        label="Zaproponuj zadania"
        onPress={propose}
        disabled={busy || !modelReady}
        busy={busy}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  heading: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  checkboxDone: { backgroundColor: colors.navy },
  taskText: { ...type.body, flex: 1, color: colors.ink },
  taskDone: { textDecorationLine: 'line-through', color: colors.faint },
  removeX: { fontSize: 15, color: colors.faint, paddingHorizontal: spacing.xs },
  empty: { ...type.body, color: colors.muted },
  proposals: { gap: spacing.sm, paddingVertical: spacing.xs },
  proposalsTitle: { ...type.meta, color: colors.muted },
  proposalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navySoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  proposalPlus: { fontSize: 17, color: colors.navy, fontWeight: '700' },
  proposalText: { ...type.body, flex: 1, color: colors.ink },
  error: { ...type.body, color: colors.danger },
  status: { ...type.meta, color: colors.navy },
})
