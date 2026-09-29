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
import { MODEL_MISSING_MESSAGE } from '../../../ai/noteProcessing'
import { NoteTags } from '../../../tags/NoteTags'
import { isCategory } from '../../../domain/categories'
import type { Note, NoteInput } from '../../../domain/note'

type NoteDraft = Pick<NoteInput, 'title' | 'content' | 'tags'> & {
  summary: string
}

const draftFromNote = (note: Note | undefined): NoteDraft => ({
  title: note?.title ?? '',
  content: note?.content ?? '',
  summary: note?.summary ?? '',
  tags: (note?.tags ?? []).filter(isCategory),
})

const sameDraft = (left: NoteDraft, right: NoteDraft): boolean =>
  left.title === right.title &&
  left.content === right.content &&
  left.summary === right.summary &&
  left.tags.length === right.tags.length &&
  left.tags.every((tag, index) => tag === right.tags[index])

export default function EditNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()
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
      setError('Treść transkrypcji nie może być pusta.')
      return
    }
    if (
      externalChange ||
      expectedUpdatedAt.current !== note.updatedAt ||
      !sameDraft(draftFromNote(note), initialDraft.current)
    ) {
      setExternalChange(true)
      setError(
        'Notatka zmieniła się od czasu otwarcia edycji. Wczytaj aktualne dane przed zapisem.',
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
        <Stack.Screen options={{ title: 'Edytuj notatkę' }} />
        <Text style={[styles.body, { color: colors.muted }]}>
          {loaded ? 'Ta notatka już nie istnieje.' : 'Wczytuję notatkę…'}
        </Text>
        {loaded && <Button label="Wróć do listy" onPress={goToList} />}
      </View>
    )
  }

  const editable = !processing && !saving && !externalChange

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Edytuj notatkę',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={goToList}
              accessibilityRole="button"
              accessibilityLabel="Anuluj edycję"
              style={styles.headerCancel}
            >
              <Text style={[styles.headerSaveText, { color: colors.accent }]}>
                Anuluj
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => void save()}
              disabled={!dirty || !editable}
              accessibilityRole="button"
              accessibilityLabel="Zapisz zmiany"
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
                Zapisz
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
            Trwa opracowywanie tej notatki. Edycja jest tymczasowo wyłączona.
          </Text>
        )}
        {error && (
          <Text style={[styles.body, { color: colors.danger }]}>{error}</Text>
        )}
        {externalChange && (
          <>
            <Text style={[styles.body, { color: colors.danger }]}>
              Inna operacja zmieniła notatkę. Wczytaj jej aktualną treść, aby
              nie nadpisać nowszych danych.
            </Text>
            <Button
              label="Wczytaj aktualną notatkę"
              icon="refresh"
              onPress={discardChanges}
            />
          </>
        )}
        <Field
          label="Tytuł"
          value={draft.title}
          onChangeText={(title) =>
            setDraft((current) => ({ ...current, title }))
          }
          placeholder="Bez tytułu"
          editable={editable}
          textStyle={styles.titleField}
        />
        <Field
          label="Podsumowanie"
          value={draft.summary}
          onChangeText={(summary) =>
            setDraft((current) => ({ ...current, summary }))
          }
          placeholder="Dodaj własne podsumowanie"
          multiline
          minHeight={96}
          editable={editable}
        />
        <Field
          label="Transkrypcja"
          value={draft.content}
          onChangeText={(content) =>
            setDraft((current) => ({ ...current, content }))
          }
          placeholder="Treść notatki"
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
            {MODEL_MISSING_MESSAGE}
          </Text>
        )}
      </ScrollView>

      <BottomSheet
        visible={leaveConfirmation}
        onClose={() => {
          pendingAction.current = null
          setLeaveConfirmation(false)
        }}
        title="Masz niezapisane zmiany"
      >
        <Text style={[styles.body, { color: colors.muted }]}>
          Zmiany nie zostały zapisane. Czy chcesz je odrzucić?
        </Text>
        <Button
          label="Odrzuć zmiany"
          variant="danger"
          icon="trash"
          onPress={discardAndLeave}
        />
        <Button
          label="Zostań przy edycji"
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
