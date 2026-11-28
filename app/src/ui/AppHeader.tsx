import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { Icon } from './Icon'
import { type, useTheme } from './theme'
import { RecordingBanner } from '../stt/RecordingBanner'

interface HeaderButtonProps {
  tintColor?: ColorValue
  canGoBack?: boolean
  backgroundColor?: ColorValue
}
interface HeaderProps {
  back?: { title?: string }
  navigation: { goBack: () => void }
  options: {
    title?: string
    headerBackVisible?: boolean
    headerTitle?:
      | string
      | ((props: { children: string; tintColor?: string }) => ReactNode)
    headerRight?: (props: HeaderButtonProps) => ReactNode
    headerLeft?: (props: HeaderButtonProps) => ReactNode
  }
  route: { name: string }
}
export function AppHeader({ back, navigation, options, route }: HeaderProps) {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const showBack = Boolean(back) && options.headerBackVisible !== false
  const title = options.title ?? route.name
  const [leftWidth, setLeftWidth] = useState(44)
  const [rightWidth, setRightWidth] = useState(44)
  const sideWidth = Math.max(44, leftWidth, rightWidth)
  const props = {
    tintColor: colors.accent,
    canGoBack: showBack,
    backgroundColor: colors.canvas,
  }
  return (
    <View
      style={{
        backgroundColor: colors.canvas,
        paddingTop: insets.top,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.line,
      }}
    >
      <View
        style={{
          minHeight: 54,
          justifyContent: 'center',
          paddingHorizontal: sideWidth + 12,
        }}
      >
        <View
          onLayout={(e) => setLeftWidth(e.nativeEvent.layout.width)}
          style={{
            position: 'absolute',
            left: 8,
            zIndex: 1,
            justifyContent: 'center',
          }}
        >
          {options.headerLeft ? (
            options.headerLeft(props)
          ) : showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                back?.title
                  ? t(`Wróć do ${back.title}`, `Back to ${back.title}`)
                  : t('Wróć', 'Back')
              }
              onPress={navigation.goBack}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 44,
                opacity: pressed ? 0.55 : 1,
              })}
            >
              <Icon name="chevron-left" size={22} color={colors.accent} />
              {back?.title ? (
                <Text
                  numberOfLines={1}
                  style={{ ...type.body, color: colors.accent, maxWidth: 120 }}
                >
                  {back.title}
                </Text>
              ) : null}
            </Pressable>
          ) : null}
        </View>
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 6,
          }}
        >
          {typeof options.headerTitle === 'function' ? (
            options.headerTitle({ children: title, tintColor: colors.ink })
          ) : (
            <Text
              numberOfLines={1}
              accessibilityRole="header"
              style={{ ...type.title, color: colors.ink }}
            >
              {typeof options.headerTitle === 'string'
                ? options.headerTitle
                : title}
            </Text>
          )}
        </View>
        <View
          onLayout={(e) => setRightWidth(e.nativeEvent.layout.width)}
          style={{
            position: 'absolute',
            right: 8,
            zIndex: 1,
            justifyContent: 'center',
          }}
        >
          {options.headerRight?.(props)}
        </View>
      </View>
      <RecordingBanner inset={false} />
    </View>
  )
}
