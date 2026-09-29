import { Text, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { Button } from './Button'
import { type, useTheme } from './theme'

export function EmptyState({
  icon = 'note',
  title,
  description,
  action,
}: {
  icon?: IconName
  title: string
  description: string
  action?: { label: string; onPress: () => void }
}) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
        paddingBottom: 56,
        gap: 14,
      }}
    >
      <View
        style={{
          width: 76,
          height: 82,
          borderRadius: 24,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <Icon name={icon} size={34} color={colors.accent} />
      </View>
      <Text
        accessibilityRole="header"
        style={{
          ...type.title,
          fontSize: 23,
          lineHeight: 29,
          color: colors.ink,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          ...type.body,
          color: colors.muted,
          textAlign: 'center',
          maxWidth: 290,
        }}
      >
        {description}
      </Text>
      {action && (
        <Button
          label={action.label}
          onPress={action.onPress}
          style={{ marginTop: 8 }}
        />
      )}
    </View>
  )
}
