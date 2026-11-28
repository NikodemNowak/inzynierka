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

