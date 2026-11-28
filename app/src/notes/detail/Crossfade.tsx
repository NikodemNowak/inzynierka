import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

export const CROSSFADE_MS = 200

// Fades the new content in over the previous one when `id` changes; the first
// render and reduced motion swap instantly.
export function Crossfade({ id, active, reducedMotion, style, children }: {
  id: string
  active: boolean
  reducedMotion: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const progress = useRef(new Animated.Value(1)).current
  const last = useRef({ id, node: children })
  const [outgoing, setOutgoing] = useState<ReactNode>(null)
  useLayoutEffect(() => {
    const previous = last.current
    last.current = { id, node: children }
    if (previous.id === id) return
    progress.stopAnimation()
    if (!active || reducedMotion) {
      progress.setValue(1)
      setOutgoing(null)
      return
    }
    progress.setValue(0)
    setOutgoing(previous.node)
    Animated.timing(progress, { toValue: 1, duration: CROSSFADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setOutgoing(null) })
  })
  return (
    <View style={[style, outgoing ? styles.clipped : undefined]}>
      <Animated.View style={{ opacity: progress }}>{children}</Animated.View>
      {outgoing ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
        >
          {outgoing}
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  clipped: { overflow: 'hidden' },
})
