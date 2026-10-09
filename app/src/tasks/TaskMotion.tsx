import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, Easing, LayoutAnimation, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { Icon } from '../ui/Icon'
import { useTheme } from '../ui/theme'
import { RevealText } from '../ui/Motion'
import { useLayoutTransition } from '../ui/LayoutMotion'

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

export function TaskText({ text, reveal, active, reducedMotion, onRevealConsumed, onRevealComplete, style, numberOfLines, index = 0, placeholderLines = 0 }: {
  text: string
  reveal: boolean
  active: boolean
  reducedMotion: boolean
  onRevealConsumed: () => void
  onRevealComplete?: (text: string) => void
  style?: StyleProp<TextStyle>
  numberOfLines?: number
  index?: number
  placeholderLines?: number
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
  return <RevealText text={text} animate={animate && active && !reducedMotion} active={active} style={style} numberOfLines={numberOfLines} delayMs={Math.max(0, Math.min(3, index)) * 140} placeholderLines={placeholderLines} onRevealComplete={onRevealComplete} />
}

// Presentation only: complete candidates remain available to selection/storage.
// Activate the next text from its predecessor's finite reveal completion, so
// independent raster callbacks cannot scramble the visual reading order.
export function useTaskRevealSequence(items: readonly string[], eventKey: string | null, scope: string, active: boolean, reducedMotion: boolean) {
  const keys = boundedTaskIds(items)
  const signature = JSON.stringify([scope, eventKey, keys])
  const [state, setState] = useState({ signature, completed: 0 })
  const owner = useRef({ signature, active, reducedMotion, keys, textDone: new Set<string>(), arrived: new Set<string>() })
  if (owner.current.signature !== signature || owner.current.active !== active || owner.current.reducedMotion !== reducedMotion)
    owner.current = { signature, active, reducedMotion, keys, textDone: new Set<string>(), arrived: new Set<string>() }
  const current = owner.current
  const fresh = eventKey !== null && active && !reducedMotion
  const completed = state.signature === signature ? state.completed : 0
  const shownCompleted = useLayoutTransition(completed, String(completed), signature, active, reducedMotion)
  useLayoutEffect(() => {
    setState(value => {
      const next = !fresh ? keys.length : value.signature === signature ? value.completed : 0
      return value.signature === signature && value.completed === next ? value : { signature, completed: next }
    })
  }, [signature, fresh, keys.length])
  const complete = useCallback((key: string) => {
    if (owner.current !== current || !current.active || current.reducedMotion) return
    setState(value => {
      const count = value.signature === signature ? value.completed : 0
      return current.keys[count] === key ? { signature, completed: count + 1 } : value
    })
  }, [current, signature])
  const textComplete = useCallback((key: string) => {
    if (owner.current !== current) return
    current.textDone.add(key)
    if (current.arrived.has(key)) complete(key)
  }, [current, complete])
  const arrivalComplete = useCallback((key: string) => {
    if (owner.current !== current) return
    current.arrived.add(key)
    if (current.textDone.has(key)) complete(key)
  }, [current, complete])
  useEffect(() => {
    if (!fresh || completed >= keys.length) return
    const timer = setTimeout(() => complete(keys[completed]), 6500)
    return () => clearTimeout(timer)
  }, [fresh, completed, signature, complete])
  useEffect(() => () => { owner.current = { ...owner.current, active: false } }, [])
  return {
    ready: (index: number) => !fresh || index >= keys.length || index <= shownCompleted,
    enter: (index: number) => fresh && index < keys.length && index === shownCompleted,
    complete, textComplete, arrivalComplete,
  }
}

export const taskEntranceTiming = (
  index: number,
  active: boolean,
  reducedMotion: boolean,
): { duration: number; delay: number } | null =>
  active && !reducedMotion && Number.isInteger(index) && index >= 0 && index < 4
    ? { duration: 260, delay: index * 140 }
    : null

export function useTaskMotionActive(focused: boolean): boolean {
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'))
    return () => listener.remove()
  }, [])
  return focused && foreground
}

