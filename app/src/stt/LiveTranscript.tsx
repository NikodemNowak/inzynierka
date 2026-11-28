import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'
import { useReducedMotion } from '../ui/Motion'
import { useTheme } from '../ui/theme'
import {
  buildTranscriptFrame,
  getTranscriptColorProgress,
  interpolateTranscriptColor,
  transcriptSettleTime,
  type TranscriptFrame,
  type TranscriptLetter,
} from './liveTranscriptAnimation'

interface LiveTranscriptProps {
  text: string
  animate?: boolean
  style?: StyleProp<TextStyle>
}

export const LiveTranscript = memo(function LiveTranscript({
  text,
  animate = true,
  style,
}: LiveTranscriptProps) {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const previousTextRef = useRef('')
  const previousTailRef = useRef(new Map<number, TranscriptLetter>())
  const [frame, setFrame] = useState<TranscriptFrame>({ prefix: '', tail: [] })
  const [clockNow, setClockNow] = useState(0)

  useLayoutEffect(() => {
    if (!animate || reducedMotion) {
      previousTextRef.current = text
      previousTailRef.current.clear()
      setFrame({ prefix: text, tail: [] })
      setClockNow(Date.now())
      return
    }

    if (text === previousTextRef.current) return

    const now = Date.now()
    const nextFrame = buildTranscriptFrame(
      previousTextRef.current,
      previousTailRef.current,
      text,
      now,
    )
    previousTextRef.current = text
    previousTailRef.current = new Map(
      nextFrame.tail.map((letter) => [letter.index, letter]),
    )
    setFrame(nextFrame)
    setClockNow(now)
  }, [animate, reducedMotion, text])

  // One timer per new frame: the newest words turn from secondary to text color
  // once, with no per-frame JS animation.
  useEffect(() => {
    if (!animate || reducedMotion) return
    const settleAt = transcriptSettleTime(frame.tail)
    if (settleAt === null) return
    const timer = setTimeout(
      () => setClockNow(Date.now()),
      Math.max(0, settleAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [animate, frame, reducedMotion])

  const styleColor = StyleSheet.flatten(style)?.color
  const textColor = typeof styleColor === 'string' ? styleColor : colors.ink
  return (
    <Text style={style} accessible accessibilityLabel={text}>
      {frame.prefix}
      {frame.tail.map((letter) => {
        const progress = getTranscriptColorProgress(letter, clockNow)
        return (
          <Text
            key={`${letter.index}:${letter.character}`}
            style={{
              color: interpolateTranscriptColor(colors.secondary, textColor, progress),
            }}
          >
            {letter.character}
          </Text>
        )
      })}
    </Text>
  )
})
