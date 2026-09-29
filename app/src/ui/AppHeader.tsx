import { useState, type ReactNode } from 'react'
import { Text, View, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconButton } from './Icon'
import { useTheme } from './theme'

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
        borderBottomWidth: 0.5,
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
            <IconButton
              name="chevron-left"
              label="Wróć"
              onPress={navigation.goBack}
              size={25}
            />
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
              style={{
                fontSize: 17,
                lineHeight: 24,
                fontWeight: '600',
                color: colors.ink,
              }}
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
    </View>
  )
}
