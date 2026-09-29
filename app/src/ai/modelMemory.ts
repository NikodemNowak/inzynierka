import { AppState, type AppStateStatus } from 'react-native'
import { isModelLoaded, unloadModel } from './llm'
import { enqueueLlm } from './llmQueue'

// Drop weights when the app enters the background or iOS reports memory
// pressure. The next user-requested LLM operation reloads them.
export const startModelMemoryGuard = (): (() => void) => {
  const releaseIfLoaded = (): void => {
    if (!isModelLoaded()) return
    // Queued, so it can never release the shared context mid-generation:
    // a running request finishes first.
    void enqueueLlm(unloadModel).catch(() => undefined)
  }
  const onChange = (state: AppStateStatus): void => {
    if (state !== 'background') return
    releaseIfLoaded()
  }

  const subscription = AppState.addEventListener('change', onChange)
  const memoryWarningSubscription = AppState.addEventListener(
    'memoryWarning',
    releaseIfLoaded,
  )
  return () => {
    subscription.remove()
    memoryWarningSubscription.remove()
  }
}
