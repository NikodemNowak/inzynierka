import { StyleSheet, Text, View } from 'react-native'
import { getModelMissingMessage } from '../../ai/noteProcessing'
import type { Note } from '../../domain/note'
import { useI18n } from '../../i18n/useI18n'
import { supportsBackgroundProcessing } from '../../processing/nativeProcessing'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Separator } from '../../ui/Grouped'
import { Icon } from '../../ui/Icon'
import { font, spacing, type, useTheme } from '../../ui/theme'

// "Opracować na nowo?": what the model will prepare before the comparison.
export function ReprocessConfirmSheet({ visible, note, modelReady, disabled, onStart, onClose }: {
  visible: boolean
  note: Note
  modelReady: boolean
  disabled: boolean
  onStart: (background?: boolean) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const rows = [
    { label: t('Streszczenie', 'Summary'), detail: note.summary?.trim() ? t('zastąpi obecne, jeśli wybierzesz', 'replaces the current one if you choose') : t('notatka nie ma jeszcze streszczenia', 'the note has no summary yet') },
    { label: t('Tytuł', 'Title'), detail: `„${note.title.trim() || t('Bez tytułu', 'Untitled')}”` },
    { label: t('Kategorie', 'Categories'), detail: note.tags.length ? t(`teraz: ${note.tags.length}`, `now: ${note.tags.length}`) : t('teraz brak', 'none yet') },
  ]
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('Opracować na nowo?', 'Process again?')}>
      {visible && (
        <>
          <Text style={[styles.message, { color: colors.secondary }]}>
            {t(
              'Model przeczyta transkrypt jeszcze raz i przygotuje propozycję. Potem porównasz ją z obecną wersją i wybierzesz, co zmienić.',
              'The model reads the transcript again and prepares a suggestion. Then you compare it with the current version and choose what to change.',
            )}
          </Text>
          <View style={{ gap: spacing.sm }}>
            <Text style={[styles.caption, { color: colors.secondary }]}>
              {t('Co przygotuję', 'What I will prepare')}
            </Text>
            <View style={[styles.group, { backgroundColor: colors.group }]}>
              {rows.map((row, index) => (
                <View key={row.label}>
                  {index > 0 && <Separator />}
                  <View style={styles.row}>
                    <Text style={[type.body, { color: colors.ink, ...font.semibold }]}>{row.label}</Text>
                    <Text style={[type.meta, { color: colors.secondary }]} numberOfLines={1}>{row.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.offline}>
            <Icon name="lock" size={18} color={colors.secondary} />
            <Text style={[type.meta, { color: colors.secondary, flex: 1 }]}>
              {t('Działa na telefonie, bez internetu. Możesz w tym czasie wrócić do listy.', 'Runs on this phone, without internet. You can go back to the list meanwhile.')}
            </Text>
          </View>
          <Button
            label={t('Przygotuj propozycję', 'Prepare suggestion')}
            variant="primary"
            onPress={() => onStart()}
            disabled={disabled}
          />
          {supportsBackgroundProcessing() && (
            <Button
              label={t('Przygotuj w tle', 'Prepare in the background')}
              variant="secondary"
              onPress={() => onStart(true)}
              disabled={disabled}
            />
          )}
          {supportsBackgroundProcessing() && (
            <Text style={[type.meta, { color: colors.secondary }]}>
              {t(
                'Tryb w tle używa CPU i może być wolniejszy. iOS pokazuje postęp.',
                'Background mode uses the CPU and may be slower. iOS shows progress.',
              )}
            </Text>
          )}
          <Button label={t('Anuluj', 'Cancel')} variant="quiet" onPress={onClose} />
          {!modelReady && (
            <Text style={[type.meta, { color: colors.secondary }]}>
              {getModelMissingMessage()}
            </Text>
          )}
        </>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  message: { ...type.body },
  caption: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.3, marginHorizontal: 4 },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
