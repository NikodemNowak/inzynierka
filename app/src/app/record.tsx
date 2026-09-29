import { useCallback, useEffect, useRef, useState } from 'react'
import { Stack, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import {
  Animated,
  ActivityIndicator,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useDraftStore } from '../state/draftStore'
import {
  useSpeechRecorder,
  type RecordingResult,
} from '../stt/useSpeechRecorder'
import { LiveTranscript } from '../stt/LiveTranscript'
import { waveformScaleForVolume } from '../stt/microphoneMeter'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useReducedMotion } from '../ui/Motion'
import { spacing, type, useTheme } from '../ui/theme'

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const twoDigits = (value: number) => value.toString().padStart(2, '0')
  return hours > 0
    ? `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(Math.floor(totalSeconds / 60))}:${twoDigits(seconds)}`
}

const defaultTitle = (prefix = 'Nagranie'): string =>
  `${prefix} ${new Date().toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`

const statusLabel = (
  status: string,
  requesting: boolean,
  saving: boolean,
): string => {
  if (saving) return 'Zapisuję notatkę'
  if (requesting || status === 'starting') return 'Przygotowuję mikrofon'
  if (status === 'recording') return 'Nagrywanie'
  if (status === 'stopping') return 'Zapisuję nagranie'
  return 'Gotowe do nagrania'
}

const WAVEFORM_HEIGHTS = [
  2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 7, 12, 7, 4, 3, 2, 5, 9, 16, 26, 36, 26, 16, 9,
  5, 2, 3, 4, 7, 12, 7, 4, 3, 2, 2, 2, 2, 2, 2,
]

function RecordingWaveform({
  status,
  volumeLevel,
}: {
  status: 'idle' | 'starting' | 'recording' | 'stopping'
  volumeLevel: number
}) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const amplitude = useRef(
    new Animated.Value(waveformScaleForVolume(volumeLevel)),
  ).current
  const color = status === 'recording' ? colors.accent : colors.faint

  useEffect(() => {
    const target = waveformScaleForVolume(
      status === 'recording' ? volumeLevel : 0,
    )
    if (reducedMotion) {
      amplitude.setValue(target)
      return
    }
    const animation = Animated.timing(amplitude, {
      toValue: target,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [amplitude, reducedMotion, status, volumeLevel])

  return (
    <View
      style={styles.waveform}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {WAVEFORM_HEIGHTS.map((height, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveformBar,
            { height, backgroundColor: color },
            { transform: [{ scaleY: amplitude }] },
          ]}
        />
      ))}
    </View>
  )
}

