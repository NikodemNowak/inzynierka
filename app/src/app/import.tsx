import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Stack,
  useNavigation,
  useRouter,
  useLocalSearchParams,
} from 'expo-router'
import { useIsFocused, usePreventRemove } from 'expo-router/react-navigation'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { useNotesStore } from '../state/notesStore'
import { useSettingsStore } from '../state/settingsStore'
import { useI18n } from '../i18n/useI18n'
import {
  localeForLanguage,
  noteLanguageOrDefault,
  type Language,
} from '../i18n/language'
import { LanguagePicker } from '../ui/LanguagePicker'
import {
  useSpeechRecorder,
  type RecordingResult,
} from '../stt/useSpeechRecorder'
import { LiveTranscript } from '../stt/LiveTranscript'
import { PermissionSettingsButton } from '../stt/PermissionSettingsButton'
import {
  deleteRecordingFile,
  saveRecordingFile,
  deletePickerCacheFile,
} from '../audio/audioFiles'
import { inspectImportAudio } from '../audio/importAudio'
import { clearImportCheckpoint } from '../stt/importTranscription'
import {
  markImportSourceCommitted,
  type ImportContinuation,
} from '../processing/importProcessing'
import type { Note } from '../domain/note'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { ErrorCard } from '../ui/ErrorCard'
import { NoteMark } from '../ui/NoteMark'
import { PulseDot } from '../ui/PulseDot'
import { radius, spacing, type, useTheme, fonts } from '../ui/theme'

interface SelectedAudio {
  name: string
  size: number | null
  durationMs: number
}

