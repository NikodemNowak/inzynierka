import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useIsFocused } from 'expo-router/react-navigation'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme } from '../ui/theme'
import { useTasksStore } from '../state/tasksStore'
import { useNotesStore } from '../state/notesStore'
import { useModelStore } from '../state/modelStore'
import { enqueueLlm } from '../ai/llmQueue'
import { extractTasks } from '../ai/taskExtraction'
import { MODEL_MISSING_MESSAGE } from '../ai/noteProcessing'

export function NoteTasks({
  noteId,
  content,
  onBusyChange,
}: {
  noteId: string
  content: string
  onBusyChange?: (busy: boolean) => void
}) {
  const { colors } = useTheme()
  const allTasks = useTasksStore((state) => state.tasks)
  const tasks = useMemo(
    () => allTasks.filter((task) => task.noteId === noteId),
    [allTasks, noteId],
  )
  const addForNote = useTasksStore((state) => state.addForNote)
  const toggle = useTasksStore((state) => state.toggle)
  const remove = useTasksStore((state) => state.remove)
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === noteId),
  )
  const noteProcessing = useNotesStore((state) =>
    Boolean(state.processing[noteId]),
  )
  const modelReady = useModelStore((state) => state.status === 'ready')
  const isFocused = useIsFocused()
  const isFocusedRef = useRef(isFocused)
  isFocusedRef.current = isFocused

  const [proposals, setProposals] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [sourceContent, setSourceContent] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetVisible, setSheetVisible] = useState(false)
  const busy = status !== null

  useEffect(() => {
    if (!isFocused) setSheetVisible(false)
  }, [isFocused])

  useEffect(() => {
    onBusyChange?.(busy)
    return () => {
      if (busy) onBusyChange?.(false)
    }
  }, [busy, onBusyChange])

  const propose = async () => {
    if (proposals.length > 0) {
      setSheetVisible(true)
      return
    }
    if (!note) {
      setError('Ta notatka już nie istnieje.')
      return
    }
    if (useNotesStore.getState().processing[noteId]) {
      setError('Poczekaj na zakończenie opracowywania notatki.')
      return
    }
    if (content.trim().length === 0) {
      setError('Notatka jest pusta')
      return
    }
    setError(null)
    setStatus('Przygotowuję propozycje…')
    try {
      const snapshot = content
      const found = await enqueueLlm(() =>
        extractTasks(snapshot.trim(), setStatus),
      )
      const currentNote = useNotesStore
        .getState()
        .notes.find((item) => item.id === noteId)
      if (!currentNote || currentNote.content !== snapshot) {
        setError(
          'Treść notatki zmieniła się podczas analizy. Spróbuj ponownie.',
        )
        return
      }
      const existing = new Set(
        useTasksStore
          .getState()
          .tasks.filter((task) => task.noteId === noteId)
          .map((task) => task.text.trim().toLocaleLowerCase()),
      )
      const seen = new Set<string>()
      const fresh = found.filter((text) => {
        const key = text.trim().toLocaleLowerCase()
        if (!key || existing.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      setSourceContent(snapshot)
      setProposals(fresh)
      setSelected(new Set(fresh))
      if (fresh.length === 0) {
        setError('Model nie znalazł nowych zadań w tej notatce')
      } else if (isFocusedRef.current) {
        setSheetVisible(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStatus(null)
    }
  }

  const toggleProposal = (text: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(text)) next.delete(text)
      else next.add(text)
      return next
    })
  }

  const addSelected = async () => {
    const currentNote = useNotesStore
      .getState()
      .notes.find((item) => item.id === noteId)
    if (!currentNote) {
      setError('Ta notatka już nie istnieje.')
      setSheetVisible(false)
      return
    }
    if (useNotesStore.getState().processing[noteId]) {
      setError('Poczekaj na zakończenie opracowywania notatki.')
      return
    }
    if (sourceContent === null || currentNote.content !== sourceContent) {
      setError('Treść notatki zmieniła się. Wygeneruj propozycje ponownie.')
      setSheetVisible(false)
      setProposals([])
      setSelected(new Set())
      return
    }
    const chosen = proposals.filter((text) => selected.has(text))
    if (chosen.length === 0) return
    try {
      await addForNote(noteId, chosen)
      setError(null)
      if (isFocusedRef.current) setSheetVisible(false)
      setProposals([])
      setSelected(new Set())
      setSourceContent(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const cancelProposals = () => {
    setSheetVisible(false)
    setProposals([])
    setSelected(new Set())
    setSourceContent(null)
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.ink }]}>Zadania</Text>

      {tasks.map((task) => (
        <View key={task.id} style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={task.text}
            accessibilityState={{ checked: task.done }}
            onPress={() => {
              void toggle(task.id).catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
            }}
            style={styles.checkPressable}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: task.done ? colors.accent : colors.faint,
                  backgroundColor: task.done ? colors.accent : 'transparent',
                },
              ]}
            >
              {task.done && (
                <Icon name="check" size={15} color={colors.onAccent} />
              )}
            </View>
          </Pressable>
          <Text
            style={[
              styles.taskText,
              { color: task.done ? colors.muted : colors.ink },
              task.done && styles.taskDone,
            ]}
          >
            {task.text}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Usuń zadanie: ${task.text}`}
            onPress={() => {
              void remove(task.id).catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
            }}
            hitSlop={8}
          >
            <Icon name="close" size={18} color={colors.faint} />
          </Pressable>
        </View>
      ))}
      {tasks.length === 0 &&
        proposals.length === 0 &&
        !busy &&
        !noteProcessing && (
          <Text style={[styles.empty, { color: colors.muted }]}>
            {!content.trim()
              ? 'Propozycje zadań wymagają treści lub transkrypcji.'
              : modelReady
                ? 'Nie ma jeszcze zadań. Możesz zaproponować je na podstawie notatki.'
                : `Nie ma jeszcze zadań. ${MODEL_MISSING_MESSAGE}`}
          </Text>
        )}

      {error && (
        <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
      )}
      {(status || noteProcessing) && (
        <Text style={[styles.status, { color: colors.muted }]}>
          {status ?? 'Poczekaj na zakończenie opracowywania notatki.'}
        </Text>
      )}

      <Button
        label={
          busy
            ? 'Przygotowuję propozycje…'
            : proposals.length > 0
              ? 'Wybierz propozycje'
              : 'Zaproponuj zadania'
        }
        icon="sparkles"
        onPress={() => void propose()}
        disabled={busy || noteProcessing || !modelReady || !content.trim()}
        busy={busy}
      />

      <BottomSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        title="Propozycje z notatki"
      >
        <Text style={[styles.sheetDescription, { color: colors.muted }]}>
          Zaznacz zadania, które chcesz dodać.
        </Text>
        {proposals.map((text) => {
          const checked = selected.has(text)
          return (
            <Pressable
              key={text}
              onPress={() => toggleProposal(text)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={({ pressed }) => [
                styles.proposalRow,
                {
                  backgroundColor: checked ? colors.accentSoft : colors.canvas,
                  borderColor: checked ? colors.accentSoft : colors.line,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: checked ? colors.accent : colors.faint,
                    backgroundColor: checked ? colors.accent : 'transparent',
                  },
                ]}
              >
                {checked && (
                  <Icon name="check" size={15} color={colors.onAccent} />
                )}
              </View>
              <Text style={[styles.proposalText, { color: colors.ink }]}>
                {text}
              </Text>
            </Pressable>
          )
        })}
        <Button
          label={`Dodaj zaznaczone (${selected.size})`}
          variant="primary"
          icon="plus"
          onPress={() => void addSelected()}
          disabled={selected.size === 0}
        />
        <Button label="Anuluj" variant="secondary" onPress={cancelProposals} />
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  heading: { ...type.title },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 46,
  },
  checkPressable: {
    minWidth: 36,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskText: { ...type.body, flex: 1 },
  taskDone: { textDecorationLine: 'line-through' },
  empty: { ...type.body },
  error: { ...type.body },
  status: { ...type.meta },
  sheetDescription: { ...type.body },
  proposalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  proposalText: { ...type.body, flex: 1 },
})
