import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useI18n } from '../../i18n/useI18n'
import { Icon } from '../../ui/Icon'
import { type, useTheme } from '../../ui/theme'

// "Tekst nagrania ›": the transcript stays folded until asked for.
export function TranscriptRow({ content, hasAudio }: { content: string; hasAudio: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const text = content.trim()
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.row, { backgroundColor: colors.group, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.label, { color: colors.ink }]}>{t('Tekst nagrania', 'Recording text')}</Text>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevron-right" size={16} color={colors.faint} />
        </View>
      </Pressable>
      {open && (
        <View style={[styles.card, { backgroundColor: colors.group }]}>
          <Text selectable style={[styles.transcript, { color: text ? colors.ink : colors.secondary }]}>
            {text ||
              (hasAudio
                ? t('To nagranie nie ma jeszcze transkrypcji.', 'This recording has no transcript yet.')
                : t('Brak transkrypcji', 'No transcript'))}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 14, gap: 8 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  label: { ...type.body },
  card: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 },
  transcript: { ...type.body, lineHeight: 24 },
})
