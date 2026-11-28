import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useTheme, font } from './theme'
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
  compact?: boolean
}
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  style,
  icon,
  compact = false,
}: ButtonProps) {
  const { colors } = useTheme()
  const inactive = disabled || busy
  const foreground =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
        ? colors.red
        : colors.accent
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        {
          minHeight: compact ? 36 : 50,
          borderRadius: 12,
          paddingVertical: compact ? 6 : 13,
          paddingHorizontal: compact ? 14 : 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            variant === 'primary'
              ? colors.accent
              : variant === 'secondary'
                ? colors.tint
                : 'transparent',
          opacity: inactive ? 0.45 : 1,
          transform: [{ scale: pressed && !inactive ? 0.98 : 1 }],
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
            fontSize: compact ? 15 : 17,
            lineHeight: 22,
            ...font.semibold,
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
