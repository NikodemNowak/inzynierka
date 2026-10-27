import { InteractionManager } from 'react-native'

// Resolves once interactions settle, or after `maxWaitMs` at the latest:
// endless ambient Animated loops can otherwise keep the queue busy forever.
export const afterInteractions = (maxWaitMs = 1500): Promise<void> =>
  new Promise((resolve) => {
    let settled = false
    let task: { cancel: () => void } | null = null
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      task?.cancel()
      resolve()
    }
    const timer = setTimeout(finish, maxWaitMs)
    task = InteractionManager.runAfterInteractions(finish)
  })
