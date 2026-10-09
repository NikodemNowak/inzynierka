import { useI18n } from '../../../i18n/useI18n'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  Stack,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../../ui/BottomSheet'
import { Button } from '../../../ui/Button'
import { Field } from '../../../ui/Field'
import { useTheme, spacing, type } from '../../../ui/theme'
import { useNotesStore } from '../../../state/notesStore'
import { useModelStore } from '../../../state/modelStore'
import { getModelMissingMessage } from '../../../ai/noteProcessing'
import { NoteTags } from '../../../tags/NoteTags'
import { isCategory } from '../../../domain/categories'
import type { Note, NoteInput } from '../../../domain/note'
import { LanguagePicker } from '../../../ui/LanguagePicker'
import type { Language } from '../../../i18n/language'

type NoteDraft = Pick<NoteInput, 'title' | 'content' | 'tags'> & {
  summary: string
  language: Language
}

const draftFromNote = (note: Note | undefined): NoteDraft => ({
  title: note?.title ?? '',
  content: note?.content ?? '',
  summary: note?.summary ?? '',
  tags: (note?.tags ?? []).filter(isCategory),
  language: note?.language ?? 'pl',
})

const sameDraft = (left: NoteDraft, right: NoteDraft): boolean =>
  left.language === right.language &&
  left.title === right.title &&
  left.content === right.content &&
  left.summary === right.summary &&
  left.tags.length === right.tags.length &&
  left.tags.every((tag, index) => tag === right.tags[index])

