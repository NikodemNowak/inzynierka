import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, Easing, LayoutAnimation } from 'react-native'

const layoutDurationMs = 320

const useForeground = () => {
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'))
    return () => listener.remove()
  }, [])
  return foreground
}

// Stage display-only values so the native layout transaction is scheduled
// before the commit that changes their geometry. Durable data stays immediate.
export function useLayoutTransition<T>(value: T, signature: string, scope: string, active: boolean, reducedMotion: boolean): T {
  const foreground = useForeground()
  const [shown, setShown] = useState({ value, signature, scope })
  useLayoutEffect(() => {
    if (shown.signature === signature && shown.scope === scope) return
    if (shown.scope === scope && active && foreground && !reducedMotion) {
      LayoutAnimation.configureNext({
        duration: layoutDurationMs,
        create: { type: 'easeInEaseOut', property: 'opacity', duration: 240 },
        update: { type: 'easeInEaseOut' },
        delete: { type: 'easeInEaseOut', property: 'opacity', duration: 180 },
      })
    }
    setShown({ value, signature, scope })
  }, [value, signature, scope, active, foreground, reducedMotion, shown])
  return shown.scope === scope && active && foreground && !reducedMotion ? shown.value : value
}

export function LayoutEntry({ children, eventKey, visible, active, reducedMotion }: {
  children: ReactNode; eventKey: string; visible: boolean; active: boolean; reducedMotion: boolean
}) {
  const foreground = useForeground()
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current
  const previous = useRef(eventKey)
  useLayoutEffect(() => {
    const changed = previous.current !== eventKey
    previous.current = eventKey
    progress.stopAnimation()
    if (!visible) { progress.setValue(0); return }
    if (!changed || !active || !foreground || reducedMotion) { progress.setValue(1); return }
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 240, delay: layoutDurationMs, easing: Easing.out(Easing.cubic),
      useNativeDriver: true, isInteraction: false,
    })
    animation.start()
    return () => { animation.stop(); progress.setValue(1) }
  }, [eventKey, visible, active, foreground, reducedMotion, progress])
  if (!visible) return null
  return <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>
}
