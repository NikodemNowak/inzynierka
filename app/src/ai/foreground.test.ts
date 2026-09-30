import { AppState, type AppStateStatus } from 'react-native'
import { waitForForeground } from './foreground'

afterEach(() => {
  jest.restoreAllMocks()
  AppState.currentState = 'active'
})

test('does not postpone work while the app is active', async () => {
  AppState.currentState = 'active'
  const subscribe = jest.spyOn(AppState, 'addEventListener')
  await waitForForeground()
  expect(subscribe).not.toHaveBeenCalled()
})

test('waits through inactivity and unsubscribes on returning to the foreground', async () => {
  AppState.currentState = 'background'
  let listener: ((state: AppStateStatus) => void) | undefined
  const remove = jest.fn()
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void
      return { remove }
    })
  const ready = jest.fn()
  const pending = waitForForeground().then(ready)
  listener?.('inactive')
  await Promise.resolve()
  expect(ready).not.toHaveBeenCalled()
  listener?.('active')
  await pending
  expect(ready).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledTimes(1)
})
