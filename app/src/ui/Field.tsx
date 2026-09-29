import { StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native'
import { colors, spacing, type } from './theme'

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

// Keep long dictated text easy to scan and edit without boxing every field.
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
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        editable={editable}
        style={[
          styles.input,
          multiline && styles.multiline,
          minHeight !== undefined && { minHeight },
          !editable && styles.readOnly,
          textStyle,
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: {
    ...type.label,
    color: colors.navy,
  },
  input: {
    ...type.body,
    color: colors.ink,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  multiline: { textAlignVertical: 'top' },
  readOnly: { color: colors.muted },
})
