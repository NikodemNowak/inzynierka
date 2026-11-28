import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { type, useTheme } from './theme'

export function Separator({ inset = 16 }: { inset?: number }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        marginLeft: inset,
        backgroundColor: colors.line,
      }}
    />
  )
}

// Static lists only (settings, sheets, note): inserts a separator between rows.
export function Group({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const items = Children.toArray(children).filter(
    (child) => child !== null && child !== undefined && typeof child !== 'boolean',
  )
  return (
    <View
      style={[
        { backgroundColor: colors.group, borderRadius: 12, overflow: 'hidden' },
        style,
      ]}
    >
      {items.map((child, index) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : index}>
          {index > 0 && <Separator />}
          {child}
        </Fragment>
      ))}
    </View>
  )
}

export function Row({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  numberOfLines = 1,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
  onPress?: () => void
  numberOfLines?: number
  accessibilityLabel?: string
  accessibilityHint?: string
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const content = (pressed: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 16,
        opacity: disabled ? 0.48 : pressed ? 0.6 : 1,
      }}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={numberOfLines} style={{ ...type.body, color: colors.ink }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ ...type.meta, color: colors.secondary }}>{subtitle}</Text>
        ) : null}
      </View>
      {trailing}
    </View>
  )
  if (!onPress) return content(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  )
}

export function SectionTitle({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'red'
}) {
  const { colors } = useTheme()
  return (
    <Text
      accessibilityRole="header"
      style={{
        ...type.section,
        color: tone === 'red' ? colors.red : colors.ink,
        marginTop: 22,
        marginHorizontal: 4,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  )
}
