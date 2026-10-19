import { useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../state/settingsStore'
import { radius, spacing, type, useTheme, fonts } from '../ui/theme'
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
  const autoTasks = useSettingsStore((state) => state.autoTaskSuggestions)
  const saveAutoTasks = useSettingsStore((state) => state.setAutoTaskSuggestions)
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
  const chooseAutoTasks = async (value: boolean) => {
    try {
      await saveAutoTasks(value)
    } catch {
      setMessage(t('Nie udało się zapisać ustawienia.', 'The setting could not be saved.'))
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
        style={[styles.heading, { color: colors.muted }]}
      >
        {t('Opracowanie notatek', 'Note processing')}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        {[
          {
            value: false,
            label: t('Szybko, przy otwartej aplikacji', 'Fast, with the app open'),
            detail: t(
              'Postęp zapisuje się, jeśli na chwilę wyjdziesz.',
              'Progress is saved if you leave for a moment.',
            ),
          },
          {
            value: true,
            label: t('W tle', 'In the background'),
            detail: t(
              'Wolniej, ale działa też przy zablokowanym ekranie.',
              'Slower, but keeps going with the screen locked.',
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
            <View style={[styles.radio, { borderColor: enabled === option.value ? colors.ink : colors.faint }]}>
              {enabled === option.value && <View style={[styles.radioDot, { backgroundColor: colors.ink }]} />}
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, { color: colors.ink }]}>
                {option.label}
              </Text>
              <Text style={[styles.detail, { color: colors.muted }]}>
                {option.detail}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={[styles.card, styles.row, { backgroundColor: colors.paper, borderColor: colors.line }]}>
        <View style={styles.copy}>
          <Text style={[styles.label, { color: colors.ink }]}>
            {t('Proponuj zadania od razu', 'Suggest tasks right away')}
          </Text>
          <Text style={[styles.detail, { color: colors.muted }]}>
            {t(
              'Po opracowaniu notatki zadania czekają na Twój wybór.',
              'After a note is processed, tasks wait for your choice.',
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel={t('Proponuj zadania od razu', 'Suggest tasks right away')}
          value={autoTasks}
          onValueChange={(value) => void chooseAutoTasks(value)}
          trackColor={{ false: colors.line, true: colors.brand }}
          thumbColor={autoTasks ? colors.onBrand : colors.paper}
          ios_backgroundColor={colors.line}
        />
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
          <Text style={[styles.label, { color: colors.ink, textDecorationLine: 'underline' }]}>
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
  section: { gap: spacing.sm },
  heading: { ...type.label, fontSize: 13, lineHeight: 18, marginLeft: 4 },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 72,
  },
  copy: { flex: 1, gap: 4 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  label: { fontSize: 16, lineHeight: 21, fontFamily: fonts.medium },
  detail: { fontSize: 13, lineHeight: 19 },
  notify: { minHeight: 44, justifyContent: 'center' },
})
