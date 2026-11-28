import { Text, TextInput, View, type TextStyle } from 'react-native'
import { type, useTheme } from './theme'

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
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...type.caption, color: colors.secondary, marginLeft: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accent}
        multiline={multiline}
        editable={editable}
        clearButtonMode="never"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        style={[
          {
            ...type.body,
            color: editable ? colors.ink : colors.secondary,
            backgroundColor: colors.field,
            paddingHorizontal: 16,
            paddingVertical: 12,
            minHeight: minHeight ?? 46,
            borderRadius: 12,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          textStyle,
        ]}
      />
    </View>
  )
}
