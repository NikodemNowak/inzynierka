import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { IconButton } from './Icon'
import { useReducedMotion } from './Motion'
import { type, useTheme } from './theme'

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  return (
    <Modal
      transparent
      visible={visible}
      animationType={reduced ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Zamknij panel', 'Close panel')}
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.overlay,
          }}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: '88%',
            backgroundColor: colors.canvas,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 34,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line,
              marginTop: 10,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 24,
              paddingRight: 12,
              paddingTop: 9,
            }}
          >
            <Text style={{ ...type.title, color: colors.ink, flex: 1 }}>
              {title}
            </Text>
            <IconButton
              name="close"
              label={t('Zamknij', 'Close')}
              onPress={onClose}
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24, paddingTop: 12, gap: 16 }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
