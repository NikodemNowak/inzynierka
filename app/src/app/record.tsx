import { useCallback, useEffect, useRef, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useDraftStore } from '../state/draftStore'
import { useSpeechRecorder, type RecordingResult } from '../stt/useSpeechRecorder'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const defaultTitle = (): string =>
  `Nagranie ${new Date().toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`

const statusLabel = (status: string): string => {
  if (status === 'starting') return 'Uruchamianie mikrofonu'
  if (status === 'recording') return 'Nagrywam — mów'
  if (status === 'stopping') return 'Kończę nagranie'
  return 'Gotowe do nagrywania'
}

export default function RecordNoteScreen() {
  const router = useRouter()
  const add = useNotesStore((state) => state.add)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const saveDraft = useDraftStore((state) => state.save)
  const clearDraft = useDraftStore((state) => state.clear)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const startedAtRef = useRef(0)
  const insets = useSafeAreaInsets()

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      if (result.transcript.trim().length === 0 && !result.audioUri) {
        await clearDraft()
        setSaveError('Nie rozpoznano mowy. Sprawdź mikrofon i spróbuj ponownie.')
        return
      }
      setSaving(true)
      try {
        const transcript = result.transcript.trim()
        const note = await add({
          title: defaultTitle(),
          content: transcript,
          summary: null,
          tags: [],
          audioUri: result.audioUri,
          durationMs: result.durationMs,
        })
        // The recording made it into a note, so the recovery draft is obsolete.
        await clearDraft()
        // Generate title + summary in the background; the store keeps running it
        // after we navigate away, and the note/list update when it lands.
        if (transcript.length > 0) void processWithLlm(note.id)
        router.replace(`/note/${note.id}`)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, clearDraft, processWithLlm, router],
  )

  const recorder = useSpeechRecorder(handleComplete)

  // Persist each recognized utterance. finalTranscript changes once per
  // utterance rather than on every interim word, so this is one small write per
  // sentence instead of one per keystroke-sized update.
  const { finalTranscript, status } = recorder
  useEffect(() => {
    if (status !== 'recording' || finalTranscript.length === 0) return
    void saveDraft(finalTranscript, startedAtRef.current)
  }, [finalTranscript, status, saveDraft])

  const onStart = () => {
    setSaveError(null)
    startedAtRef.current = Date.now()
    void recorder.start()
  }

  const live = recorder.status === 'recording'
  const active = live || recorder.status === 'starting'
  const busy = recorder.status === 'stopping' || saving
  const error = saveError ?? recorder.error

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Nagrywanie' }} />

      <View style={styles.counterBlock}>
        {/* Amber appears here and nowhere else in the app: it means the
            microphone is open. */}
        <Text style={[styles.counter, live && styles.counterLive]}>
          {formatDuration(recorder.durationMs)}
        </Text>
        <View style={styles.statusRow}>
          {live && <View style={styles.liveDot} />}
          <Text style={[styles.status, live && styles.statusLive]}>
            {statusLabel(recorder.status)}
          </Text>
        </View>
        {recorder.info && <Text style={styles.info}>{recorder.info}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <ScrollView
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
      >
        {recorder.transcript.length > 0 ? (
          <Text style={styles.transcript}>{recorder.transcript}</Text>
        ) : (
          <Text style={styles.placeholder}>
            Tekst pojawi się tutaj w trakcie mówienia. Nic nie opuszcza urządzenia.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: spacing.lg + insets.bottom }]}>
        <Button
          label={active ? 'Zatrzymaj i zapisz' : 'Rozpocznij nagrywanie'}
          variant="primary"
          onPress={active ? recorder.stop : onStart}
          disabled={busy}
          busy={busy}
        />
        {saving && <Text style={styles.saving}>Zapisuję notatkę…</Text>}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  counterBlock: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  counter: { ...type.counter, color: colors.faint },
  counterLive: { color: colors.ember },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ember },
  status: { ...type.body, color: colors.muted },
  statusLive: { color: colors.ember, fontWeight: '600' },
  info: { ...type.body, color: colors.navy, textAlign: 'center', paddingHorizontal: spacing.lg },
  error: { ...type.body, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.lg },
  transcriptArea: {
    flex: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  transcriptContent: { padding: spacing.lg },
  transcript: { ...type.body, fontSize: 17, lineHeight: 26, color: colors.ink },
  placeholder: { ...type.body, color: colors.faint },
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  saving: { ...type.meta, color: colors.muted, textAlign: 'center' },
})
