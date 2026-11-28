import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, Easing, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { Icon } from '../ui/Icon'
import { useTheme } from '../ui/theme'
import { FadeText } from './FadeText'

const boundedTaskIds = (ids: readonly string[]): readonly string[] => {
  const unique = new Set<string>()
  for (const id of ids) {
    if (id) unique.add(id)
    if (unique.size === 4) break
  }
  return Object.freeze([...unique])
}

const savedTextListeners = new Set<(ids: readonly string[]) => void>()

// Notify already-visible screens only after the owner has awaited actual storage.
// Do not retain events: store hydration and later navigation are not new saves.
export const publishPersistedTaskText = (ids: readonly string[]): void => {
  const bounded = boundedTaskIds(ids)
  if (!bounded.length) return
  for (const listener of savedTextListeners) listener(bounded)
}

export const subscribePersistedTaskText = (listener: (ids: readonly string[]) => void): (() => void) => {
  savedTextListeners.add(listener)
  return () => { savedTextListeners.delete(listener) }
}

export function useTaskTextReveal(active: boolean, reducedMotion: boolean, scope: string) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  const owner = useRef({ active, reducedMotion, scope })
  if (owner.current.active !== active || owner.current.reducedMotion !== reducedMotion || owner.current.scope !== scope)
    owner.current = { active, reducedMotion, scope }
  useLayoutEffect(() => { setIds(new Set()) }, [active, reducedMotion, scope])
  useEffect(() => () => { owner.current = { active: false, reducedMotion: true, scope } }, [])
  const prepare = useCallback(() => {
    const initial = owner.current
    return (freshIds: readonly string[]): boolean => {
      if (!initial.active || initial.reducedMotion || owner.current !== initial) return false
      setIds(new Set(boundedTaskIds(freshIds)))
      return true
    }
  }, [])
  const consume = useCallback((id: string) => {
    setIds((current) => {
      if (!current.has(id)) return current
      const remaining = new Set(current)
      remaining.delete(id)
      return remaining
    })
  }, [])
  return { ids, prepare, consume }
}

export function TaskText({ text, reveal, active, reducedMotion, onRevealConsumed, onRevealComplete, style, numberOfLines }: {
  text: string
  reveal: boolean
  active: boolean
  reducedMotion: boolean
  onRevealConsumed: () => void
  onRevealComplete?: (text: string) => void
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  // Accepted for existing callers; rows no longer cascade.
  index?: number
}) {
  const [animate, setAnimate] = useState(false)
  const previousText = useRef(text)
  const consumed = useRef(onRevealConsumed)
  consumed.current = onRevealConsumed
  useLayoutEffect(() => {
    const changed = previousText.current !== text
    previousText.current = text
    if (!active || reducedMotion) {
      setAnimate(false)
      if (reveal) consumed.current()
    } else if (reveal) {
      setAnimate(true)
      // Consume the parent event now. This mounted text can finish its clock,
      // while a virtualized remount cannot replay the same event.
      consumed.current()
    } else if (changed) setAnimate(false)
  }, [text, reveal, active, reducedMotion])
  return <FadeText text={text} animate={animate && active && !reducedMotion} active={active} style={style} numberOfLines={numberOfLines} onRevealComplete={onRevealComplete} />
}

// Presentation only: complete candidates remain available to selection/storage.
// There is no cascade: every row is ready at once and a fresh visible batch
// fades in together. The completion callbacks are kept for existing callers.
export function useTaskRevealSequence(items: readonly string[], eventKey: string | null, scope: string, active: boolean, reducedMotion: boolean) {
  // A batch that was hidden or reduced once never fades in again on return.
  const signature = `${scope}|${eventKey}`
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => { if (!active || reducedMotion) setSettled(signature) }, [active, reducedMotion, signature])
  const fresh = eventKey !== null && active && !reducedMotion && settled !== signature
  const fast = isFastReveal(items.length)
  const noop = useCallback((_key: string) => undefined, [])
  return {
    fast,
    ready: (_index: number) => true,
    enter: (index: number) => fresh && index < items.length,
    complete: noop, textComplete: noop, arrivalComplete: noop,
  }
}

