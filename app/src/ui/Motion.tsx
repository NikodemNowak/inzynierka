import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Icon } from './Icon'
import { useTheme } from './theme'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value)
    })
    const listener = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    )
    return () => {
      active = false
      listener.remove()
    }
  }, [])
  return reduced
}
export function ProcessingIndicator({
  label = 'Opracowuję notatkę…',
}: {
  label?: string
}) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const opacity = useRef(new Animated.Value(1)).current
  const labelOpacity = useRef(new Animated.Value(1)).current
  const [displayLabel, setDisplayLabel] = useState(label)
  useEffect(() => {
    if (displayLabel === label) return
    if (reduced) {
      setDisplayLabel(label)
      labelOpacity.setValue(1)
      return
    }
    const fadeOut = Animated.timing(labelOpacity, {
      toValue: 0,
      duration: 110,
      useNativeDriver: true,
    })
    fadeOut.start(({ finished }) => {
      if (finished) setDisplayLabel(label)
    })
    return () => fadeOut.stop()
  }, [label, displayLabel, reduced, labelOpacity])
  useEffect(() => {
    const fadeIn = Animated.timing(labelOpacity, {
      toValue: 1,
      duration: reduced ? 0 : 180,
      useNativeDriver: true,
    })
    fadeIn.start()
    return () => fadeIn.stop()
  }, [displayLabel, reduced, labelOpacity])
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, opacity])
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
      }}
    >
      <Animated.View style={{ opacity }}>
        <Icon name="sparkles" size={22} color={colors.accent} />
      </Animated.View>
      <Animated.Text
        numberOfLines={2}
        style={{
          opacity: labelOpacity,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: '500',
          color: colors.ink,
          flexShrink: 1,
        }}
      >
        {displayLabel}
      </Animated.Text>
    </View>
  )
}
export function SkeletonText({
  lines = 3,
  title = false,
  animate = true,
}: {
  lines?: number
  title?: boolean
  animate?: boolean
}) {
  const { colors, isDark } = useTheme()
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(0)).current
  const [width, setWidth] = useState(300)
  useEffect(() => {
    if (reduced || !animate) return
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => {
      loop.stop()
      progress.setValue(0)
    }
  }, [progress, reduced, animate])
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ gap: title ? 9 : 8 }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <View
          key={i}
          style={{
            height: title ? 29 : 16,
            width: i === 0 ? '100%' : i === lines - 1 ? '68%' : '88%',
            borderRadius: 8,
            backgroundColor: colors.accentSoft,
            overflow: 'hidden',
          }}
        >
          {!reduced && animate && (
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: width * 0.7,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-width * 0.7, width],
                    }),
                  },
                ],
              }}
            >
              <LinearGradient
                colors={
                  isDark
                    ? ['#22395200', '#789BB43D', '#9B96D42B', '#22395200']
                    : ['#E8F0FC00', '#FFFFFFB3', '#C9CAEC6B', '#E8F0FC00']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.4 }}
                style={{ flex: 1 }}
              />
            </Animated.View>
          )}
        </View>
      ))}
    </View>
  )
}
export function fadedTextColor(hex: string, opacity: number): string {
  const color = /^#[\da-f]{6}$/i.test(hex) ? hex : '#49576A'
  const red = parseInt(color.slice(1, 3), 16)
  const green = parseInt(color.slice(3, 5), 16)
  const blue = parseInt(color.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, opacity))})`
}
// Virtual text spans need a React commit to rebuild attributed text on Fabric.
// A single bounded clock reveals letters without changing layout or kerning.
export function RevealText({
  text,
  animate = false,
  style,
}: {
  text: string
  animate?: boolean
  style?: StyleProp<TextStyle>
}) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const styleColor = StyleSheet.flatten(style)?.color
  const color = typeof styleColor === 'string' ? styleColor : colors.body
  const [progress, setProgress] = useState(1)
  const [running, setRunning] = useState(false)
  useLayoutEffect(() => {
    if (!animate || reduced) {
      setProgress(1)
      setRunning(false)
      return
    }
    setProgress(0)
    setRunning(true)
    const duration = Math.min(1400, 720 + text.length * 1.2)
    const startsAt = Date.now() + 100
    let frame: number
    const tick = () => {
      const next = Math.max(0, Math.min(1, (Date.now() - startsAt) / duration))
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
      else setRunning(false)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate, text, reduced])
  if (!running || reduced || !animate) return <Text style={style}>{text}</Text>
  const characters = Array.from(text)
  const length = Math.min(characters.length, 320)
  return (
    <Text style={style} accessible accessibilityLabel={text}>
      {characters.slice(0, length).map((character, i) => {
        const start = (i / Math.max(1, length)) * 0.65
        return (
          <Text
            key={i}
            style={{
              color: fadedTextColor(color, (progress - start) / 0.28),
            }}
          >
            {character}
          </Text>
        )
      })}
      {characters.length > length && (
        <Text style={{ color: fadedTextColor(color, progress) }}>
          {characters.slice(length).join('')}
        </Text>
      )}
    </Text>
  )
}
