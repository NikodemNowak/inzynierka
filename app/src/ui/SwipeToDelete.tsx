import { useRef, type ReactNode } from 'react'
import { Animated, Easing, PanResponder, Pressable, Text, View } from 'react-native'
import { font, useTheme } from './theme'

const REVEAL = 88

// Drag a row left to reveal a delete action; the core PanResponder keeps it free of gesture libraries.
export function SwipeToDelete({ children, label, actionText, onDelete, disabled = false }: {
  children: ReactNode
  label: string
  actionText: string
  onDelete: () => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const offset = useRef(new Animated.Value(0)).current
  const open = useRef(false)
  const settle = (to: number) => {
    open.current = to !== 0
    Animated.timing(offset, { toValue: to, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !disabled && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderMove: (_, gesture) => {
      const base = open.current ? -REVEAL : 0
      offset.setValue(Math.min(0, Math.max(-REVEAL * 1.4, base + gesture.dx)))
    },
    onPanResponderRelease: (_, gesture) => {
      const base = open.current ? -REVEAL : 0
      settle(base + gesture.dx < -REVEAL / 2 ? -REVEAL : 0)
    },
    onPanResponderTerminate: () => settle(open.current ? -REVEAL : 0),
  })).current
  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: REVEAL, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.danger }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => { settle(0); onDelete() }}
          style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ ...font.semibold, fontSize: 14, color: colors.onAccent }}>{actionText}</Text>
        </Pressable>
      </View>
      <Animated.View
        {...responder.panHandlers}
        accessibilityActions={[{ name: 'delete', label }]}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'delete') onDelete() }}
        style={{ backgroundColor: colors.paper, transform: [{ translateX: offset }] }}
      >
        {children}
      </Animated.View>
    </View>
  )
}
