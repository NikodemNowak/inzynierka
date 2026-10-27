import { useI18n } from '../../i18n/useI18n'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { Stack, useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { ErrorCard } from '../../ui/ErrorCard'
import { Field } from '../../ui/Field'
import { spacing, type, useTheme } from '../../ui/theme'
import { useNotesStore } from '../../state/notesStore'
import { NoteTags } from '../../tags/NoteTags'
import { useSettingsStore } from '../../state/settingsStore'
import { LanguagePicker } from '../../ui/LanguagePicker'
import type { Language } from '../../i18n/language'

interface NewNoteDraft {
  language: Language
  title: string
  content: string
  summary: string
  tags: string[]
}

const EMPTY_DRAFT: NewNoteDraft = {
  language: 'pl',
  title: '',
  content: '',
  summary: '',
  tags: [],
}

const sameDraft = (left: NewNoteDraft, right: NewNoteDraft): boolean =>
  left.language === right.language &&
  left.title === right.title &&
  left.content === right.content &&
  left.summary === right.summary &&
  left.tags.length === right.tags.length &&
  left.tags.every((tag, index) => tag === right.tags[index])

export default function NewNoteScreen() {
  const add = useNotesStore((state) => state.add)
  const { colors } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const router = useRouter()
  const defaultLanguage = useSettingsStore((state) => state.noteLanguage)
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const initializedLanguage = useRef(settingsLoaded)
  const initialDraft = useRef<NewNoteDraft>({
    ...EMPTY_DRAFT,
    language: defaultLanguage,
  })
  const [draft, setDraft] = useState<NewNoteDraft>(initialDraft.current)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [leaveConfirmation, setLeaveConfirmation] = useState(false)
  const [allowLeave, setAllowLeave] = useState(false)
  const pendingAction = useRef<(() => void) | null>(null)
  const dirty = !sameDraft(draft, initialDraft.current)

  useEffect(() => {
    if (!settingsLoaded || initializedLanguage.current) return
    initializedLanguage.current = true
    const nextDraft = { ...EMPTY_DRAFT, language: defaultLanguage }
    initialDraft.current = nextDraft
    setDraft(nextDraft)
  }, [defaultLanguage, settingsLoaded])

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
      setError(
        t(
          'Treść notatki nie może być pusta.',
          'The note content cannot be empty.',
        ),
      )
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
        language: draft.language,
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

  if (!settingsLoaded || !initializedLanguage.current) return null

  return (
    <>
      <Stack.Screen
        options={{
          title: t('Nowa notatka', 'New note'),
          headerBackVisible: false,
          headerLeft: () => (
            <Button
              compact
              variant="quiet"
              label={t('Anuluj', 'Cancel')}
              onPress={goToList}
            />
          ),
          headerRight: () => (
            <Button
              compact
              variant="primary"
              label={t('Zapisz', 'Save')}
              onPress={() => void save()}
              disabled={!dirty || saving}
              busy={saving}
            />
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
          {t(
            'Zapisz myśl, do której chcesz wrócić.',
            'Save a thought you want to return to.',
          )}
        </Text>
        {error && (
          <ErrorCard message={error} />
        )}
        <LanguagePicker
          value={draft.language}
          onChange={(language) =>
            setDraft((current) => ({ ...current, language }))
          }
          disabled={saving}
        />
        <Field
          label={t('Tytuł', 'Title')}
          value={draft.title}
          onChangeText={(title) =>
            setDraft((current) => ({ ...current, title }))
          }
          placeholder={t('Bez tytułu', 'Untitled')}
        />
        <Field
          label={t('Treść', 'Content')}
          value={draft.content}
          onChangeText={(content) =>
            setDraft((current) => ({ ...current, content }))
          }
          placeholder={t('Wpisz treść notatki', 'Write your note')}
          multiline
          minHeight={190}
        />
        <Field
          label={t('Podsumowanie', 'Summary')}
          value={draft.summary}
          onChangeText={(summary) =>
            setDraft((current) => ({ ...current, summary }))
          }
          placeholder={t('Opcjonalne', 'Optional')}
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
        title={t('Odrzucić notatkę?', 'Discard the note?')}
      >
        <Text style={[styles.body, { color: colors.muted }]}>
          {t(
            'Wpisana treść nie została zapisana.',
            'Your text has not been saved.',
          )}
        </Text>
        <Button
          label={t('Odrzuć treść', 'Discard text')}
          variant="danger"
          icon="trash"
          onPress={discardAndLeave}
        />
        <Button
          label={t('Kontynuuj edycję', 'Continue editing')}
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
  titleField: { ...type.display, fontSize: 24, lineHeight: 34 },
  body: { ...type.body },
})