export default function EditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const note = useNotesStore((state) =>
    state.notes.find((item) => item.id === id),
  )
  const loaded = useNotesStore((state) => state.loaded)
  const progress = useNotesStore((state) =>
    id ? state.processing[id] : undefined,
  )
  const update = useNotesStore((state) => state.update)
  const navigation = useNavigation()
  const router = useRouter()
  const modelReady = useModelStore((state) => state.status === 'ready')
  const [draft, setDraft] = useState<NoteDraft>(() => draftFromNote(note))
  const initialDraft = useRef<NoteDraft>(draftFromNote(note))
  const expectedUpdatedAt = useRef<number | null>(note?.updatedAt ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [leaveConfirmation, setLeaveConfirmation] = useState(false)
  const [allowLeave, setAllowLeave] = useState(false)
  const pendingAction = useRef<(() => void) | null>(null)
  const dirty = !sameDraft(draft, initialDraft.current)
  const processing = progress !== undefined

  useEffect(() => {
    if (!note) return
    if (expectedUpdatedAt.current === null) {
      const nextDraft = draftFromNote(note)
      initialDraft.current = nextDraft
      expectedUpdatedAt.current = note.updatedAt
      setDraft(nextDraft)
      return
    }
    if (expectedUpdatedAt.current === note.updatedAt) return
    if (sameDraft(draft, initialDraft.current)) {
      const nextDraft = draftFromNote(note)
      initialDraft.current = nextDraft
      expectedUpdatedAt.current = note.updatedAt
      setDraft(nextDraft)
      setExternalChange(false)
    } else {
      setExternalChange(true)
    }
  }, [draft, note])

  usePreventRemove(dirty && !saving && !allowLeave, ({ data }) => {
    pendingAction.current = () => navigation.dispatch(data.action)
    setLeaveConfirmation(true)
  })

  useEffect(() => {
    if (!allowLeave) return
    const action = pendingAction.current
    pendingAction.current = null
    action?.()
  }, [allowLeave])

  const goToList = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const discardAndLeave = () => {
    setLeaveConfirmation(false)
    setAllowLeave(true)
  }

  const discardChanges = () => {
    const nextDraft = draftFromNote(note)
    setDraft(nextDraft)
    initialDraft.current = nextDraft
    expectedUpdatedAt.current = note?.updatedAt ?? null
    setExternalChange(false)
    setError(null)
  }

  const save = async () => {
    if (!note || processing || saving) return
    if (draft.content.trim().length === 0 && !note.audioUri) {
      setError(
        t(
          'Treść transkrypcji nie może być pusta.',
          'The transcript cannot be empty.',
        ),
      )
      return
    }
    if (
      externalChange ||
      expectedUpdatedAt.current !== note.updatedAt ||
      !sameDraft(draftFromNote(note), initialDraft.current)
    ) {
      setExternalChange(true)
      setError(
        t(
          'Notatka zmieniła się od czasu otwarcia edycji. Wczytaj aktualne dane przed zapisem.',
          'The note has changed since you opened the editor. Load the current version before saving.',
        ),
      )
      return
    }
    setError(null)
    setSaving(true)
    try {
      await update(note.id, {
        title: draft.title.trim(),
        content: draft.content.trim(),
        summary: draft.summary.trim() || null,
        tags: draft.tags,
        audioUri: note.audioUri,
        durationMs: note.durationMs,
        language: draft.language,
      })
      initialDraft.current = { ...draft, tags: [...draft.tags] }
      expectedUpdatedAt.current =
        useNotesStore.getState().notes.find((item) => item.id === note.id)
          ?.updatedAt ?? null
      setExternalChange(false)
      goToList()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  if (!note) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.canvas }]}>
        <Stack.Screen options={{ title: t('Edytuj notatkę', 'Edit note') }} />
        <Text style={[styles.body, { color: colors.muted }]}>
          {loaded
            ? t('Ta notatka już nie istnieje.', 'This note no longer exists.')
            : t('Wczytuję notatkę…', 'Loading note…')}
        </Text>
        {loaded && (
          <Button
            label={t('Wróć do listy', 'Back to notes')}
            onPress={goToList}
          />
        )}
      </View>
    )
  }

  const editable = !processing && !saving && !externalChange

  return (
    <>
      <Stack.Screen
        options={{
          title: t('Edytuj notatkę', 'Edit note'),
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={goToList}
              accessibilityRole="button"
              accessibilityLabel={t('Anuluj edycję', 'Cancel editing')}
              style={styles.headerCancel}
            >
              <Text style={[styles.headerSaveText, { color: colors.accent }]}>
                {t('Anuluj', 'Cancel')}
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => void save()}
              disabled={!dirty || !editable}
              accessibilityRole="button"
              accessibilityLabel={t('Zapisz zmiany', 'Save changes')}
              accessibilityState={{
                disabled: !dirty || !editable,
                busy: saving,
              }}
              style={({ pressed }) => [
                styles.headerSave,
                { opacity: !dirty || !editable ? 0.4 : pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.headerSaveText, { color: colors.accent }]}>
                {t('Zapisz', 'Save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.container,
          {
            backgroundColor: colors.canvas,
            paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.lg),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {processing && (
          <Text style={[styles.hint, { color: colors.muted }]}>
            {t(
              'Trwa opracowywanie tej notatki. Edycja jest tymczasowo wyłączona.',
              'This note is being processed. Editing is temporarily disabled.',
            )}
          </Text>
        )}
        {error && (
          <Text style={[styles.body, { color: colors.danger }]}>{error}</Text>
        )}
        {externalChange && (
          <>
            <Text style={[styles.body, { color: colors.danger }]}>
              {t(
                'Inna operacja zmieniła notatkę. Wczytaj jej aktualną treść, aby nie nadpisać nowszych danych.',
                'Another operation changed the note. Load its current content to avoid overwriting newer changes.',
              )}
            </Text>
            <Button
              label={t('Wczytaj aktualną notatkę', 'Load current note')}
              icon="refresh"
              onPress={discardChanges}
            />
          </>
        )}
        <LanguagePicker
          value={draft.language}
          onChange={(language) =>
            setDraft((current) => ({ ...current, language }))
          }
          disabled={!editable}
        />
        <Field
          label={t('Tytuł', 'Title')}
          value={draft.title}
          onChangeText={(title) =>
            setDraft((current) => ({ ...current, title }))
          }
          placeholder={t('Bez tytułu', 'Untitled')}
          editable={editable}
          textStyle={styles.titleField}
        />
        <Field
          label={t('Podsumowanie', 'Summary')}
          value={draft.summary}
          onChangeText={(summary) =>
            setDraft((current) => ({ ...current, summary }))
          }
          placeholder={t('Dodaj własne podsumowanie', 'Add your own summary')}
          multiline
          minHeight={96}
          editable={editable}
        />
        <Field
          label={t('Transkrypcja', 'Transcript')}
          value={draft.content}
          onChangeText={(content) =>
            setDraft((current) => ({ ...current, content }))
          }
          placeholder={t('Treść notatki', 'Note content')}
          multiline
          minHeight={180}
          editable={editable}
        />
        <NoteTags
          tags={draft.tags}
          onChange={(tags) => setDraft((current) => ({ ...current, tags }))}
          editable={editable}
        />
        {!modelReady && (
          <Text style={[styles.hint, { color: colors.muted }]}>
            {getModelMissingMessage()}
          </Text>
        )}
      </ScrollView>

      <BottomSheet
        visible={leaveConfirmation}
        onClose={() => {
          pendingAction.current = null
          setLeaveConfirmation(false)
        }}
        title={t('Masz niezapisane zmiany', 'You have unsaved changes')}
      >
        <Text style={[styles.body, { color: colors.muted }]}>
          {t(
            'Zmiany nie zostały zapisane. Czy chcesz je odrzucić?',
            'Your changes have not been saved. Discard them?',
          )}
        </Text>
        <Button
          label={t('Odrzuć zmiany', 'Discard changes')}
          variant="danger"
          icon="trash"
          onPress={discardAndLeave}
        />
        <Button
          label={t('Zostań przy edycji', 'Keep editing')}
          variant="secondary"
          onPress={() => {
            pendingAction.current = null
            setLeaveConfirmation(false)
          }}
        />
      </BottomSheet>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerSave: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerCancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerSaveText: { ...type.label },
  titleField: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { ...type.body },
  hint: { ...type.meta },
})
