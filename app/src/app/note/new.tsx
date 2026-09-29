import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { spacing, type, useTheme } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { NoteTags } from '../../tags/NoteTags'

interface NewNoteDraft {
  title: string
  content: string
  summary: string
  tags: string[]
}

const EMPTY_DRAFT: NewNoteDraft = {
  title: '',
  content: '',
  summary: '',
  tags: [],
}

const sameDraft = (left: NewNoteDraft, right: NewNoteDraft): boolean =>
  left.title === right.title &&
  left.content === right.content &&
  left.summary === right.summary &&
  left.tags.length === right.tags.length &&
  left.tags.every((tag, index) => tag === right.tags[index])

export default function NewNoteScreen() {
  const add = useNotesStore((state) => state.add)
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const router = useRouter()
  const [draft, setDraft] = useState<NewNoteDraft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [leaveConfirmation, setLeaveConfirmation] = useState(false)
  const [allowLeave, setAllowLeave] = useState(false)
  const pendingAction = useRef<(() => void) | null>(null)
  const dirty = !sameDraft(draft, EMPTY_DRAFT)

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

  const save = async () => {
    if (draft.content.trim().length === 0) {
      setError('Treść notatki nie może być pusta.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await add({
        title: draft.title.trim(),
        content: draft.content.trim(),
        summary: draft.summary.trim() || null,
        tags: draft.tags,
        audioUri: null,
        durationMs: null,
      })
      goToList()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  const discardAndLeave = () => {
    setLeaveConfirmation(false)
    setAllowLeave(true)
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Nowa notatka',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={goToList}
              accessibilityRole="button"
              accessibilityLabel="Anuluj tworzenie notatki"
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
              disabled={!dirty || saving}
              accessibilityRole="button"
              accessibilityLabel="Zapisz notatkę"
              accessibilityState={{ disabled: !dirty || saving, busy: saving }}
              style={({ pressed }) => [
                styles.headerSave,
                { opacity: !dirty || saving ? 0.4 : pressed ? 0.65 : 1 },
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
        <Text style={[styles.intro, { color: colors.muted }]}>
          Zapisz myśl, do której chcesz wrócić.
        </Text>
        {error && (
          <Text style={[styles.body, { color: colors.danger }]}>{error}</Text>
        )}
        <Field
          label="Tytuł"
          value={draft.title}
          onChangeText={(title) =>
            setDraft((current) => ({ ...current, title }))
          }
          placeholder="Bez tytułu"
        />
        <Field
          label="Treść"
          value={draft.content}
          onChangeText={(content) =>
            setDraft((current) => ({ ...current, content }))
          }
          placeholder="Wpisz treść notatki"
          multiline
          minHeight={190}
        />
        <Field
          label="Podsumowanie"
          value={draft.summary}
          onChangeText={(summary) =>
            setDraft((current) => ({ ...current, summary }))
          }
          placeholder="Opcjonalne"
          multiline
          minHeight={100}
        />
        <NoteTags
          tags={draft.tags}
          onChange={(tags) => setDraft((current) => ({ ...current, tags }))}
          editable
        />
      </ScrollView>

      <BottomSheet
        visible={leaveConfirmation}
        onClose={() => {
          pendingAction.current = null
          setLeaveConfirmation(false)
        }}
        title="Odrzucić notatkę?"
      >
        <Text style={[styles.body, { color: colors.muted }]}>
          Wpisana treść nie została zapisana.
        </Text>
        <Button
          label="Odrzuć treść"
          variant="danger"
          icon="trash"
          onPress={discardAndLeave}
        />
        <Button
          label="Kontynuuj edycję"
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
  container: { padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.xl },
  intro: { ...type.body },
  body: { ...type.body },
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
})
