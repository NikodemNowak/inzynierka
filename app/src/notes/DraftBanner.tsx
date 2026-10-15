import { useI18n } from '../i18n/useI18n'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useDraftStore } from '../state/draftStore'
import { useNotesStore } from '../state/notesStore'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'

export function DraftBanner() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const draft = useDraftStore((state) => state.draft)
  const clear = useDraftStore((state) => state.clear)
  const add = useNotesStore((state) => state.add)
  const [busy, setBusy] = useState(false)
  if (!draft) return null
  const keep = async () => {
    setBusy(true)
    try {
      await add({
        title:
          draft.language === 'en'
            ? 'Interrupted recording'
            : 'Przerwane nagranie',
        content: draft.transcript,
        summary: null,
        tags: [],
        audioUri: null,
        durationMs: null,
        language: draft.language ?? 'pl',
      })
      await clear()
    } catch {
      Alert.alert(
        t('Nie zapisano notatki', 'Note not saved'),
        t(
          'Odzyskany tekst nadal czeka tutaj. Spróbuj ponownie.',
          'Your recovered text is still here. Try again.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  const discard = () =>
    Alert.alert(
      t('Odrzucić odzyskany tekst?', 'Discard recovered text?'),
      t(
        'Ten szkic nie został jeszcze zapisany jako notatka.',
        'This draft has not been saved as a note yet.',
      ),
      [
        { text: t('Zachowaj', 'Keep'), style: 'cancel' },
        {
          text: t('Odrzuć', 'Discard'),
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            void clear()
              .catch(() =>
                Alert.alert(
                  t('Nie odrzucono szkicu', 'Draft not discarded'),
                  t('Spróbuj ponownie.', 'Try again.'),
                ),
              )
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  return (
    <View
      style={{
        marginHorizontal: 24,
        marginBottom: 14,
        padding: 16,
        borderRadius: 16,
        backgroundColor: colors.paper,
        borderWidth: 1,
        borderColor: colors.line,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="note" color={colors.accent} size={21} />
        <Text style={{ ...type.label, color: colors.ink }}>
          {t('Odzyskane nagranie', 'Recovered recording')}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{ ...type.body, fontSize: 14, color: colors.body }}
      >
        {draft.transcript}
      </Text>
      <Text style={{ ...type.meta, color: colors.muted }}>
        {t(
          'Zachowano tekst. Audio jest niedostępne.',
          'Text recovered. Audio is unavailable.',
        )}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label={t('Zapisz notatkę', 'Save note')}
          onPress={() => void keep()}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <Button
          label={t('Odrzuć', 'Discard')}
          variant="danger"
          onPress={discard}
          disabled={busy}
        />
      </View>
    </View>
  )
}
