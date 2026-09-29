import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg'
import { Icon } from '../ui/Icon'
import { RevealText, useReducedMotion } from '../ui/Motion'
import { useTheme } from '../ui/theme'

const WAVE = [12, 21, 34, 48, 63, 48, 34, 20, 15, 29, 17, 9]
const SMALL_WAVE = [
  8, 15, 23, 29, 21, 25, 17, 25, 21, 12, 7, 5, 10, 18, 30, 23, 26, 17, 22, 13,
  6, 11, 8, 20, 28, 20, 13, 9,
]

export function OnboardingIllustration({
  page,
  active,
  appActive,
}: {
  page: 0 | 1 | 2
  active: boolean
  appActive: boolean
}) {
  const reduced = useReducedMotion()
  const animate = active && appActive && !reduced
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        [
          'Fala głosu zamienia się w prywatną notatkę',
          'Słowa pojawiają się w notatce podczas mówienia',
          'Z nagrania powstają tytuł i krótkie podsumowanie',
        ][page]
      }
      style={styles.scene}
    >
      {page === 0 ? (
        <VoiceNoteArt />
      ) : page === 1 ? (
        <DictationArt animate={animate} />
      ) : (
        <SummaryArt />
      )}
    </View>
  )
}

function ArtworkDefs() {
  const { isDark } = useTheme()
  return (
    <Defs>
      <LinearGradient id="card" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={isDark ? '#23343F' : '#FFFFFF'} />
        <Stop offset="1" stopColor={isDark ? '#1C2933' : '#FDFEFF'} />
      </LinearGradient>
      <LinearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={isDark ? '#9CCBFA' : '#70B4FC'} />
        <Stop offset="1" stopColor={isDark ? '#5C9DE8' : '#246FCC'} />
      </LinearGradient>
      <LinearGradient id="ribbon" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#78B9FA" stopOpacity="0" />
        <Stop
          offset="55%"
          stopColor="#78B9FA"
          stopOpacity={isDark ? 0.24 : 0.4}
        />
        <Stop offset="1" stopColor="#78B9FA" stopOpacity="0" />
      </LinearGradient>
      <RadialGradient id="glow">
        <Stop
          offset="0"
          stopColor="#70B6FB"
          stopOpacity={isDark ? '.10' : '.15'}
        />
        <Stop offset="1" stopColor="#70B6FB" stopOpacity="0" />
      </RadialGradient>
    </Defs>
  )
}

function Mic({ x, y }: { x: number; y: number }) {
  const { isDark } = useTheme()
  return (
    <G transform={`translate(${x} ${y})`}>
      <Circle cx="0" cy="0" r="23" fill={isDark ? '#2C4E6B' : '#DEEEFF'} />
      <Path
        d="M-4-10a4 4 0 0 1 8 0v9a4 4 0 0 1-8 0ZM-8-2v1a8 8 0 0 0 16 0v-1M0 7v6M-4 13h8"
        stroke={isDark ? '#A3D0FC' : '#2C7BD3'}
        strokeWidth="2.1"
        strokeLinecap="round"
        fill="none"
      />
    </G>
  )
}

function VoiceNoteArt() {
  const { isDark } = useTheme()
  return (
    <Svg width="100%" height="100%" viewBox="0 0 360 280">
      <ArtworkDefs />
      <Ellipse cx="248" cy="160" rx="140" ry="114" fill="url(#glow)" />
      <Path
        d="M139 160C185 65 211 99 264 154L267 208C205 125 185 138 139 160Z"
        fill="url(#ribbon)"
      />
      <Path
        d="M135 161C175 122 180 160 208 184S241 185 269 167"
        stroke="url(#blue)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      {WAVE.map((height, i) => (
        <Rect
          key={i}
          x={3 + i * 12}
          y={158 - height * 1.08}
          width="5.8"
          height={height * 2.16}
          rx="2.9"
          fill="url(#blue)"
        />
      ))}
      <G transform="rotate(-4 281 154)">
        <Rect
          x="215"
          y="66"
          width="141"
          height="184"
          rx="17"
          fill={isDark ? '#050C12' : '#C1DFF8'}
          opacity=".13"
        />
        <Rect
          x="213"
          y="59"
          width="141"
          height="184"
          rx="17"
          fill="url(#card)"
          stroke={isDark ? '#344957' : '#F5FAFF'}
          strokeWidth="1"
        />
        <Mic x={252} y={99} />
        {[104, 94, 69, 83].map((width, i) => (
          <Rect
            key={i}
            x="232"
            y={139 + i * 19}
            width={width}
            height="8"
            rx="4"
            fill={isDark ? '#496373' : '#C9DDF2'}
          />
        ))}
      </G>
    </Svg>
  )
}

