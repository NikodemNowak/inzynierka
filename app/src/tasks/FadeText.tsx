import { useEffect, useRef } from 'react'
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native'

// Task text arrives with a plain 200 ms fade; no letter clocks, no stagger.
export function FadeText({ text, animate = false, style, active = true, numberOfLines, onRevealComplete }: {
  text: string
  animate?: boolean
  style?: StyleProp<TextStyle>
  active?: boolean
  numberOfLines?: number
  onRevealComplete?: (text: string) => void
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
      toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    })
    animation.start(({ finished }) => { if (finished) complete.current?.(text) })
    return () => {
      animation.stop()
      progress.setValue(1)
    }
  }, [animate, active, text, progress])
  return (
    <Animated.Text
      numberOfLines={numberOfLines}
      style={[style, { opacity: progress }]}
    >
      {text}
    </Animated.Text>
  )
}
