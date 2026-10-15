import { AppState } from 'react-native'

// Auto-saving a recording in the background must not start loading gigabytes
// of model weights while iOS is about to suspend the app.
export const waitForForeground = (): Promise<void> => {
  if (
    AppState.currentState !== 'background' &&
    AppState.currentState !== 'inactive'
  )
    return Promise.resolve()
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      subscription.remove()
      resolve()
    })
  })
}
