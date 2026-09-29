import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, spacing, type } from './theme'

interface HeaderProps {
  back?: { title?: string }
  navigation: { goBack: () => void }
  options: {
    title?: string
    headerBackVisible?: boolean
    headerRight?: (props: {
      tintColor?: ColorValue
      canGoBack?: boolean
      backgroundColor?: ColorValue
    }) => ReactNode
  }
  route: { name: string }
}

export function AppHeader({ back, navigation, options, route }: HeaderProps) {
  const insets = useSafeAreaInsets()
  const showBack = Boolean(back) && options.headerBackVisible !== false
  const title = options.title ?? route.name

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {showBack && (
          <Pressable
            onPress={navigation.goBack}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Wróć"
          >
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
        )}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {options.headerRight?.({
          tintColor: colors.navy,
          canGoBack: showBack,
          backgroundColor: colors.paper,
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line },
  row: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  back: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  backArrow: { color: colors.navy, fontSize: 28, lineHeight: 36 },
  title: { ...type.title, color: colors.ink, fontSize: 20, lineHeight: 26, flex: 1 },
})