// A list longer than this fades its rows in without the per-text fade.
export const CALM_REVEAL_COUNT = 4
export const isFastReveal = (count: number): boolean => count > CALM_REVEAL_COUNT

export const taskEntranceTiming = (
  index: number,
  active: boolean,
  reducedMotion: boolean,
  _count = 0,
): { duration: number; delay: number } | null => {
  if (!active || reducedMotion || !Number.isInteger(index) || index < 0) return null
  return { duration: 200, delay: 0 }
}

export function useTaskMotionActive(focused: boolean): boolean {
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => listener.remove()
  }, [])
  return focused && foreground
}

// Reveal complete, already available content with one plain 200 ms fade.
export function TaskArrival({ children, index, active, reducedMotion, style, enter = true, eventKey, onArrivalComplete }: {
  children: ReactNode
  index: number
  count?: number
  active: boolean
  reducedMotion: boolean
  style?: StyleProp<ViewStyle>
  enter?: boolean
  eventKey?: string
  onArrivalComplete?: () => void
}) {
  const progress = useRef(new Animated.Value(1)).current
  const completion = useRef(onArrivalComplete)
  completion.current = onArrivalComplete
  // A row that only shifts (a task above it was deleted) must not fade in again.
  const indexRef = useRef(index)
  indexRef.current = index
  useLayoutEffect(() => {
    progress.stopAnimation()
    const timing = taskEntranceTiming(indexRef.current, active && enter, reducedMotion)
    if (!timing) {
      progress.setValue(1)
      return
    }
    progress.setValue(0)
    const notify = completion.current
    let alive = true, finished = false
    const finish = (force = false) => {
      if (!alive || finished) return
      finished = true; clearTimeout(watchdog)
      if (force) { animation.stop(); progress.setValue(1) }
      notify?.()
    }
    const animation = Animated.timing(progress, {
      ...timing, toValue: 1, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    })
    const watchdog = setTimeout(() => finish(true), timing.duration + timing.delay + 100)
    animation.start(result => { if (result.finished) finish() })
    return () => {
      alive = false; clearTimeout(watchdog)
      animation.stop()
      progress.setValue(1)
    }
  }, [progress, active, reducedMotion, enter, eventKey])
  return <Animated.View style={[style, { opacity: progress }]}>{children}</Animated.View>
}

export function TaskCheck({ checked, active, reducedMotion, style, size = 16, feedback = false, onFeedbackComplete }: {
  checked: boolean
  active: boolean
  reducedMotion: boolean
  style: StyleProp<ViewStyle>
  size?: number
  feedback?: boolean
  onFeedbackComplete?: () => void
}) {
  const { colors } = useTheme()
  const previous = useRef(checked)
  const previousFeedback = useRef(false)
  const feedbackComplete = useRef(onFeedbackComplete)
  feedbackComplete.current = onFeedbackComplete
  // One 150 ms value drives both the check's opacity and its 0.9 to 1 scale.
  const progress = useRef(new Animated.Value(checked ? 1 : 0)).current
  useEffect(() => {
    const changed = previous.current !== checked
    const freshFeedback = feedback && !previousFeedback.current
    previous.current = checked
    previousFeedback.current = feedback
    const consumeFeedback = feedback ? feedbackComplete.current : undefined
    progress.stopAnimation()
    if (!active || reducedMotion || (!changed && !freshFeedback)) {
      progress.setValue(checked ? 1 : 0)
      consumeFeedback?.()
      return
    }
    const animation = Animated.timing(progress, { toValue: checked ? 1 : 0, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    animation.start(({ finished }) => {
      if (finished) consumeFeedback?.()
    })
    return () => {
      animation.stop()
      progress.setValue(checked ? 1 : 0)
      consumeFeedback?.()
    }
  }, [checked, active, reducedMotion, feedback, progress])
  return (
    <Animated.View style={style}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}
      >
        <Icon name="check" size={size} color={colors.onAccent} />
      </Animated.View>
    </Animated.View>
  )
}
