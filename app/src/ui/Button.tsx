import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { colors, radius, spacing } from './theme'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  busy?: boolean
  style?: ViewStyle
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  style,
}: ButtonProps) {
  const inactive = disabled || busy
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      <View style={styles.content}>
        {busy && <ActivityIndicator size="small" color={variant === 'primary' ? colors.paper : colors.navy} />}
        <Text style={[styles.label, textStyles[variant], inactive && styles.inactiveLabel]}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primary: { backgroundColor: colors.navy, borderColor: colors.navy },
  secondary: { backgroundColor: colors.paper, borderColor: colors.line },
  danger: { backgroundColor: colors.paper, borderColor: '#F0CFCF' },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent', paddingVertical: spacing.sm },
  // Opacity rather than a second palette: the button keeps its identity while
  // clearly not being available.
  pressed: { opacity: 0.72 },
  inactive: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: '600' },
  inactiveLabel: {},
})

const textStyles = StyleSheet.create({
  primary: { color: colors.paper },
  secondary: { color: colors.navy },
  danger: { color: colors.danger },
  quiet: { color: colors.navy },
})
