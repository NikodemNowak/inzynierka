import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useDraftStore } from '../state/draftStore'
import { useNotesStore } from '../state/notesStore'
import { colors, radius, spacing, type } from '../ui/theme'

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
  // Amber marks recording state elsewhere in the app; an interrupted recording
  // is exactly that state, unfinished — so the banner belongs to the same family.
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.emberSoft,
    borderWidth: 1,
    borderColor: '#F3D9B5',
  },
  title: { ...type.label, color: colors.ember, fontSize: 14 },
  preview: { ...type.body, color: colors.body },
  note: { ...type.meta, color: colors.muted },
  actions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.xs },
  keep: { ...type.label, color: colors.navy },
  discard: { ...type.label, color: colors.danger },
})
