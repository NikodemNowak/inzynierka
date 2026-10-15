import { useState } from 'react'
import { Text, TextInput, View, type TextStyle } from 'react-native'
import { radius, type, useTheme } from './theme'

interface FieldProps {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  multiline?: boolean
  minHeight?: number
  editable?: boolean
  textStyle?: TextStyle
}
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  minHeight,
  editable = true,
  textStyle,
}: FieldProps) {
  const { colors, isDark } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ ...type.label, color: colors.ink }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        multiline={multiline}
        editable={editable}
        clearButtonMode="never"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            ...type.body,
            color: editable ? colors.ink : colors.muted,
            backgroundColor: colors.paper,
            padding: 13,
            paddingTop: 13,
            minHeight: minHeight ?? 50,
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.line,
            borderRadius: radius.md,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          textStyle,
        ]}
      />
    </View>
  )
}
