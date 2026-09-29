import { Appearance } from 'react-native'

export type AppearancePreference = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'
export type SystemColorScheme = ColorScheme | 'unspecified' | null

export const parseAppearancePreference = (
  value: string | null,
): AppearancePreference =>
  value === 'light' || value === 'dark' ? value : 'system'

export const resolveColorScheme = (
  preference: AppearancePreference,
  systemScheme: SystemColorScheme,
): ColorScheme => {
  if (preference !== 'system') return preference
  return systemScheme === 'dark' ? 'dark' : 'light'
}

export const synchronizeNativeAppearance = (
  preference: AppearancePreference,
): void => {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference)
}
