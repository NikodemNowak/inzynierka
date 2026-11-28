import { Pressable, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'

// Entry to the notes chat, above the list.
export function AskCard({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginHorizontal: 16,
        marginTop: 14,
        paddingTop: 14,
        paddingBottom: 16,
        paddingLeft: 16,
        paddingRight: 14,
        borderRadius: 14,
        backgroundColor: colors.tint,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="chat" size={20} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.title, color: colors.onTint }}>
          {t('Zapytaj notatki', 'Ask your notes')}
        </Text>
        <Text style={{ ...type.meta, color: colors.secondary }}>
          {t(
            'np. „Co mam jutro?”, „Ile wyniósł budżet?”',
            'e.g. “What\'s on tomorrow?”, “What was the budget?”',
          )}
        </Text>
      </View>
      <Icon name="chevron-right" size={14} color={colors.onTint} />
    </Pressable>
  )
}