const defaultTitle = (language: Language): string =>
  `Import ${new Date().toLocaleString(localeForLanguage(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

const AUDIO_MARK_BARS = [
  { x: 21, height: 8 },
  { x: 27, height: 17 },
  { x: 33, height: 25 },
  { x: 39, height: 14 },
]

function AudioFileMark({
  size,
  color,
  waveColor = color,
}: {
  size: number
  color: string
  waveColor?: string
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path
        d="M13 5h19l12 12v34H13zM32 5v12h12"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {AUDIO_MARK_BARS.map((bar) => (
        <Path
          key={bar.x}
          d={`M${bar.x} ${28 - bar.height / 2}v${bar.height}`}
          fill="none"
          stroke={waveColor}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  )
}

export default function ImportAudioScreen() {
  const isFocused = useIsFocused()
  const router = useRouter()
  const { noteId, titlePending } = useLocalSearchParams<{ noteId?: string; titlePending?: string }>()
  const navigation = useNavigation()
  const { colors } = useTheme()
  const { t } = useI18n()
  const noteLanguage = useSettingsStore((state) => state.noteLanguage)
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const setNoteLanguage = useSettingsStore((state) => state.setNoteLanguage)
  const importLanguageRef = useRef<Language>(noteLanguage)
  const languageSavePendingRef = useRef(false)
  const [languageSaving, setLanguageSaving] = useState(false)
  const add = useNotesStore((state) => state.add)
  const applyTranscript = useNotesStore((state) => state.applyTranscript)
  const removeNote = useNotesStore((state) => state.remove)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const [selectedAudio, setSelectedAudio] = useState<SelectedAudio | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const storedUriRef = useRef<string | null>(null)
  const sourceNoteRef = useRef<Note | null>(null)
  const ownsSourceRef = useRef(false)
  const pickerControllerRef = useRef<AbortController | null>(null)
  const initializedBackfillRef = useRef(false)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const pendingResultRef = useRef<RecordingResult | null>(null)
  const pendingNavigationRef = useRef<(() => void) | null>(null)
  const finishCancelledImportRef = useRef<(() => Promise<void>) | null>(null)
  const cancellationRequestedRef = useRef(false)
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

  const persistResult = useCallback(
    async (result: RecordingResult, continuation?: ImportContinuation) => {
      const transcript = result.transcript.trim()
      if (transcript.length === 0 && !result.audioUri) {
        setSaveError(
          t(
            'Nie rozpoznano mowy w pliku. Możesz ponowić próbę dla tego nagrania albo wybrać inny plik.',
            'No speech was recognized in the file. Try this recording again or choose another file.',
          ),
        )
        setSaving(false)
        return
      }

      setSaving(true)
      setSaveError(null)
      try {
        const sourceNote = sourceNoteRef.current
        const note =
          sourceNote ??
          (await add({
            title: defaultTitle(result.language),
            language: result.language,
            content: transcript,
            summary: null,
            tags: [],
            audioUri: result.audioUri,
            durationMs: result.durationMs,
            transcriptionIncomplete: result.needsTranscription ?? false,
          }))
        if (sourceNote) {
          const applied = await applyTranscript(
            sourceNote.id,
            {
              updatedAt: sourceNote.updatedAt,
              content: sourceNote.content,
              audioUri: sourceNote.audioUri,
            },
            transcript,
            result.durationMs,
            result.needsTranscription ?? false,
          )
          if (!applied)
            throw new Error(
              t(
                'Notatka została zmieniona lub usunięta. Zachowano audio i postęp; uruchom transkrypcję ponownie z aktualnej notatki.',
                'The note was edited or deleted. Audio and progress have been kept; start transcription again from the current note.',
              ),
            )
        }
        // SQLite owns the source now; navigation may release this screen while
        // the same granted import continues its durable AI stage.
        markImportSourceCommitted(continuation)
        sourceNoteRef.current =
          useNotesStore.getState().notes.find((item) => item.id === note.id) ??
          note
        ownsSourceRef.current = false
        if (!result.needsTranscription && result.audioUri)
          await clearImportCheckpoint(result.audioUri, result.language)
        pendingResultRef.current = null
        // The note now owns the copied source audio.
        storedUriRef.current = null
        setSelectedAudio(null)
        allowExitRef.current = true
        const preparingNewTitle = transcript.length > 0 && !result.needsTranscription && (!sourceNote || titlePending === '1')
        router.replace(preparingNewTitle
          ? { pathname: '/note/[id]', params: { id: note.id, titlePending: '1' } }
          : `/note/${note.id}`)
        if (transcript.length > 0 && !result.needsTranscription) {
          if (continuation)
            await processWithLlm(note.id, { importContinuation: continuation })
          else void processWithLlm(note.id)
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
        if (continuation) throw e
      }
    },
    [add, applyTranscript, processWithLlm, router, t, titlePending],
  )

  const handleComplete = useCallback(
    async (result: RecordingResult, continuation?: ImportContinuation) => {
      if (cancellationRequestedRef.current) {
        await finishCancelledImportRef.current?.()
        return
      }

      if (result.transcript.trim().length === 0 && !result.audioUri) {
        pendingResultRef.current = null
        setSaveError(
          result.notice ??
            t(
              'Nie rozpoznano mowy w pliku. Możesz ponowić próbę dla tego nagrania albo wybrać inny plik.',
              'No speech was recognized in the file. Try this recording again or choose another file.',
            ),
        )
        setSaving(false)
        return
      }

      pendingResultRef.current = result
      await persistResult(result, continuation)
    },
    [persistResult, t],
  )

  const recorder = useSpeechRecorder(handleComplete, noteLanguage, 'import')
  const { status, finalTranscript } = recorder
  const statusRef = useRef(status)
  statusRef.current = status
  const transcript = recorder.transcript
  const busy =
    requesting ||
    canceling ||
    saving ||
    status === 'starting' ||
    status === 'recording' ||
    status === 'stopping'
  const protectNavigation = busy || pendingResultRef.current !== null
  const error = saveError ?? recorder.error

  const beginTranscription = useCallback(
    async (uri: string) => {
      cancellationRequestedRef.current = false
      setCanceling(false)
      setSaveError(null)
      setRequesting(true)
      const knownDuration =
        sourceNoteRef.current?.durationMs ?? selectedAudio?.durationMs
      const startPromise = recorder.start(
        {
          uri,
          durationMs:
            knownDuration && knownDuration > 0 ? knownDuration : undefined,
        },
        importLanguageRef.current,
      )
      startPromiseRef.current = startPromise
      try {
        await startPromise
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
      } finally {
        setRequesting(false)
        startPromiseRef.current = null
      }
    },
    [recorder.start, selectedAudio?.durationMs],
  )

  useEffect(() => {
    if (!noteId || initializedBackfillRef.current) return
    const note = useNotesStore
      .getState()
      .notes.find((item) => item.id === noteId)
    if (!note?.audioUri) return
    initializedBackfillRef.current = true
    sourceNoteRef.current = note
    storedUriRef.current = note.audioUri
    ownsSourceRef.current = false
    importLanguageRef.current = noteLanguageOrDefault(note.language)
    setSelectedAudio({
      name: note.title,
      size: null,
      durationMs: note.durationMs ?? 0,
    })
    void beginTranscription(note.audioUri)
  }, [noteId, beginTranscription])

  const pickAndTranscribe = useCallback(async () => {
    if (!settingsLoaded || languageSavePendingRef.current) return
    // Snapshot before opening the picker, which can outlive a language change.
    const selectedLanguage = noteLanguage
    importLanguageRef.current = selectedLanguage
    setRequesting(true)
    setSaveError(null)
    const pickerController = new AbortController()
    pickerControllerRef.current = pickerController
    let pickerUri: string | null = null
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      })
      if (picked.canceled) return
      const asset = picked.assets?.[0]
      if (!asset) {
        setSaveError(
          t(
            'Nie udało się odczytać wybranego pliku.',
            'The selected file could not be read.',
          ),
        )
        return
      }
      pickerUri = asset.uri

      const durationMs = await inspectImportAudio(
        asset.uri,
        pickerController.signal,
      )
      if (pickerController.signal.aborted) return

      // Save a stable copy so the note can keep the source after cache cleanup.
      const storedUri = await saveRecordingFile(asset.uri)
      if (pickerController.signal.aborted) {
        await deleteRecordingFile(storedUri)
        return
      }
      const previousUri = storedUriRef.current
      // A previous import already owns its audio through a durable note.
      if (previousUri && !sourceNoteRef.current && ownsSourceRef.current)
        await deleteRecordingFile(previousUri)
      let note: Note
      try {
        note = await add({
          title: defaultTitle(selectedLanguage),
          language: selectedLanguage,
          content: '',
          summary: null,
          tags: [],
          audioUri: storedUri,
          durationMs,
          transcriptionIncomplete: true,
        })
      } catch (failure) {
        await deleteRecordingFile(storedUri)
        throw failure
      }
      sourceNoteRef.current = note
      ownsSourceRef.current = true
      if (pickerController.signal.aborted) {
        await removeNote(note.id)
        sourceNoteRef.current = null
        ownsSourceRef.current = false
        return
      }
      storedUriRef.current = storedUri
      pendingResultRef.current = null
      setSelectedAudio({
        name: asset.name,
        size: typeof asset.size === 'number' ? asset.size : null,
        durationMs,
      })
      await beginTranscription(storedUri)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      await deletePickerCacheFile(pickerUri)
      setRequesting(false)
    }
  }, [add, removeNote, beginTranscription, noteLanguage, settingsLoaded, t])

  const retry = useCallback(() => {
    if (pendingResultRef.current) {
      void persistResult(pendingResultRef.current)
      return
    }
    if (storedUriRef.current) void beginTranscription(storedUriRef.current)
  }, [beginTranscription, persistResult])

  const cleanupCancelledImport = useCallback(async () => {
    const uri = storedUriRef.current
    const sourceNote = sourceNoteRef.current
    const ownsSource = ownsSourceRef.current
    storedUriRef.current = null
    pendingResultRef.current = null
    cancellationRequestedRef.current = false
    if (uri && ownsSource)
      await clearImportCheckpoint(uri, importLanguageRef.current)
    if (sourceNote && ownsSource) await removeNote(sourceNote.id)
    else if (!sourceNote) await deleteRecordingFile(uri)
    sourceNoteRef.current = null
    ownsSourceRef.current = false
    setSelectedAudio(null)
    setSaveError(null)
    setCanceling(false)
    setShowExitPrompt(false)
    const pendingNavigation = pendingNavigationRef.current
    pendingNavigationRef.current = null
    if (pendingNavigation) allowExitRef.current = true
    pendingNavigation?.()
  }, [removeNote])
  finishCancelledImportRef.current = cleanupCancelledImport

  const cancelImport = useCallback(() => {
    setShowExitPrompt(false)
    cancellationRequestedRef.current = true
    pickerControllerRef.current?.abort()
    setCanceling(true)

    const stopOrCleanUp = () => {
      const currentStatus = statusRef.current
      if (currentStatus === 'recording' || currentStatus === 'starting') {
        recorder.stop()
        return
      }
      if (currentStatus === 'stopping') return
      void cleanupCancelledImport()
    }

    const startPromise = startPromiseRef.current
    if (startPromise && (requesting || status === 'starting')) {
      void startPromise.then(stopOrCleanUp, () => void cleanupCancelledImport())
      return
    }
    stopOrCleanUp()
  }, [cleanupCancelledImport, recorder, requesting, status])

  const stopAndSaveText = useCallback(() => {
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

  usePreventRemove(protectNavigation, ({ data }) => {
    if (allowExitRef.current) {
      navigation.dispatch(data.action)
      return
    }
    pendingNavigationRef.current = () => navigation.dispatch(data.action)
    setShowExitPrompt(true)
  })

  // A copied source that was never attached to a note is disposable after exit.
  useEffect(
    () => () => {
      pickerControllerRef.current?.abort()
      if (
        !allowExitRef.current &&
        storedUriRef.current &&
        !sourceNoteRef.current
      ) {
        void deleteRecordingFile(storedUriRef.current)
      }
    },
    [],
  )

  const statusText = canceling
    ? t('Anuluję import…', 'Canceling import…')
    : saving
      ? t('Zapisuję notatkę…', 'Saving note…')
      : requesting || status === 'starting'
        ? t('Przygotowuję transkrypcję…', 'Preparing transcription…')
        : status === 'recording'
          ? t(
              'Przepisuję nagranie lokalnie…',
              'Transcribing recording locally…',
            )
          : status === 'stopping'
            ? t('Kończę transkrypcję…', 'Finishing transcription…')
            : ''
  const retryLabel = pendingResultRef.current
    ? t('Ponów zapis notatki', 'Retry saving note')
    : t('Ponów transkrypcję', 'Retry transcription')

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen
        options={{ title: t('Importuj nagranie', 'Import recording') }}
      />

      <View style={styles.languagePicker}>
        <LanguagePicker
          value={
            selectedAudio || busy ? importLanguageRef.current : noteLanguage
          }
          onChange={(language) => void changeNoteLanguage(language)}
          disabled={
            !settingsLoaded ||
            languageSaving ||
            busy ||
            Boolean(selectedAudio) ||
            pendingResultRef.current !== null
          }
        />
      </View>

      {selectedAudio ? (
        <View
          style={[
            styles.fileRow,
            { backgroundColor: colors.paper, borderColor: colors.line },
          ]}
        >
          <View
            style={[styles.fileIcon, { backgroundColor: colors.marker }]}
          >
            <AudioFileMark size={34} color={colors.onMarker} />
          </View>
          <View style={styles.fileDetails}>
            <Text
              style={[styles.fileName, { color: colors.ink }]}
              numberOfLines={1}
            >
              {selectedAudio.name}
            </Text>
            {formatFileSize(selectedAudio.size).length > 0 && (
              <Text style={[styles.fileSize, { color: colors.muted }]}>
                {formatFileSize(selectedAudio.size)}
              </Text>
            )}
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!selectedAudio && (
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <NoteMark width={72} />
            </View>
            <Text style={[styles.title, { color: colors.ink }]}>
              {t('Zamień nagranie w notatkę', 'Turn a recording into a note')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {t(
                'Wybierz plik audio z telefonu, do 30 minut. Audio jest zachowywane przed transkrypcją.',
                'Choose an audio file from your phone, up to 30 minutes. Audio is saved before transcription.',
              )}
            </Text>
          </View>
        )}

        {statusText.length > 0 && (
          <View
            style={styles.statusRow}
            accessibilityRole="progressbar"
            accessibilityLabel={statusText}
          >
            {canceling ? null : isFocused ? (
              <PulseDot color={colors.marker} size={10} />
            ) : null}
            <Text style={[styles.statusText, { color: colors.muted }]}>
              {statusText}
            </Text>
          </View>
        )}

        {error && <ErrorCard message={error} />}
        {recorder.permissionDenied && <PermissionSettingsButton />}
        {recorder.info && (
          <Text style={[styles.placeholder, { color: colors.muted }]}>
            {recorder.info}
          </Text>
        )}

        {selectedAudio && (
          <View
            style={[styles.transcriptDivider, { borderColor: colors.line }]}
          />
        )}

        {selectedAudio && (
          <View style={styles.transcriptSection}>
            <Text style={[styles.transcriptLabel, { color: colors.ink }]}>
              {t('Transkrypcja', 'Transcript')}
            </Text>
            {transcript.length > 0 ? (
              <LiveTranscript
                text={transcript}
                finalizedText={finalTranscript}
                style={[styles.transcript, { color: colors.ink }]}
                interimStyle={{ color: colors.body }}
              />
            ) : (
              <Text style={[styles.placeholder, { color: colors.muted }]}>
                {status === 'idle'
                  ? t(
                      'Po rozpoczęciu transkrypcji rozpoznany tekst pojawi się tutaj.',
                      'Recognized text will appear here once transcription starts.',
                    )
                  : t(
                      'Czekam na rozpoznane słowa…',
                      'Waiting for recognized words…',
                    )}
              </Text>
            )}
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
        {busy ? (
          <>
            <Button
              label={
                canceling
                  ? t('Anuluję import…', 'Canceling import…')
                  : t('Anuluj import', 'Cancel import')
              }
              variant="quiet"
              icon={canceling ? undefined : 'close'}
              onPress={() => setShowExitPrompt(true)}
              disabled={canceling || saving || status === 'stopping'}
            />
          </>
        ) : pendingResultRef.current ? (
          <>
            <Button
              label={retryLabel}
              variant="primary"
              icon="refresh"
              onPress={retry}
            />
            <Button
              label={t('Anuluj import', 'Cancel import')}
              variant="quiet"
              icon="close"
              onPress={() => setShowExitPrompt(true)}
            />
          </>
        ) : selectedAudio ? (
          <>
            <Button
              label={retryLabel}
              variant="primary"
              icon="refresh"
              onPress={retry}
            />
            <Button
              label={t('Wybierz inny plik', 'Choose another file')}
              variant="quiet"
              icon="upload"
              onPress={() => void pickAndTranscribe()}
            />
          </>
        ) : (
          <Button
            label={t('Wybierz plik audio', 'Choose audio file')}
            disabled={!settingsLoaded || languageSaving}
            variant="primary"
            icon="upload"
            onPress={() => void pickAndTranscribe()}
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
          pendingResultRef.current
            ? t('Notatka nie została zapisana', 'The note was not saved')
            : t('Importowanie trwa', 'Import in progress')
        }
      >
        <Text style={[styles.sheetCopy, { color: colors.body }]}>
          {pendingResultRef.current
            ? t(
                'Tekst z pliku jest zachowany na tym ekranie. Ponów zapis, wróć do transkrypcji albo usuń ten import.',
                'The text from the file is kept on this screen. Retry saving, return to transcription or discard this import.',
              )
            : t(
                'Możesz zapisać dotychczas rozpoznany tekst, przerwać import albo kontynuować transkrypcję.',
                'You can save the recognized text so far, stop importing or continue transcription.',
              )}
        </Text>
        {pendingResultRef.current ? (
          <Button
            label={t('Ponów zapis notatki', 'Retry saving note')}
            variant="primary"
            icon="refresh"
            onPress={retry}
          />
        ) : (
          <Button
            label={t('Zapisz rozpoznany tekst', 'Save recognized text')}
            variant="primary"
            icon="check"
            onPress={stopAndSaveText}
            disabled={transcript.trim().length === 0 || saving || canceling}
          />
        )}
        <Button
          label={
            noteId
              ? t(
                  'Przerwij uzupełnianie transkrypcji',
                  'Cancel transcript completion',
                )
              : t(
                  'Usuń import i jego audio',
                  'Delete this import and its audio',
                )
          }
          variant="danger"
          icon="trash"
          onPress={cancelImport}
          disabled={saving || status === 'stopping' || canceling}
        />
        <Button
          label={
            pendingResultRef.current
              ? t('Zostań na ekranie', 'Stay on this screen')
              : t('Kontynuuj import', 'Continue import')
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
  languagePicker: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  fileRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  fileIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileDetails: { flex: 1, gap: 3 },
  fileName: { ...type.body, fontFamily: fonts.semibold },
  fileSize: { ...type.meta },
  content: { flex: 1 },
  contentInner: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xl,
  },
  intro: {
    flex: 1,
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  introIcon: { marginBottom: spacing.md },
  title: { ...type.display, textAlign: 'center' },
  subtitle: { ...type.body, textAlign: 'center' },
  statusRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  statusText: { ...type.body, textAlign: 'center' },
  transcriptSection: { gap: spacing.md, paddingTop: spacing.sm },
  transcriptDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  transcriptLabel: { ...type.display, fontSize: 22, lineHeight: 30 },
  transcript: { fontSize: 18, lineHeight: 29, letterSpacing: -0.1 },
  placeholder: { ...type.body, lineHeight: 25 },
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  sheetCopy: { ...type.body },
})
