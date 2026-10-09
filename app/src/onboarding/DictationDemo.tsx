import { useLayoutEffect, useState } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { interpolateTranscriptColor } from '../stt/liveTranscriptAnimation'
import { fadedTextColor } from '../ui/Motion'
import { useTheme } from '../ui/theme'

const START_DELAY = 400
const LETTER_INTERVAL = 44
const LETTER_REVEAL = 180
const FRESH_HOLD = 450
const COLOR_SETTLE = 600
const FADE_DURATION = 260

// A single clock belongs to this small illustration, never to the whole page.
// Full text reserves its layout, so the card stays still throughout each loop.
export function DictationDemo({
  animate,
  style,
}: {
  animate: boolean
  style?: StyleProp<TextStyle>
}) {
  const { t } = useI18n()
  const text = t(
    'Spotkanie z promotorem dotyczyło kolejnych kroków w projekcie. Omówiliśmy plan na najbliższe tygodnie.',
    'The meeting with my advisor covered the next steps in the project. We discussed the plan for the coming weeks.',
  )
  const letters = Array.from(text)
  const settledAt =
    START_DELAY +
    (letters.length - 1) * LETTER_INTERVAL +
    FRESH_HOLD +
    COLOR_SETTLE
  const fadeAt = settledAt + 2200
  const cycleDuration = fadeAt + FADE_DURATION + 400
  const { colors } = useTheme()
  const [elapsed, setElapsed] = useState(0)
  useLayoutEffect(() => {
    setElapsed(0)
    if (!animate) return
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const cycleTime = (Date.now() - startedAt) % cycleDuration
      setElapsed(cycleTime)
      const nextFrame =
        cycleTime >= settledAt && cycleTime < fadeAt ? fadeAt - cycleTime : 33
      timer = setTimeout(tick, nextFrame)
    }
    tick()
    return () => clearTimeout(timer)
  }, [animate, text, cycleDuration, settledAt, fadeAt])

  if (!animate)
    return (
      <Text style={style} maxFontSizeMultiplier={1.15}>
        {text}
      </Text>
    )

  const exitOpacity = Math.max(0, 1 - (elapsed - fadeAt) / FADE_DURATION)
  return (
    <Text style={style} maxFontSizeMultiplier={1.15}>
      {letters.map((character, index) => {
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
