import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, useColorScheme } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import Svg, { Path, Rect } from 'react-native-svg'
import { fonts } from './theme'

// Keep the system splash up until this overlay has painted the same picture.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

// The mark is drawn in the 70x92 units of the icon's page (x 24-94, y 18-110);
// at 150 pt wide it matches the native splash's imageWidth exactly.
const WIDTH = 150
const K = WIDTH / 70
const HEIGHT = 92 * K
const u = (value: number): number => value * K
const BARS = [[36, 62, 6], [43, 59, 12], [50, 57, 16], [57, 60, 10], [64, 58, 14], [71, 62, 6]] as const

const PAPER = '#F7F6F2'
const BACKGROUND = { light: '#F7F6F2', dark: '#141416' } as const

function Mark({ bars, highlight }: { bars: Animated.Value; highlight: Animated.Value }) {
  return (
    <View style={{ width: WIDTH, height: HEIGHT }}>
      <Svg width={WIDTH} height={HEIGHT} viewBox="24 18 70 92" style={StyleSheet.absoluteFill}>
        <Path d="M32 22h40l16 16v60a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill={PAPER} />
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
      {BARS.map(([x, y, h], index) => (
        <Animated.View
          key={x}
          style={{
            position: 'absolute', left: u(x - 24), top: u(y - 18), width: u(4), height: u(h), borderRadius: u(2),
            backgroundColor: '#18181B',
            transform: [{ scaleY: bars.interpolate({
              inputRange: [0, 0.25, 0.5, 0.75, 1],
              outputRange: index % 2 ? [1, 0.55, 1.5, 0.8, 1] : [1, 1.6, 0.6, 1.3, 1],
            }) }],
          }}
        />
      ))}
    </View>
  )
}

export function StartSplash({ ready }: { ready: boolean }) {
  // The native splash follows the phone's theme, not the in-app preference.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const [done, setDone] = useState(false)
  const [painted, setPainted] = useState(false)
  const bars = useRef(new Animated.Value(0)).current
  const highlight = useRef(new Animated.Value(1)).current
  const word = useRef(new Animated.Value(0)).current
  const under = useRef(new Animated.Value(0)).current
  const leave = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!painted || !ready) return
    let cancelled = false
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduced) => {
      if (cancelled) return
      const out = Animated.timing(leave, { toValue: 1, duration: reduced ? 220 : 320, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      const sequence = reduced ? out : Animated.sequence([
        Animated.parallel([
          Animated.timing(bars, { toValue: 1, duration: 560, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(highlight, { toValue: 0, duration: 120, useNativeDriver: true }),
            Animated.timing(highlight, { toValue: 1, duration: 380, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(260),
            Animated.timing(word, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(under, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(120),
        out,
      ])
      sequence.start(() => { if (!cancelled) setDone(true) })
    })
    return () => { cancelled = true }
  }, [painted, ready, bars, highlight, word, under, leave])

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
      <Animated.View style={{ transform: [
        { scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
        { translateY: leave.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) },
      ] }}
      >
        <Mark bars={bars} highlight={highlight} />
      </Animated.View>
      <Animated.View style={[styles.word, { opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
        <Animated.View style={[styles.under, { transform: [{ scaleX: under }] }]} />
        <Text style={[styles.wordText, { color: scheme === 'dark' ? '#EDEBE6' : '#18181B' }]}>Notatki</Text>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  // Below the mark, so the mark stays exactly where the native splash put it.
  word: { position: 'absolute', top: '50%', marginTop: HEIGHT / 2 + 24 },
  under: { position: 'absolute', left: -6, right: -6, bottom: 4, height: 14, borderRadius: 3, backgroundColor: '#FFE066', transformOrigin: 'left' },
  wordText: { fontFamily: fonts.serif, fontSize: 36, lineHeight: 46 },
})
