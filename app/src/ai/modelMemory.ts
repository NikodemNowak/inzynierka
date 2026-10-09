import { AppState, type AppStateStatus } from 'react-native'
import { isModelLoaded, unloadModel } from './llm'
import { enqueueLlm } from './llmQueue'
import {
  hasBackgroundProcessingLease,
  pauseAllProcessing,
} from '../processing/jobRunner'

// Drop weights when the app enters the background or iOS reports memory
// pressure. The next user-requested LLM operation reloads them.
export const startModelMemoryGuard = (): (() => void) => {
  const releaseIfLoaded = (reason: string): void => {
    void pauseAllProcessing(reason)
      .then(() => {
        if (!isModelLoaded()) return
        return enqueueLlm(unloadModel)
      })
      .catch(() => undefined)
  }
  const onChange = (state: AppStateStatus): void => {
    if (state !== 'background') return
    if (!hasBackgroundProcessingLease()) releaseIfLoaded('background')
  }

  const subscription = AppState.addEventListener('change', onChange)
  const memoryWarningSubscription = AppState.addEventListener(
    'memoryWarning',
    () => releaseIfLoaded('memory'),
  )
  return () => {
    subscription.remove()
    memoryWarningSubscription.remove()
  }
}
