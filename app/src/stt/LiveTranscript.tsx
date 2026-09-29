import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'
import { fadedTextColor, useReducedMotion } from '../ui/Motion'
import { useTheme } from '../ui/theme'
import {
  buildTranscriptFrame,
  getTranscriptLetterAlpha,
  getTranscriptColorProgress,
  interpolateTranscriptColor,
  LETTER_COLOR_SETTLE_MS,
  type TranscriptFrame,
  type TranscriptLetter,
} from './liveTranscriptAnimation'

interface LiveTranscriptProps {
  text: string
  finalizedText?: string
  animate?: boolean
  style?: StyleProp<TextStyle>
  interimStyle?: StyleProp<TextStyle>
}

export function LiveTranscript({
  text,
  finalizedText = '',
  animate = true,
  style,
  interimStyle,
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

  useEffect(() => {
    if (
      !animate ||
      reducedMotion ||
      !frame.tail.some((letter) => letter.startedAt !== null)
    )
      return

    let active = true
    let animationFrame: number
    const tick = () => {
      if (!active) return
      const now = Date.now()
      setClockNow(now)
      const stillRevealing = frame.tail.some(
        (letter) =>
          letter.startedAt !== null &&
          now < letter.startedAt + LETTER_COLOR_SETTLE_MS,
      )
      if (stillRevealing) animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(animationFrame)
    }
  }, [animate, frame, reducedMotion])

  const styleColor = StyleSheet.flatten(style)?.color
  const textColor = typeof styleColor === 'string' ? styleColor : colors.body
  const interimStyleColor = StyleSheet.flatten(interimStyle)?.color
  const interimColor =
    typeof interimStyleColor === 'string' ? interimStyleColor : textColor
  const characters = Array.from(frame.prefix)
  const finalizedLength =
    finalizedText.length > 0 && text.startsWith(finalizedText)
      ? Array.from(finalizedText).length
      : 0
  const stablePrefix = characters
    .slice(0, Math.min(finalizedLength, characters.length))
    .join('')
  const interimPrefix = characters.slice(finalizedLength).join('')

  return (
    <Text style={style} accessible accessibilityLabel={text}>
      {stablePrefix}
      {interimPrefix.length > 0 && (
        <Text style={interimStyle}>{interimPrefix}</Text>
      )}
      {frame.tail.map((letter) => {
        const isInterim = letter.index >= finalizedLength
        const color = isInterim ? interimColor : textColor
        const progress = getTranscriptColorProgress(letter, clockNow)
        return (
          <Text
            key={`${letter.index}:${letter.character}`}
            style={[
              isInterim ? interimStyle : undefined,
              {
                color: fadedTextColor(
                  interpolateTranscriptColor(colors.accent, color, progress),
                  getTranscriptLetterAlpha(letter, clockNow),
                ),
              },
            ]}
          >
            {letter.character}
          </Text>
        )
      })}
    </Text>
  )
}
