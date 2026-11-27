import { useI18n } from '../i18n/useI18n'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { useDraftStore } from '../state/draftStore'
import { useNotesStore } from '../state/notesStore'
import { Button } from '../ui/Button'
import { BottomSheet } from '../ui/BottomSheet'
import { Icon } from '../ui/Icon'
import { radius, type, useTheme } from '../ui/theme'

export function DraftBanner() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const draft = useDraftStore((state) => state.draft)
  const clear = useDraftStore((state) => state.clear)
  const add = useNotesStore((state) => state.add)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
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
      setFailure(
        t(
          'Nie zapisano notatki. Odzyskany tekst nadal czeka tutaj, spróbuj ponownie.',
          'Note not saved. Your recovered text is still here, try again.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    setConfirming(false)
    setBusy(true)
    void clear()
      .catch(() =>
        setFailure(
          t(
            'Nie odrzucono szkicu. Spróbuj ponownie.',
            'Draft not discarded. Try again.',
          ),
        ),
      )
      .finally(() => setBusy(false))
  }
  return (
    <View
      style={{
        marginHorizontal: 24,
        marginBottom: 14,
        padding: 16,
        borderRadius: radius.lg,
        backgroundColor: colors.paper,
        borderWidth: 1,
        borderColor: colors.line,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="note" color={colors.ink} size={21} />
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
          'Zachowano tekst. Audio jest niedostÄ™pne.',
          'Text recovered. Audio is unavailable.',
        )}
      </Text>
      {failure && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.danger,
            }}
          />
          <Text style={{ ...type.meta, color: colors.body, flex: 1 }}>
            {failure}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label={t('Zapisz notatkÄ™', 'Save note')}
          onPress={() => void keep()}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <Button
          label={t('OdrzuÄ‡', 'Discard')}
          variant="danger"
          onPress={() => setConfirming(true)}
          disabled={busy}
        />
      </View>
      <BottomSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('Odrzucić odzyskany tekst?', 'Discard recovered text?')}
      >
        <Text style={{ ...type.body, color: colors.body }}>
          {t(
            'Ten szkic nie został jeszcze zapisany jako notatka.',
            'This draft has not been saved as a note yet.',
          )}
        </Text>
        <Button label={t('Odrzuć', 'Discard')} variant="danger" onPress={discard} />
        <Button
          label={t('Zachowaj', 'Keep')}
          variant="quiet"
          onPress={() => setConfirming(false)}
        />
      </BottomSheet>
    </View>
  )
}
