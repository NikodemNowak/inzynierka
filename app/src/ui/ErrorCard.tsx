import { Text, View } from 'react-native'
import { radius, type, useTheme } from './theme'

// Paper card with a hairline and a small danger dot; no tinted error fills.
export function ErrorCard({ message }: { message: string }) {
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        padding: 14,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.paper,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 8,
          backgroundColor: colors.danger,
        }}
      />
      <Text style={{ ...type.body, color: colors.body, flex: 1 }}>
        {message}
      </Text>
    </View>
  )
}
