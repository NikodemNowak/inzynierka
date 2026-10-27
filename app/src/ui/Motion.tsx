import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

const useMotionPreference = () => {
  const [preference, setPreference] = useState({ reduced: true, ready: false })
  useEffect(() => {
    let alive = true
    let eventObserved = false
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (alive && !eventObserved) setPreference({ reduced, ready: true })
    }).catch(() => { if (alive && !eventObserved) setPreference({ reduced: true, ready: true }) })
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      if (alive) { eventObserved = true; setPreference({ reduced, ready: true }) }
    })
    return () => { alive = false; listener.remove() }
  }, [])
  return preference
}
export function useReducedMotion() { return useMotionPreference().reduced }

export function fadedTextColor(hex: string, opacity: number): string {
  const color = /^#[\da-f]{6}$/i.test(hex) ? hex : '#49576A'
  return `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${Math.max(0, Math.min(1, opacity))})`
}
