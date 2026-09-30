import { useCallback, useEffect, useRef, useState } from 'react'
import { Stack, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { useNotesStore } from '../state/notesStore'
import {
  useSpeechRecorder,
  type RecordingResult,
} from '../stt/useSpeechRecorder'
import { LiveTranscript } from '../stt/LiveTranscript'
import { PermissionSettingsButton } from '../stt/PermissionSettingsButton'
import { deleteRecordingFile, saveRecordingFile } from '../audio/audioFiles'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProcessingIndicator } from '../ui/Motion'
import { spacing, type, useTheme } from '../ui/theme'

interface SelectedAudio {
  name: string
  size: number | null
}

const defaultTitle = (): string =>
  `Import ${new Date().toLocaleString('pl-PL', {
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
  const router = useRouter()
  const navigation = useNavigation()
  const { colors } = useTheme()
  const add = useNotesStore((state) => state.add)
  const processWithLlm = useNotesStore((state) => state.processWithLlm)
  const [selectedAudio, setSelectedAudio] = useState<SelectedAudio | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const storedUriRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const pendingResultRef = useRef<RecordingResult | null>(null)
  const pendingNavigationRef = useRef<(() => void) | null>(null)
  const finishCancelledImportRef = useRef<(() => Promise<void>) | null>(null)
  const cancellationRequestedRef = useRef(false)
  const allowExitRef = useRef(false)
  const insets = useSafeAreaInsets()

  const persistResult = useCallback(
    async (result: RecordingResult) => {
      const transcript = result.transcript.trim()
      if (transcript.length === 0) {
        setSaveError(
          'Nie rozpoznano mowy w pliku. Możesz ponowić próbę dla tego nagrania albo wybrać inny plik.',
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
          durationMs: null,
        })
        pendingResultRef.current = null
        // The note now owns the copied source audio.
        storedUriRef.current = null
        setSelectedAudio(null)
        if (transcript.length > 0) void processWithLlm(note.id)
        allowExitRef.current = true
        router.replace(`/note/${note.id}`)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
    },
    [add, processWithLlm, router],
  )

  const handleComplete = useCallback(
    async (result: RecordingResult) => {
      if (cancellationRequestedRef.current) {
        await finishCancelledImportRef.current?.()
        return
      }

      if (result.transcript.trim().length === 0) {
        pendingResultRef.current = null
        setSaveError(
          result.notice ??
            'Nie rozpoznano mowy w pliku. Możesz ponowić próbę dla tego nagrania albo wybrać inny plik.',
        )
        setSaving(false)
        return
      }

      pendingResultRef.current = result
      await persistResult(result)
    },
    [persistResult],
  )

  const recorder = useSpeechRecorder(handleComplete)
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
      const startPromise = recorder.start({ uri })
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
    [recorder.start],
  )

  const pickAndTranscribe = useCallback(async () => {
    setSaveError(null)
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      })
      if (picked.canceled) return
      const asset = picked.assets?.[0]
      if (!asset) {
        setSaveError('Nie udało się odczytać wybranego pliku.')
        return
      }

      // Save a stable copy so the note can keep the source after cache cleanup.
      const storedUri = await saveRecordingFile(asset.uri)
      const previousUri = storedUriRef.current
      if (previousUri) await deleteRecordingFile(previousUri)
      storedUriRef.current = storedUri
      pendingResultRef.current = null
      setSelectedAudio({
        name: asset.name,
        size: typeof asset.size === 'number' ? asset.size : null,
      })
      await beginTranscription(storedUri)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }, [beginTranscription])

  const retry = useCallback(() => {
    if (pendingResultRef.current) {
      void persistResult(pendingResultRef.current)
      return
    }
    if (storedUriRef.current) void beginTranscription(storedUriRef.current)
  }, [beginTranscription, persistResult])

  const cleanupCancelledImport = useCallback(async () => {
    const uri = storedUriRef.current
    storedUriRef.current = null
    pendingResultRef.current = null
    cancellationRequestedRef.current = false
    await deleteRecordingFile(uri)
    setSelectedAudio(null)
    setSaveError(null)
    setCanceling(false)
    setShowExitPrompt(false)
    const pendingNavigation = pendingNavigationRef.current
    pendingNavigationRef.current = null
    if (pendingNavigation) allowExitRef.current = true
    pendingNavigation?.()
  }, [])
  finishCancelledImportRef.current = cleanupCancelledImport

  const cancelImport = useCallback(() => {
    setShowExitPrompt(false)
    cancellationRequestedRef.current = true
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
      if (!allowExitRef.current && storedUriRef.current) {
        void deleteRecordingFile(storedUriRef.current)
      }
    },
    [],
  )

  const statusText = canceling
    ? 'Anuluję import…'
    : saving
      ? 'Zapisuję notatkę…'
      : requesting || status === 'starting'
        ? 'Przygotowuję transkrypcję…'
        : status === 'recording'
          ? 'Przepisuję nagranie lokalnie…'
          : status === 'stopping'
            ? 'Kończę transkrypcję…'
            : ''
  const retryLabel = pendingResultRef.current
    ? 'Ponów zapis notatki'
    : 'Ponów transkrypcję'

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Stack.Screen options={{ title: 'Importuj nagranie' }} />

      {selectedAudio ? (
        <View
          style={[
            styles.fileRow,
            { backgroundColor: colors.surface, borderColor: colors.line },
          ]}
        >
          <View
            style={[styles.fileIcon, { backgroundColor: colors.accentSoft }]}
          >
            <AudioFileMark size={38} color={colors.accent} />
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
            <View
              style={[styles.introIcon, { backgroundColor: colors.accentSoft }]}
            >
              <AudioFileMark
                size={55}
                color={colors.faint}
                waveColor={colors.accent}
              />
            </View>
            <Text style={[styles.title, { color: colors.ink }]}>
              Zamień nagranie w notatkę
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Wybierz plik audio z telefonu.
            </Text>
          </View>
        )}

        {statusText.length > 0 && (
          <View style={styles.statusRow}>
            {canceling ? null : <ProcessingIndicator label={statusText} />}
            {canceling && (
              <Text style={[styles.statusText, { color: colors.muted }]}>
                {statusText}
              </Text>
            )}
          </View>
        )}

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

        {selectedAudio && (
          <View
            style={[styles.transcriptDivider, { borderColor: colors.line }]}
          />
        )}

        {selectedAudio && (
          <View style={styles.transcriptSection}>
            <Text style={[styles.transcriptLabel, { color: colors.ink }]}>
              Transkrypcja
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
                  ? 'Po rozpoczęciu transkrypcji rozpoznany tekst pojawi się tutaj.'
                  : 'Czekam na rozpoznane słowa…'}
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
              label={canceling ? 'Anuluję import…' : 'Anuluj import'}
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
              label="Anuluj import"
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
              label="Wybierz inny plik"
              variant="quiet"
              icon="upload"
              onPress={() => void pickAndTranscribe()}
            />
          </>
        ) : (
          <Button
            label="Wybierz plik audio"
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
            ? 'Notatka nie została zapisana'
            : 'Importowanie trwa'
        }
      >
        <Text style={[styles.sheetCopy, { color: colors.body }]}>
          {pendingResultRef.current
            ? 'Tekst z pliku jest zachowany na tym ekranie. Ponów zapis, wróć do transkrypcji albo usuń ten import.'
            : 'Możesz zapisać dotychczas rozpoznany tekst, przerwać import albo kontynuować transkrypcję.'}
        </Text>
        {pendingResultRef.current ? (
          <Button
            label="Ponów zapis notatki"
            variant="primary"
            icon="refresh"
            onPress={retry}
          />
        ) : (
          <Button
            label="Zapisz rozpoznany tekst"
            variant="primary"
            icon="check"
            onPress={stopAndSaveText}
            disabled={transcript.trim().length === 0 || saving || canceling}
          />
        )}
        <Button
          label="Przerwij import bez zapisywania"
          variant="danger"
          icon="trash"
          onPress={cancelImport}
          disabled={saving || status === 'stopping' || canceling}
        />
        <Button
          label={
            pendingResultRef.current ? 'Zostań na ekranie' : 'Kontynuuj import'
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
  fileRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
  },
  fileIcon: {
    width: 54,
    height: 54,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileDetails: { flex: 1, gap: 3 },
  fileName: { ...type.body, fontWeight: '600' },
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
  introIcon: {
    width: 88,
    height: 88,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...type.title, fontSize: 22, lineHeight: 29, textAlign: 'center' },
  subtitle: { ...type.body, textAlign: 'center' },
  statusRow: { minHeight: 28, justifyContent: 'center' },
  statusText: { ...type.body, textAlign: 'center' },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
  },
  error: { ...type.body, flex: 1, fontSize: 14, lineHeight: 21 },
  transcriptSection: { gap: spacing.md, paddingTop: spacing.sm },
  transcriptDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  transcriptLabel: { ...type.title, fontSize: 18 },
  transcript: { fontSize: 18, lineHeight: 29, letterSpacing: -0.1 },
  placeholder: { ...type.body, lineHeight: 25 },
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  sheetCopy: { ...type.body },
})
