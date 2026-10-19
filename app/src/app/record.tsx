import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stack, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useDraftStore } from '../state/draftStore'
import { useSettingsStore } from '../state/settingsStore'
import { useI18n } from '../i18n/useI18n'
import {
  localeForLanguage,
  noteLanguageOrDefault,
  selectText,
  type Language,
} from '../i18n/language'
import { translate } from '../i18n/translate'
import { acknowledgeCapture } from '../audio/captureRecovery'
import type { RecorderStatus } from '../stt/useSpeechRecorder'
import { LanguagePicker } from '../ui/LanguagePicker'
import {
  useSpeechRecorder,
  type RecordingResult,
} from '../stt/useSpeechRecorder'
import { LiveTranscript } from '../stt/LiveTranscript'
import { PermissionSettingsButton } from '../stt/PermissionSettingsButton'
import { pushWaveformSample, waveformBarHeight } from '../stt/microphoneMeter'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { spacing, type, useTheme, fonts } from '../ui/theme'

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

const defaultTitle = (language: Language, recovered = false): string =>
  `${
    recovered
      ? selectText(language, 'Odzyskana notatka', 'Recovered note')
      : selectText(language, 'Nagranie', 'Recording')
  } ${new Date().toLocaleString(localeForLanguage(language), {
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
  if (saving) return translate('Zapisuję notatkę', 'Saving note')
  if (requesting || status === 'starting')
    return translate('Przygotowuję mikrofon', 'Preparing microphone')
  if (status === 'recording') return translate('Nagrywanie', 'Recording')
  if (status === 'interrupted')
    return translate('Mikrofon zatrzymany', 'Microphone stopped')
  if (status === 'stopping')
    return translate('Zapisuję nagranie', 'Saving recording')
  return translate('Gotowe do nagrania', 'Ready to record')
}

const WAVEFORM_BARS = 36
const WAVEFORM_TICK_MS = 70
const silentWaveform = (): number[] => Array.from({ length: WAVEFORM_BARS }, () => 0)

function RecordingWaveform({
  status,
  volumeLevel,
}: {
  status: RecorderStatus
  volumeLevel: number
}) {
  const { colors } = useTheme()
  const recording = status === 'recording'
  const level = useRef(0)
  level.current = recording ? volumeLevel : 0
  const [history, setHistory] = useState<readonly number[]>(silentWaveform)
  const color = recording ? colors.accent : colors.faint

  // Sample on a fixed clock so the trace keeps moving while the level holds.
  useEffect(() => {
    if (!recording) {
      setHistory(silentWaveform())
      return
    }
    const timer = setInterval(
      () => setHistory((current) => pushWaveformSample(current, level.current)),
      WAVEFORM_TICK_MS,
    )
    return () => clearInterval(timer)
  }, [recording])

  return (
    <View
      style={styles.waveform}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {history.map((value, index) => (
        <View
          key={index}
          style={[
            styles.waveformBar,
            { height: waveformBarHeight(value), backgroundColor: color },
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
  const transcriptStyle = useMemo(() => [styles.transcript, { color: colors.ink }], [colors.ink])
  const interimStyle = useMemo(() => ({ color: colors.body }), [colors.body])
  const add = useNotesStore((state) => state.add)
  const addRecovered = useNotesStore((state) => state.addRecovered)
  const { t } = useI18n()
  const noteLanguage = useSettingsStore((state) => state.noteLanguage)
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const setNoteLanguage = useSettingsStore((state) => state.setNoteLanguage)
  const recordingLanguageRef = useRef<Language>(noteLanguage)
  const languageSavePendingRef = useRef(false)
  const [languageSaving, setLanguageSaving] = useState(false)
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
  const newCaptureRef = useRef(false)
  const pendingNavigationRef = useRef<(() => void) | null>(null)
  const allowExitRef = useRef(false)
  const insets = useSafeAreaInsets()

  const changeNoteLanguage = useCallback(
    async (language: Language) => {
      if (languageSavePendingRef.current) return
      languageSavePendingRef.current = true
      setLanguageSaving(true)
      setSaveError(null)
      try {
        await setNoteLanguage(language)
      } catch {
        setSaveError(
          t(
            'Nie udało się zapisać języka notatki. Spróbuj ponownie.',
            'The note language could not be saved. Try again.',
          ),
        )
      } finally {
        languageSavePendingRef.current = false
        setLanguageSaving(false)
      }
    },
    [setNoteLanguage, t],
  )

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
          t(
            'Nie rozpoznano mowy. Zachowany szkic nadal jest dostępny.',
            'No speech was recognized. Your saved draft is still available.',
          ),
        )
        setSaving(false)
        return
      }

      setSaving(true)
      setSaveError(null)
      try {
        const input = {
          title: defaultTitle(result.language),
          language: result.language,
          content: transcript,
          summary: null,
          tags: [],
          audioUri: result.audioUri,
          durationMs: result.durationMs,
          transcriptionIncomplete: result.needsTranscription ?? false,
        }
        const note = result.sessionId
          ? await addRecovered(input, result.sessionId)
          : await add(input)
        await acknowledgeCapture(result.sessionId)
        pendingResultRef.current = null
        // The recording made it into a note, so the recovery draft is obsolete.
        await clearDraft()
        // Generate title + summary in the background; the store keeps running it
        // after we navigate away, and the note/list update when it lands.
        if (transcript.length > 0 && !result.needsTranscription)
          void processWithLlm(note.id)
        allowExitRef.current = true
        const titlePending = newCaptureRef.current || !result.sessionId ? { titlePending: '1' } : {}
        newCaptureRef.current = false
        if (result.needsTranscription && result.autoTranscribeAudio && result.audioUri) {
          // Reuse the saved-note continuation: whole-file local transcription
          // commits verified source before AI and keeps this note's audio on failure.
          router.replace({ pathname: '/import', params: { noteId: note.id, ...titlePending } })
          return
        }
        router.replace({
          pathname: '/note/[id]',
          params: {
            id: note.id,
            ...titlePending,
            ...(result.notice ? { recordingNotice: result.notice } : {}),
          },
        })
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, addRecovered, clearDraft, processWithLlm, router, t],
  )

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      pendingResultRef.current = result
      await persistRecording(result)
    },
    [persistRecording],
  )

  const recorder = useSpeechRecorder(handleComplete, noteLanguage)
  const { finalTranscript, status, volumeLevel } = recorder

  // Persist only finalized speech, not the recognizer's frequently revised tail.
  useEffect(() => {
    if (
      recorder.backgroundRecording ||
      status !== 'recording' ||
      finalTranscript.length === 0
    )
      return
    if (startedAtRef.current === 0) startedAtRef.current = Date.now()
    void saveDraft(
      finalTranscript,
      startedAtRef.current,
      recordingLanguageRef.current,
    )
  }, [finalTranscript, status, saveDraft, recorder.backgroundRecording])

  const onStart = useCallback(async () => {
    if (!settingsLoaded || languageSavePendingRef.current) return
    setSaveError(null)
    allowExitRef.current = false
    startedAtRef.current = Date.now()
    recordingLanguageRef.current = noteLanguage
    setRequesting(true)
    newCaptureRef.current = true
    const startPromise = recorder.start(undefined, recordingLanguageRef.current)
    startPromiseRef.current = startPromise
    try {
      await startPromise
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setRequesting(false)
      startPromiseRef.current = null
    }
  }, [noteLanguage, recorder.start, settingsLoaded])

  const saveRecoveredDraft = useCallback(
    async (recordAgain: boolean) => {
      const transcript = draft?.transcript.trim() ?? ''
      if (transcript.length === 0) return
      setSaving(true)
      setSaveError(null)
      try {
        const note = await add({
          title: defaultTitle(noteLanguageOrDefault(draft?.language), true),
          language: noteLanguageOrDefault(draft?.language),
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
    (live && !recorder.backgroundRecording) ||
    status === 'interrupted' ||
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
      <Stack.Screen options={{ title: t('Nagrywanie', 'Recording') }} />

      <View style={styles.counterBlock}>
        <View style={styles.languagePicker}>
          <LanguagePicker
            value={
              showingRecoveredDraft
                ? noteLanguageOrDefault(draft?.language)
                : protectNavigation
                  ? (recorder.recordingLanguage ?? recordingLanguageRef.current)
                  : noteLanguage
            }
            onChange={(language) => void changeNoteLanguage(language)}
            disabled={
              protectNavigation ||
              live ||
              showingRecoveredDraft ||
              !draftReady ||
              languageSaving ||
              !settingsLoaded
            }
          />
        </View>
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
          accessibilityLabel={`${t('Czas nagrania', 'Recording time')} ${formatDuration(recorder.durationMs)}`}
        >
          {formatDuration(recorder.durationMs)}
        </Text>
        <RecordingWaveform status={status} volumeLevel={volumeLevel} />
        <Text style={[styles.info, { color: colors.muted }]}>
          {t('Limit nagrania: 30 minut', 'Recording limit: 30 minutes')}
        </Text>
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
        {recorder.permissionDenied && <PermissionSettingsButton />}
        {!live && !busy && !starting && !error && (
          <Text style={[styles.info, { color: colors.muted }]}>
            {recorder.backgroundRecording
              ? t(
                  'Audio nagrywa się także po przejściu na inny ekran i zablokowaniu telefonu. Przerwanie przez system wymaga ręcznego wznowienia.',
                  'Audio recording continues on other screens and when the phone locks. A system interruption requires manual resume.',
                )
              : t(
                  'Pozostań w aplikacji podczas nagrywania. Schowanie aplikacji lub zablokowanie telefonu zakończy i zapisze nagranie.',
                  'Stay in the app while recording. Hiding the app or locking your phone will end and save the recording.',
                )}
          </Text>
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
            style={transcriptStyle}
            interimStyle={interimStyle}
          />
        ) : (
          <View style={styles.emptyTranscript}>
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>
              {live
                ? t('Mów naturalnie', 'Speak naturally')
                : t('Twoje słowa, zapisane.', 'Your words, saved.')}
            </Text>
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              {live
                ? t(
                    'Rozpoznany tekst pojawi się tutaj.',
                    'Recognized text will appear here.',
                  )
                : t(
                    'Naciśnij przycisk i zacznij mówić. Tekst pojawi się tutaj.',
                    'Press the button and start speaking. Your text will appear here.',
                  )}
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
            label={t('Sprawdzam zachowany szkic…', 'Checking saved draft…')}
            variant="primary"
            disabled
            busy
            onPress={() => undefined}
          />
        ) : showingRecoveredDraft ? (
          <>
            <Button
              label={t('Zapisz tekst jako notatkę', 'Save text as a note')}
              variant="primary"
              icon="check"
              onPress={() => void saveRecoveredDraft(false)}
              disabled={saving}
              busy={saving}
            />
            <Button
              label={t(
                'Zapisz tekst i nagraj ponownie',
                'Save text and record again',
              )}
              variant="quiet"
              icon="mic"
              onPress={() => void saveRecoveredDraft(true)}
              disabled={saving}
            />
          </>
        ) : status === 'interrupted' ? (
          <>
            <Button
              label={t('Wznów nagrywanie', 'Resume recording')}
              variant="primary"
              icon="mic"
              onPress={() => void recorder.resume?.()}
              disabled={!recorder.resume || saving}
            />
            <Button
              label={t('Zakończ i zapisz audio', 'Stop and save audio')}
              variant="quiet"
              icon="stop"
              onPress={recorder.stop}
              disabled={saving}
            />
          </>
        ) : pendingResultRef.current && !saving ? (
          <Button
            label={t('Ponów zapis notatki', 'Retry saving note')}
            variant="primary"
            icon="refresh"
            onPress={retrySave}
          />
        ) : (
          <Button
            label={
              saving
                ? t('Zapisuję notatkę…', 'Saving note…')
                : live
                  ? t('Zatrzymaj i zapisz', 'Stop and save')
                  : starting
                    ? t('Przygotowuję mikrofon…', 'Preparing microphone…')
                    : status === 'stopping'
                      ? t('Zapisuję nagranie…', 'Saving recording…')
                      : t('Rozpocznij nagrywanie', 'Start recording')
            }
            variant="primary"
            icon={live ? 'stop' : 'mic'}
            onPress={live ? recorder.stop : () => void onStart()}
            disabled={
              !draftReady ||
              !settingsLoaded ||
              languageSaving ||
              busy ||
              starting
            }
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
            ? t('Notatka nie została zapisana', 'The note was not saved')
            : status === 'stopping' || saving
              ? t('Zapisuję nagranie', 'Saving recording')
              : t('Nagranie trwa', 'Recording in progress')
        }
      >
        <Text style={[styles.sheetCopy, { color: colors.body }]}>
          {failedSave
            ? t(
                'Tekst nagrania został zachowany. Spróbuj ponownie zapisać notatkę albo zostań na ekranie.',
                'Your recorded text has been kept. Try saving the note again or stay on this screen.',
              )
            : status === 'stopping' || saving
              ? t(
                  'Poczekaj na zapis notatki. Po zakończeniu możesz bezpiecznie wrócić.',
                  'Wait for the note to be saved. You can safely go back when it finishes.',
                )
              : t(
                  'Możesz zatrzymać nagranie i zapisać rozpoznany tekst albo wrócić do nagrywania.',
                  'You can stop and save the recognized text or return to recording.',
                )}
        </Text>
        {failedSave ? (
          <Button
            label={t('Ponów zapis notatki', 'Retry saving note')}
            variant="primary"
            icon="refresh"
            onPress={retrySave}
          />
        ) : status !== 'stopping' && !saving ? (
          <Button
            label={t('Zatrzymaj i zapisz', 'Stop and save')}
            variant="primary"
            icon="stop"
            onPress={stopAndSave}
          />
        ) : null}
        <Button
          label={
            failedSave || status === 'stopping' || saving
              ? t('Zostań na ekranie', 'Stay on this screen')
              : t('Kontynuuj nagrywanie', 'Continue recording')
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
  languagePicker: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
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
  status: { ...type.label, fontFamily: fonts.medium },
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
