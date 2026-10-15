import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../state/settingsStore'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme } from '../ui/theme'
import {
  nativeProcessing,
  requestCompletionNotifications,
  supportsBackgroundProcessing,
} from './nativeProcessing'

export function ProcessingSettingsSection() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const enabled = useSettingsStore((state) => state.backgroundProcessing)
  const save = useSettingsStore((state) => state.setBackgroundProcessing)
  const available = supportsBackgroundProcessing()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const choose = async (value: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await save(value)
      setMessage(null)
    } catch {
      setMessage(
        t(
          'Nie udało się zapisać ustawienia.',
          'The setting could not be saved.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  const notifications = async () => {
    try {
      const granted = await requestCompletionNotifications()
      setMessage(
        granted
          ? t('Powiadomienia są włączone.', 'Notifications are enabled.')
          : t(
              'Zgodę na powiadomienia możesz zmienić w ustawieniach systemu.',
              'You can change notification permission in system settings.',
            ),
      )
    } catch {
      setMessage(
        t(
          'Nie udało się włączyć powiadomień.',
          'Notifications could not be enabled.',
        ),
      )
    }
  }
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.ink }]}
      >
        {t('Opracowanie notatek', 'Note processing')}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.line },
        ]}
      >
        {[
          {
            value: false,
            label: t('Szybko, w otwartej aplikacji', 'Fast, with the app open'),
            detail: t(
              'Po schowaniu aplikacji postęp zostaje zachowany.',
              'Progress is saved if you leave the app.',
            ),
          },
          {
            value: true,
            label: t('Kontynuuj w tle', 'Continue in the background'),
            detail: t(
              'Tryb CPU. Może potrwać dłużej; iOS pokazuje postęp.',
              'CPU mode. May take longer; iOS shows progress.',
            ),
          },
        ].map((option) => (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{
              checked: enabled === option.value,
              disabled: busy || (option.value && !available),
            }}
            disabled={busy || (option.value && !available)}
            onPress={() => void choose(option.value)}
            style={[
              styles.row,
              option.value && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.line,
              },
              option.value && !available && { opacity: 0.5 },
            ]}
          >
            <View style={styles.copy}>
              <Text style={[styles.label, { color: colors.ink }]}>
                {option.label}
              </Text>
              <Text style={[styles.detail, { color: colors.muted }]}>
                {option.detail}
              </Text>
            </View>
            {enabled === option.value && (
              <Icon name="check" color={colors.accent} size={20} />
            )}
          </Pressable>
        ))}
      </View>
      {!available && (
        <Text style={[styles.detail, { color: colors.muted }]}>
          {t(
            'Ten system lub build nie udostępnia opracowania w tle.',
            'This system or build does not provide background processing.',
          )}
        </Text>
      )}
      {nativeProcessing && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void notifications()}
          style={styles.notify}
        >
          <Text style={[styles.label, { color: colors.accent }]}>
            {t('Powiadomienia o ukończeniu', 'Completion notifications')}
          </Text>
        </Pressable>
      )}
      {message && (
        <Text
          accessibilityRole="alert"
          style={[styles.detail, { color: colors.muted }]}
        >
          {message}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginBottom: spacing.xl },
  heading: { ...type.title },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
  },
  copy: { flex: 1, gap: 5 },
  label: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 19 },
  notify: { minHeight: 44, justifyContent: 'center' },
})
