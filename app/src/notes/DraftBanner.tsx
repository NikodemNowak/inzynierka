import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useDraftStore } from '../state/draftStore'
import { useNotesStore } from '../state/notesStore'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'

export function DraftBanner() {
  const { colors } = useTheme()
  const draft = useDraftStore((state) => state.draft)
  const clear = useDraftStore((state) => state.clear)
  const add = useNotesStore((state) => state.add)
  const [busy, setBusy] = useState(false)
  if (!draft) return null
  const keep = async () => {
    setBusy(true)
    try {
      await add({
        title: 'Przerwane nagranie',
        content: draft.transcript,
        summary: null,
        tags: [],
        audioUri: null,
        durationMs: null,
      })
      await clear()
    } catch {
      Alert.alert(
        'Nie zapisano notatki',
        'Odzyskany tekst nadal czeka tutaj. Spróbuj ponownie.',
      )
    } finally {
      setBusy(false)
    }
  }
  const discard = () =>
    Alert.alert(
      'Odrzucić odzyskany tekst?',
      'Ten szkic nie został jeszcze zapisany jako notatka.',
      [
        { text: 'Zachowaj', style: 'cancel' },
        {
          text: 'Odrzuć',
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            void clear()
              .catch(() =>
                Alert.alert('Nie odrzucono szkicu', 'Spróbuj ponownie.'),
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
          Odzyskane nagranie
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{ ...type.body, fontSize: 14, color: colors.body }}
      >
        {draft.transcript}
      </Text>
      <Text style={{ ...type.meta, color: colors.muted }}>
        Zachowano tekst. Audio jest niedostępne.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Zapisz notatkę"
          onPress={() => void keep()}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <Button
          label="Odrzuć"
          variant="danger"
          onPress={discard}
          disabled={busy}
        />
      </View>
    </View>
  )
}
