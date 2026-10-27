import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useColorScheme } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import Svg, { Path, Rect } from 'react-native-svg'

// Keep the system splash up until this overlay has painted the same picture.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

// The mark is drawn in the 70x92 units of the icon's page (x 24-94, y 18-110);
// at 150 pt wide it matches the native splash's imageWidth exactly.
const WIDTH = 150
const K = WIDTH / 70
const HEIGHT = 92 * K
const u = (value: number): number => value * K
const BARS = [[36, 62, 6], [43, 59, 12], [50, 57, 16], [57, 60, 10], [64, 58, 14], [71, 62, 6]] as const

const BACKGROUND = { light: '#F7F6F2', dark: '#141416' } as const

function Mark({ highlight }: { highlight: Animated.Value }) {
  return (
    <View style={{ width: WIDTH, height: HEIGHT }}>
      <Svg width={WIDTH} height={HEIGHT} viewBox="24 18 70 92" style={StyleSheet.absoluteFill}>
        <Path d="M32 22h40l16 16v60a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill="#F7F6F2" stroke="#DDD9CF" strokeWidth={0.5} />
        <Path d="M72 22v12a4 4 0 0 0 4 4h12z" fill="#D6D2C6" />
        <Rect x={34} y={44} width={36} height={5} rx={2.5} fill="#C9C6BE" />
        <Rect x={34} y={82} width={28} height={5} rx={2.5} fill="#C9C6BE" />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute', left: u(30 - 24), top: u(56 - 18), width: u(55), height: u(18),
          transformOrigin: 'left', transform: [{ scaleX: highlight }],
        }}
      >
        <Svg width={u(55)} height={u(18)} viewBox="30 56 55 18">
          <Path d="M30 56h52l3 18H30z" fill="#FFE066" />
        </Svg>
      </Animated.View>
      <Svg width={WIDTH} height={HEIGHT} viewBox="24 18 70 92" style={StyleSheet.absoluteFill}>
        {BARS.map(([x, y, h]) => <Rect key={x} x={x} y={y} width={4} height={h} rx={2} fill="#18181B" />)}
      </Svg>
    </View>
  )
}

// One gesture: the highlighter sweeps across the voice, then the page fades into the app.
export function StartSplash({ ready }: { ready: boolean }) {
  // The native splash follows the phone's theme, not the in-app preference.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const [done, setDone] = useState(false)
  const [painted, setPainted] = useState(false)
  const highlight = useRef(new Animated.Value(0)).current
  const leave = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!painted || !ready) return
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduced) => {
      if (cancelled) return
      if (reduced) highlight.setValue(1)
      const out = Animated.timing(leave, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true })
      const sequence = reduced ? out : Animated.sequence([
        Animated.timing(highlight, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(140),
        out,
      ])
      sequence.start(() => { if (!cancelled) setDone(true) })
    })
    return () => { cancelled = true }
  }, [painted, ready, highlight, leave])

  if (done) return null
  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      onLayout={() => {
        if (painted) return
        setPainted(true)
        void SplashScreen.hideAsync().catch(() => undefined)
      }}
      style={[StyleSheet.absoluteFill, styles.center, {
        backgroundColor: BACKGROUND[scheme],
        opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      }]}
    >
      <Animated.View style={{ transform: [{ scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
        <Mark highlight={highlight} />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})
