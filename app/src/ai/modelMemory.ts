import { AppState, type AppStateStatus } from 'react-native'
import { isModelLoaded, unloadModel } from './llm'
import { enqueueLlm } from './llmQueue'

// A backgrounded app holding the model is the first thing iOS reclaims memory
// from, and it is killed rather than paused. Drop the weights whenever the app
// leaves the foreground; the next note processing reloads them.
export const startModelMemoryGuard = (): (() => void) => {
  const onChange = (state: AppStateStatus): void => {
    if (state === 'active') return
    if (!isModelLoaded()) return
    // Queued, so it can never release the shared context mid-generation:
    // a background run started from the record screen finishes first.
    void enqueueLlm(unloadModel)
  }

  const subscription = AppState.addEventListener('change', onChange)
  return () => subscription.remove()
}