export default function RecordNoteScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { colors } = useTheme()
  const add = useNotesStore((state) => state.add)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const draft = useDraftStore((state) => state.draft)
  const loadDraft = useDraftStore((state) => state.load)
  const saveDraft = useDraftStore((state) => state.save)
  const clearDraft = useDraftStore((state) => state.clear)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const startedAtRef = useRef(0)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const pendingResultRef = useRef<RecordingResult | null>(null)
  const pendingNavigationRef = useRef<(() => void) | null>(null)
  const allowExitRef = useRef(false)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    let mounted = true
    void loadDraft()
      .then(() => {
        if (mounted) setDraftReady(true)
      })
      .catch((e: unknown) => {
        if (mounted) setSaveError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      mounted = false
    }
  }, [loadDraft])

  const persistRecording = useCallback(
    async (result: RecordingResult) => {
      const transcript = result.transcript.trim()
      if (transcript.length === 0 && !result.audioUri) {
        pendingResultRef.current = null
        setSaveError(
          'Nie rozpoznano mowy. Zachowany szkic nadal jest dostępny.',
        )
        setSaving(false)
        return
      }

      setSaving(true)
      setSaveError(null)
      try {
        const note = await add({
          title: defaultTitle(),
          content: transcript,
          summary: null,
          tags: [],
          audioUri: result.audioUri,
          durationMs: result.durationMs,
        })
        pendingResultRef.current = null
        // The recording made it into a note, so the recovery draft is obsolete.
        await clearDraft()
        // Generate title + summary in the background; the store keeps running it
        // after we navigate away, and the note/list update when it lands.
        if (transcript.length > 0) void processWithLlm(note.id)
        allowExitRef.current = true
        router.replace(`/note/${note.id}`)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, clearDraft, processWithLlm, router],
  )

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      pendingResultRef.current = result
      await persistRecording(result)
    },
    [persistRecording],
  )

  const recorder = useSpeechRecorder(handleComplete)
  const { finalTranscript, status, volumeLevel } = recorder

  // Persist only finalized speech, not the recognizer's frequently revised tail.
  useEffect(() => {
    if (status !== 'recording' || finalTranscript.length === 0) return
    if (startedAtRef.current === 0) startedAtRef.current = Date.now()
    void saveDraft(finalTranscript, startedAtRef.current)
  }, [finalTranscript, status, saveDraft])

  const onStart = useCallback(async () => {
    setSaveError(null)
    allowExitRef.current = false
    startedAtRef.current = Date.now()
    setRequesting(true)
    const startPromise = recorder.start()
    startPromiseRef.current = startPromise
    try {
      await startPromise
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setRequesting(false)
      startPromiseRef.current = null
    }
  }, [recorder.start])

  const saveRecoveredDraft = useCallback(
    async (recordAgain: boolean) => {
      const transcript = draft?.transcript.trim() ?? ''
      if (transcript.length === 0) return
      setSaving(true)
      setSaveError(null)
      try {
        const note = await add({
          title: defaultTitle('Odzyskana notatka'),
          content: transcript,
          summary: null,
          tags: [],
          audioUri: null,
          durationMs: null,
        })
        await clearDraft()
        if (transcript.length > 0) void processWithLlm(note.id)
        if (recordAgain) {
          setSaving(false)
          await onStart()
          return
        }
        allowExitRef.current = true
        router.replace(`/note/${note.id}`)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, clearDraft, draft, onStart, processWithLlm, router],
  )

  const stopAndSave = useCallback(() => {
    pendingNavigationRef.current = null
    setShowExitPrompt(false)
    if ((requesting || status === 'starting') && startPromiseRef.current) {
      void startPromiseRef.current.then(
        () => recorder.stop(),
        () => undefined,
      )
      return
    }
    recorder.stop()
  }, [recorder, requesting, status])

  const live = status === 'recording'
  const starting = requesting || status === 'starting'
  const busy = status === 'stopping' || saving
  const showingProgress = starting || status === 'stopping' || saving
  const protectNavigation =
    starting ||
    live ||
    status === 'stopping' ||
    saving ||
    pendingResultRef.current !== null
  const error = saveError ?? recorder.error
  const failedSave = pendingResultRef.current !== null && !saving
  const showingRecoveredDraft =
    draftReady &&
    status === 'idle' &&
    recorder.transcript.length === 0 &&
    Boolean(draft?.transcript.trim())
  const transcript =
    recorder.transcript ||
    (showingRecoveredDraft ? (draft?.transcript ?? '') : '')

  usePreventRemove(protectNavigation, ({ data }) => {
    if (allowExitRef.current) {
      navigation.dispatch(data.action)
      return
    }
    pendingNavigationRef.current = () => navigation.dispatch(data.action)
    setShowExitPrompt(true)
  })

  const retrySave = () => {
    if (pendingResultRef.current)
      void persistRecording(pendingResultRef.current)
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen options={{ title: 'Nagrywanie' }} />

      <View style={styles.counterBlock}>
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          {live && (
            <View style={[styles.liveDot, { backgroundColor: colors.ember }]} />
          )}
          {showingProgress && (
            <ActivityIndicator size="small" color={colors.accent} />
          )}
          <Text
            style={[
              styles.status,
              {
                color: live
                  ? colors.ember
                  : showingProgress
                    ? colors.accent
                    : colors.muted,
              },
            ]}
          >
            {statusLabel(status, requesting, saving)}
          </Text>
        </View>
        <Text
          style={[styles.counter, { color: colors.ink }]}
          accessibilityLabel={`Czas nagrania ${formatDuration(recorder.durationMs)}`}
        >
          {formatDuration(recorder.durationMs)}
        </Text>
        <RecordingWaveform status={status} volumeLevel={volumeLevel} />
      </View>

      <View style={[styles.transcriptDivider, { borderColor: colors.line }]} />

      <ScrollView
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <View
            style={[styles.errorNotice, { backgroundColor: colors.emberSoft }]}
            accessibilityRole="alert"
          >
            <Icon name="alert" size={21} color={colors.ember} />
            <Text style={[styles.error, { color: colors.ink }]}>{error}</Text>
          </View>
        )}
        {recorder.info && (
          <Text style={[styles.info, { color: colors.muted }]}>
            {recorder.info}
          </Text>
        )}

        {transcript.length > 0 ? (
          <LiveTranscript
            text={transcript}
            finalizedText={showingRecoveredDraft ? transcript : finalTranscript}
            animate={!showingRecoveredDraft}
            style={[styles.transcript, { color: colors.ink }]}
            interimStyle={{ color: colors.body }}
          />
        ) : (
          <View style={styles.emptyTranscript}>
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>
              {live ? 'Mów naturalnie' : 'Twoje słowa, zapisane.'}
            </Text>
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              {live
                ? 'Rozpoznany tekst pojawi się tutaj.'
                : 'Naciśnij przycisk i zacznij mówić. Tekst pojawi się tutaj.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: colors.canvas,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          },
        ]}
      >
        {!draftReady ? (
          <Button
            label="Sprawdzam zachowany szkic…"
            variant="primary"
            disabled
            busy
            onPress={() => undefined}
          />
        ) : showingRecoveredDraft ? (
          <>
            <Button
              label="Zapisz tekst jako notatkę"
              variant="primary"
              icon="check"
              onPress={() => void saveRecoveredDraft(false)}
              disabled={saving}
              busy={saving}
            />
            <Button
              label="Zapisz tekst i nagraj ponownie"
              variant="quiet"
              icon="mic"
              onPress={() => void saveRecoveredDraft(true)}
              disabled={saving}
            />
          </>
        ) : pendingResultRef.current && !saving ? (
          <Button
            label="Ponów zapis notatki"
            variant="primary"
            icon="refresh"
            onPress={retrySave}
          />
        ) : (
          <Button
            label={
              saving
                ? 'Zapisuję notatkę…'
                : live
                  ? 'Zatrzymaj i zapisz'
                  : starting
                    ? 'Przygotowuję mikrofon…'
                    : status === 'stopping'
                      ? 'Zapisuję nagranie…'
                      : 'Rozpocznij nagrywanie'
            }
            variant="primary"
            icon={live ? 'stop' : 'mic'}
            onPress={live ? recorder.stop : () => void onStart()}
            disabled={!draftReady || busy || starting}
            busy={!draftReady || saving || starting || status === 'stopping'}
          />
        )}
      </View>

      <BottomSheet
        visible={showExitPrompt}
        onClose={() => {
          pendingNavigationRef.current = null
          setShowExitPrompt(false)
        }}
        title={
          failedSave
            ? 'Notatka nie została zapisana'
            : status === 'stopping' || saving
              ? 'Zapisuję nagranie'
              : 'Nagranie trwa'
        }
      >
        <Text style={[styles.sheetCopy, { color: colors.body }]}>
          {failedSave
            ? 'Tekst nagrania został zachowany. Spróbuj ponownie zapisać notatkę albo zostań na ekranie.'
            : status === 'stopping' || saving
              ? 'Poczekaj na zapis notatki. Po zakończeniu możesz bezpiecznie wrócić.'
              : 'Możesz zatrzymać nagranie i zapisać rozpoznany tekst albo wrócić do nagrywania.'}
        </Text>
        {failedSave ? (
          <Button
            label="Ponów zapis notatki"
            variant="primary"
            icon="refresh"
            onPress={retrySave}
          />
        ) : status !== 'stopping' && !saving ? (
          <Button
            label="Zatrzymaj i zapisz"
            variant="primary"
            icon="stop"
            onPress={stopAndSave}
          />
        ) : null}
        <Button
          label={
            failedSave || status === 'stopping' || saving
              ? 'Zostań na ekranie'
              : 'Kontynuuj nagrywanie'
          }
          variant="quiet"
          onPress={() => {
            pendingNavigationRef.current = null
            setShowExitPrompt(false)
          }}
        />
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  counterBlock: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 18,
    gap: 3,
  },
  statusRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  status: { ...type.label, fontWeight: '500' },
  counter: { ...type.counter, fontVariant: ['tabular-nums'] },
  waveform: {
    width: '82%',
    height: 52,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  waveformBar: { width: 3, borderRadius: 999 },
  transcriptDivider: {
    marginHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  transcriptArea: { flex: 1 },
  transcriptContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 22,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  transcript: { fontSize: 19, lineHeight: 30, letterSpacing: -0.15 },
  emptyTranscript: { gap: spacing.sm, paddingTop: 8 },
  emptyTitle: { ...type.title, fontSize: 21, lineHeight: 28 },
  placeholder: { ...type.body, lineHeight: 25 },
  info: { ...type.meta, textAlign: 'center' },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
  },
  error: { ...type.body, flex: 1, fontSize: 14, lineHeight: 21 },
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  sheetCopy: { ...type.body },
})
