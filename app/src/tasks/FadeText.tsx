import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native'

// Task text arrives with a short fade and a 6 px settle; no letter clocks.
export function FadeText({ text, animate = false, style, active = true, numberOfLines, onRevealComplete, delayMs = 0 }: {
  text: string
  animate?: boolean
  style?: StyleProp<TextStyle>
  active?: boolean
  numberOfLines?: number
  onRevealComplete?: (text: string) => void
  delayMs?: number
}) {
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current
  const complete = useRef(onRevealComplete)
  complete.current = onRevealComplete
  useEffect(() => {
    if (!animate || !active) {
      progress.setValue(1)
      return
    }
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 260, delay: delayMs, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    })
    animation.start(({ finished }) => { if (finished) complete.current?.(text) })
    return () => {
      animation.stop()
      progress.setValue(1)
    }
  }, [animate, active, text, delayMs, progress])
  return (
    <Animated.Text
      numberOfLines={numberOfLines}
      style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
    >
      {text}
    </Animated.Text>
  )
}
