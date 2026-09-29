import { useLayoutEffect, useState } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { interpolateTranscriptColor } from '../stt/liveTranscriptAnimation'
import { fadedTextColor } from '../ui/Motion'
import { useTheme } from '../ui/theme'

const TEXT =
  'Spotkanie z promotorem dotyczyło kolejnych kroków w projekcie. Omówiliśmy plan na najbliższe tygodnie.'
const LETTERS = Array.from(TEXT)
const START_DELAY = 400
const LETTER_INTERVAL = 44
const LETTER_REVEAL = 180
const FRESH_HOLD = 450
const COLOR_SETTLE = 600
const SETTLED_AT =
  START_DELAY +
  (LETTERS.length - 1) * LETTER_INTERVAL +
  FRESH_HOLD +
  COLOR_SETTLE
const FADE_AT = SETTLED_AT + 2200
const FADE_DURATION = 260
const CYCLE_DURATION = FADE_AT + FADE_DURATION + 400

// A single clock belongs to this small illustration, never to the whole page.
// Full text reserves its layout, so the card stays still throughout each loop.
export function DictationDemo({
  animate,
  style,
}: {
  animate: boolean
  style?: StyleProp<TextStyle>
}) {
  const { colors } = useTheme()
  const [elapsed, setElapsed] = useState(0)
  useLayoutEffect(() => {
    if (!animate) return
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const cycleTime = (Date.now() - startedAt) % CYCLE_DURATION
      setElapsed(cycleTime)
      const nextFrame =
        cycleTime >= SETTLED_AT && cycleTime < FADE_AT
          ? FADE_AT - cycleTime
          : 33
      timer = setTimeout(tick, nextFrame)
    }
    tick()
    return () => clearTimeout(timer)
  }, [animate])

  if (!animate)
    return (
      <Text style={style} maxFontSizeMultiplier={1.15}>
        {TEXT}
      </Text>
    )

  const exitOpacity = Math.max(0, 1 - (elapsed - FADE_AT) / FADE_DURATION)
  return (
    <Text style={style} maxFontSizeMultiplier={1.15}>
      {LETTERS.map((character, index) => {
        const age = elapsed - START_DELAY - index * LETTER_INTERVAL
        const opacity = Math.min(1, Math.max(0, age / LETTER_REVEAL))
        const color = interpolateTranscriptColor(
          colors.accent,
          colors.body,
          (age - FRESH_HOLD) / COLOR_SETTLE,
        )
        return (
          <Text
            key={index}
            style={{ color: fadedTextColor(color, opacity * exitOpacity) }}
          >
            {character}
          </Text>
        )
      })}
    </Text>
  )
}