// Reveal complete, already available content. No character clocks or layout changes.
export function TaskArrival({ children, index, active, reducedMotion, style, enter = true, eventKey, onArrivalComplete }: {
  children: ReactNode
  index: number
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
  useLayoutEffect(() => {
    progress.stopAnimation()
    const timing = taskEntranceTiming(index, active && enter, reducedMotion)
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
  }, [progress, index, active, reducedMotion, enter, eventKey])
  return (
    <Animated.View style={[style, {
      opacity: progress,
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  )
}

// Retain only the surplus visual placeholders, never candidate task data.
// Their native frames collapse in order after the real result is available.
export const placeholderExitTiming = (index: number, count: number) => ({
  delay: Math.min(300, 100 + count * 100) + (2 - index) * 400,
  duration: 180,
  collapse: 220,
})

export function TaskPlaceholder({ children, index, count, exiting, active, reducedMotion }: {
  children: ReactNode; index: number; count: number; exiting: boolean; active: boolean; reducedMotion: boolean
}) {
  const progress = useRef(new Animated.Value(0)).current
  useLayoutEffect(() => {
    progress.stopAnimation(); progress.setValue(0)
    if (!exiting || !active || reducedMotion) return
    const { delay, duration } = placeholderExitTiming(index, count)
    const animation = Animated.timing(progress, { toValue: 1, delay, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false })
    animation.start()
    return () => { animation.stop(); progress.setValue(0) }
  }, [index, count, exiting, active, reducedMotion, progress])
  return <Animated.View testID={`placeholder-exit-${index}`} style={{
    opacity: Animated.subtract(1, progress),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
      { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] }) }],
  }}>{children}</Animated.View>
}

export function usePlaceholderExit(loading: boolean, count: number, scope: string, active: boolean, reducedMotion: boolean): readonly number[] {
  const previous = useRef({ loading, scope })
  const [tail, setTail] = useState<{ scope: string; indices: readonly number[] }>({ scope, indices: [] })
  const epoch = useRef(0)
  const current = useRef({ loading, scope, active, reducedMotion })
  current.current = { loading, scope, active, reducedMotion }
  const finishing = previous.current.scope === scope && previous.current.loading && !loading && active && !reducedMotion
  const surplus = Array.from({ length: Math.max(0, 3 - count) }, (_, offset) => count + offset)
  useLayoutEffect(() => {
    const generation = ++epoch.current
    const finish = previous.current.scope === scope && previous.current.loading && !loading && active && !reducedMotion
    previous.current = { loading, scope }
    if (!finish) { setTail({ scope, indices: [] }); return }
    const indices = Array.from({ length: Math.max(0, 3 - count) }, (_, offset) => count + offset)
    setTail({ scope, indices })
    const timers = indices.map(index => {
      const { delay, duration, collapse } = placeholderExitTiming(index, count)
      return setTimeout(() => {
      const owner = current.current
      if (generation !== epoch.current || owner.scope !== scope || owner.loading || !owner.active || owner.reducedMotion) return
      LayoutAnimation.configureNext({ duration: collapse, update: { type: 'easeInEaseOut' }, delete: { type: 'easeInEaseOut', property: 'opacity', duration: 1 } })
      setTail(value => value.scope === scope ? { scope, indices: value.indices.filter(value => value !== index) } : value)
      }, delay + duration)
    })
    return () => { ++epoch.current; for (const timer of timers) clearTimeout(timer) }
  }, [loading, count, scope, active, reducedMotion])
  if (!active || reducedMotion || loading || tail.scope !== scope) return []
  return finishing ? surplus : tail.indices
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
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(checked ? 1 : 0)).current
  useEffect(() => {
    const changed = previous.current !== checked
    const freshFeedback = feedback && !previousFeedback.current
    previous.current = checked
    previousFeedback.current = feedback
    const consumeFeedback = feedback ? feedbackComplete.current : undefined
    scale.stopAnimation()
    opacity.stopAnimation()
    if (!active || reducedMotion || (!changed && !freshFeedback)) {
      scale.setValue(1)
      opacity.setValue(checked ? 1 : 0)
      consumeFeedback?.()
      return
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: checked ? 1 : 0, duration: 110, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.9, duration: 90, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 130, useNativeDriver: true }),
      ]),
    ])
    animation.start(({ finished }) => {
      if (finished) consumeFeedback?.()
    })
    return () => {
      animation.stop()
      scale.setValue(1)
      opacity.setValue(checked ? 1 : 0)
      consumeFeedback?.()
    }
  }, [checked, active, reducedMotion, feedback, scale, opacity])
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity }}>
        <Icon name="check" size={size} color={colors.onAction} />
      </Animated.View>
    </Animated.View>
  )
}
