import { Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRecordingBannerVisible } from '../stt/RecordingBanner'
import { useI18n } from '../i18n/useI18n'
import { Icon } from './Icon'
import { type, useTheme } from './theme'

export function ScreenTitle({ title, right }: { title: string; right?: ReactNode }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const bannerVisible = useRecordingBannerVisible()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 20,
        paddingRight: 12,
        paddingTop: (bannerVisible ? 0 : insets.top) + 8,
      }}
    >
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{ ...type.display, color: colors.ink, flex: 1 }}
      >
        {title}
      </Text>
      {right}
    </View>
  )
}

export function SettingsButton() {
  const { t } = useI18n()
  const { colors } = useTheme()
  const router = useRouter()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Ustawienia', 'Settings')}
      onPress={() => router.push('/settings')}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.field,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="settings" size={20} color={colors.ink} />
    </Pressable>
  )
}
