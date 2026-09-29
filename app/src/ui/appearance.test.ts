import { Appearance } from 'react-native'
import { resolveColorScheme, synchronizeNativeAppearance } from './appearance'

test('system appearance follows the device scheme and defaults to light if unavailable', () => {
  expect(resolveColorScheme('system', 'dark')).toBe('dark')
  expect(resolveColorScheme('system', 'light')).toBe('light')
  expect(resolveColorScheme('system', 'unspecified')).toBe('light')
  expect(resolveColorScheme('system', null)).toBe('light')
})

test('a manual appearance preference overrides the system scheme', () => {
  expect(resolveColorScheme('light', 'dark')).toBe('light')
  expect(resolveColorScheme('dark', 'light')).toBe('dark')
})

test('native appearance resets to system or applies the selected manual scheme', () => {
  const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined)

  synchronizeNativeAppearance('system')
  synchronizeNativeAppearance('light')
  synchronizeNativeAppearance('dark')

  expect(setColorScheme.mock.calls.map(([scheme]) => scheme)).toEqual(['unspecified', 'light', 'dark'])
  setColorScheme.mockRestore()
})
