import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { radius, useTheme, fonts } from './theme'
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
        : colors.ink
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        {
          minHeight: variant === 'primary' ? 54 : 48,
          borderRadius: radius.pill,
          paddingVertical: 13,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            variant === 'primary'
              ? colors.action
              : variant === 'secondary'
                ? colors.paper
                : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.line,
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
            fontSize: variant === 'primary' ? 16 : 15,
            lineHeight: 22,
            fontFamily: fonts.semibold,
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
