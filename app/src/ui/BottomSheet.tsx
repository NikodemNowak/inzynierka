import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { IconButton } from './Icon'
import { useReducedMotion } from './Motion'
import { type, useTheme } from './theme'

// The dim fades in on its own while the panel springs up, so the backdrop never slides.
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
  const { height } = useWindowDimensions()
  const [mounted, setMounted] = useState(visible)
  const dim = useRef(new Animated.Value(0)).current
  const offset = useRef(new Animated.Value(height)).current

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  useEffect(() => {
    if (!mounted) return
    if (visible) {
      if (reduced) {
        offset.setValue(0)
        Animated.timing(dim, { toValue: 1, duration: 160, useNativeDriver: true }).start()
        return
      }
      offset.setValue(height)
      Animated.parallel([
        Animated.timing(dim, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(offset, { toValue: 0, damping: 20, stiffness: 210, mass: 0.9, useNativeDriver: true }),
      ]).start()
      return
    }
    Animated.parallel([
      Animated.timing(dim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(offset, { toValue: reduced ? 0 : height, duration: reduced ? 1 : 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setMounted(false) })
  }, [visible, mounted, reduced, height, dim, offset])

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: dim }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Zamknij panel', 'Close panel')}
            onPress={onClose}
            style={{ flex: 1, backgroundColor: colors.overlay }}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={{
            maxHeight: '88%',
            backgroundColor: colors.paper,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY: offset }],
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 5,
              borderRadius: 3,
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
              paddingTop: 12,
            }}
          >
            <Text style={{ ...type.display, fontSize: 26, lineHeight: 32, color: colors.ink, flex: 1 }}>
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
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
