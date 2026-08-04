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

// A labelled rule instead of a box. The note screen is mostly text the user
// dictated; boxing every part of it turns a record into a form.
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
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
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
  container: { gap: spacing.xs },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
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
