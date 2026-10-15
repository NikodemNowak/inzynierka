import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { radius, useTheme } from './theme'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'
interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
  icon?: IconName
}
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  style,
  icon,
}: ButtonProps) {
  const { colors } = useTheme()
  const inactive = disabled || busy
  const foreground =
    variant === 'primary'
      ? colors.onAction
      : variant === 'danger'
        ? colors.danger
        : colors.accent
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        {
          minHeight: 50,
          borderRadius: radius.md,
          paddingVertical: 13,
          paddingHorizontal: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            variant === 'primary'
              ? colors.action
              : variant === 'secondary'
                ? colors.accentSoft
                : 'transparent',
          opacity: inactive ? 0.45 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : icon ? (
          <Icon name={icon} size={20} color={foreground} />
        ) : null}
        <Text
          style={{
            color: foreground,
            fontSize: 15,
            lineHeight: 22,
            fontWeight: '600',
            flexShrink: 1,
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )
}
