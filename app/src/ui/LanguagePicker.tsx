import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Language } from '../i18n/language'
import { useI18n } from '../i18n/useI18n'
import { radius, spacing, type, useTheme } from './theme'

export function LanguagePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Language
  onChange: (language: Language) => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.muted }]}>
        {t('Język notatki', 'Note language')}
      </Text>
      <View
        style={[styles.options, { backgroundColor: colors.surface }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('Język notatki', 'Note language')}
      >
        {(['pl', 'en'] as const).map((language) => (
          <Pressable
            key={language}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === language, disabled }}
            disabled={disabled}
            onPress={() => onChange(language)}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor:
                  value === language ? colors.raised : 'transparent',
                opacity: disabled ? 0.65 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.text,
                { color: value === language ? colors.accent : colors.muted },
              ]}
            >
              {language === 'pl' ? 'Polski' : 'English'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { ...type.label },
  options: { flexDirection: 'row', padding: 4, borderRadius: radius.md },
  option: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  text: { ...type.label },
})
