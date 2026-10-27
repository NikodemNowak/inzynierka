import { useEffect, useRef } from 'react'
import { Animated, Easing, type ColorValue } from 'react-native'
import { useReducedMotion } from './Motion'

// Small dot with a slow opacity pulse; static when reduced motion is on.
export function PulseDot({
  color,
  size = 8,
}: {
  color: ColorValue
  size?: number
}) {
  const reduced = useReducedMotion()
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, opacity])
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
      }}
    />
  )
}
