import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useDraftStore } from '../state/draftStore'
import { useNotesStore } from '../state/notesStore'

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const defaultTitle = (startedAt: number): string => `Odzyskane nagranie ${formatTime(startedAt)}`

// A recording that the system interrupted leaves its transcript here. Recovery
// is offered rather than performed: the user decides whether an interrupted
// recording is worth keeping, and until they do it stays out of the note list.
export function DraftBanner() {
  const draft = useDraftStore((state) => state.draft)
  const clear = useDraftStore((state) => state.clear)
  const add = useNotesStore((state) => state.add)
  const [busy, setBusy] = useState(false)

  if (!draft) return null

  const keep = async () => {
    setBusy(true)
    try {
      await add({
        title: defaultTitle(draft.startedAt),
        content: draft.transcript,
        summary: null,
        tags: [],
        audioUri: null,
        durationMs: null,
      })
      await clear()
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    setBusy(true)
    try {
      await clear()
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Przerwane nagranie z {formatTime(draft.startedAt)}</Text>
      <Text style={styles.preview} numberOfLines={2}>
        {draft.transcript}
      </Text>
      <Text style={styles.note}>Odzyskano sam transkrypt — nagranie audio nie zostało zapisane.</Text>
      <View style={styles.actions}>
        <Pressable onPress={keep} disabled={busy} hitSlop={6}>
          <Text style={styles.keep}>Zapisz jako notatkę</Text>
        </Pressable>
        <Pressable onPress={discard} disabled={busy} hitSlop={6}>
          <Text style={styles.discard}>Odrzuć</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    marginBottom: 0,
    padding: 12,
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  title: { fontSize: 15, fontWeight: '700', color: '#92400E' },
  preview: { fontSize: 14, color: '#78350F' },
  note: { fontSize: 12, color: '#92400E', fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 20, marginTop: 4 },
  keep: { fontSize: 15, fontWeight: '600', color: '#1F4E79' },
  discard: { fontSize: 15, fontWeight: '600', color: '#B91C1C' },
})