function DictationArt({ animate }: { animate: boolean }) {
  const { colors, isDark } = useTheme()
  const wave = useRef(new Animated.Value(0)).current
  const hasRevealed = useRef(false)
  const [revealTail, setRevealTail] = useState(false)
  useLayoutEffect(() => {
    if (animate && !hasRevealed.current) {
      hasRevealed.current = true
      setRevealTail(true)
    } else if (!animate) setRevealTail(false)
  }, [animate])
  useEffect(() => {
    if (!animate) {
      wave.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wave, {
          toValue: 0,
          duration: 940,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [animate, wave])
  return (
    <View
      style={[
        styles.dictation,
        {
          backgroundColor: isDark ? '#1D2C36' : '#FFFFFF',
          borderColor: isDark ? '#2B404F' : '#EDF5FF',
          shadowColor: isDark ? '#020A11' : '#92BFEF',
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.micBadge,
            { backgroundColor: isDark ? '#2B4D69' : '#E0EEFF' },
          ]}
        >
          <Icon name="mic" size={24} color={colors.accent} />
        </View>
        <Text
          maxFontSizeMultiplier={1.15}
          style={[styles.time, { color: colors.muted }]}
        >
          00:12
        </Text>
      </View>
      <Text
        maxFontSizeMultiplier={1.15}
        style={[styles.transcript, { color: colors.body }]}
      >
        Spotkanie z promotorem dotyczyło kolejnych kroków w projekcie.{' '}
        <RevealText
          text="Omówiliśmy plan na najbliższe tygodnie"
          animate={revealTail}
          style={{ color: colors.accent }}
        />
      </Text>
      <View style={styles.wave}>
        {SMALL_WAVE.map((height, i) => (
          <Animated.View
            key={i}
            style={{
              width: 3,
              height,
              borderRadius: 2,
              backgroundColor: colors.accent,
              opacity: 0.35 + (i % 5) * 0.12,
              transform: [
                {
                  scaleY: wave.interpolate({
                    inputRange: [0, 1],
                    outputRange: i % 3 === 0 ? [0.7, 1.15] : [1, 0.65],
                  }),
                },
              ],
            }}
          />
        ))}
      </View>
    </View>
  )
}

function SummaryArt() {
  const { colors, isDark } = useTheme()
  const line = isDark ? '#506979' : '#D1DFEE'
  return (
    <Svg width="100%" height="100%" viewBox="0 0 360 280">
      <ArtworkDefs />
      <Ellipse cx="236" cy="159" rx="143" ry="122" fill="url(#glow)" />
      <G transform="rotate(-5 77 176)">
        <Rect
          x="4"
          y="100"
          width="138"
          height="158"
          rx="15"
          fill="url(#card)"
          stroke={isDark ? '#334956' : '#EDF6FF'}
        />
        <Rect x="21" y="119" width="65" height="8" rx="4" fill={line} />
        <SvgText
          x="21"
          y="149"
          fill={colors.ink}
          fontSize="13"
          fontWeight="600"
        >
          Spotkanie
        </SvgText>
        <SvgText
          x="21"
          y="167"
          fill={colors.ink}
          fontSize="13"
          fontWeight="600"
        >
          z promotorem
        </SvgText>
        {[101, 101, 80].map((width, i) => (
          <Rect
            key={i}
            x="21"
            y={186 + i * 17}
            width={width}
            height="8"
            rx="4"
            fill={line}
          />
        ))}
      </G>
      <Path
        d="M77 108C91 54 136 51 158 76"
        fill="none"
        stroke="url(#blue)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <Path
        d="m149 77 13-1-3-13"
        fill="none"
        stroke="url(#blue)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <G transform="rotate(4 261 158)">
        <Rect
          x="176"
          y="53"
          width="175"
          height="221"
          rx="16"
          fill="url(#card)"
          stroke={isDark ? '#334956' : '#F0F7FF'}
        />
        <Rect x="195" y="74" width="86" height="8" rx="4" fill={line} />
        <SvgText
          x="195"
          y="113"
          fill={colors.ink}
          fontSize="15"
          fontWeight="600"
        >
          Tytuł
        </SvgText>
        <SvgText x="195" y="136" fill={colors.body} fontSize="11.5">
          Spotkanie z promotorem
        </SvgText>
        <Rect x="195" y="151" width="102" height="7" rx="3.5" fill={line} />
        <SvgText
          x="195"
          y="189"
          fill={colors.ink}
          fontSize="13"
          fontWeight="600"
        >
          Podsumowanie
        </SvgText>
        {[108, 85, 71].map((width, i) => (
          <G key={i}>
            <Circle cx="199" cy={207 + i * 19} r="3.5" fill={colors.accent} />
            <Rect
              x="213"
              y={203 + i * 19}
              width={width}
              height="8"
              rx="4"
              fill={line}
            />
          </G>
        ))}
      </G>
      <Path
        d="M326 28c2.7 12 5 14.3 17 17-12 2.7-14.3 5-17 17-2.7-12-5-14.3-17-17 12-2.7 14.3-5 17-17ZM303 53c1.8 8.8 3.5 10.5 12.3 12.3-8.8 1.8-10.5 3.5-12.3 12.3-1.8-8.8-3.5-10.5-12.3-12.3 8.8-1.8 10.5-3.5 12.3-12.3Z"
        fill="url(#blue)"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dictation: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 17,
    padding: 20,
    gap: 12,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  micBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontSize: 14, fontVariant: ['tabular-nums'] },
  transcript: { fontSize: 18, lineHeight: 27 },
  wave: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
})
