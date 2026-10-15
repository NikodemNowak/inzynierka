import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { nativeCapture, type CaptureSnapshot } from './nativeCapture'

export interface CaptureActivity {
  sessionId: string
  state: 'recording' | 'interrupted'
  durationMs: number
}
export const useCaptureActivity = (): CaptureActivity | null => {
  const [activity, setActivity] = useState<CaptureActivity | null>(null)
  useEffect(() => {
    if (!nativeCapture) return
    const native = nativeCapture
    let mounted = true
    const update = (snapshot: CaptureSnapshot | null) => {
      if (!mounted) return
      const state = snapshot?.manifest.state
      setActivity(
        snapshot && (state === 'recording' || state === 'interrupted')
          ? {
              sessionId: snapshot.manifest.sessionId,
              state,
              durationMs: Math.round((snapshot.manifest.frames * 1000) / 16000),
            }
          : null,
      )
    }
    const listener = native.addListener('captureState', update)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active')
        void native
          .getSnapshot()
          .then(update)
          .catch(() => undefined)
    })
    void native
      .getSnapshot()
      .then(update)
      .catch(() => undefined)
    return () => {
      mounted = false
      listener.remove()
      app.remove()
    }
  }, [])
  return activity
}
