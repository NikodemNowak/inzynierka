import { useColorScheme } from 'react-native'
import { useSettingsStore } from '../state/settingsStore'
import { resolveColorScheme } from './appearance'

// Stable semantic palettes shared by every screen.
const lightColors = {
  ink: '#172131',
  body: '#49576A',
  muted: '#64748A',
  faint: '#8794A6',
  line: '#E2E8F0',
  surface: '#EDF2F8',
  canvas: '#F9FBFE',
  paper: '#FFFFFF',
  navy: '#3566A8',
  navySoft: '#E8F0FC',
  accent: '#286BC2',
  accentSoft: '#E8F0FC',
  onAccent: '#FFFFFF',
  action: '#286BC2',
  onAction: '#FFFFFF',
  ember: '#D95750',
  emberSoft: '#FFF0EE',
  danger: '#B93F44',
  success: '#39705F',
  overlay: 'rgba(13,22,35,0.38)',
}
export const colors = lightColors
export type ThemeColors = typeof colors
const darkColors: ThemeColors = {
  ink: '#EEF3FA',
  body: '#C0CBD9',
  muted: '#99A9BE',
  faint: '#75869D',
  line: '#293746',
  surface: '#1E2C36',
  canvas: '#121C23',
  paper: '#192630',
  navy: '#8BB8F2',
  navySoft: '#223952',
  accent: '#80B9F2',
  accentSoft: '#22394D',
  onAccent: '#10233D',
  action: '#2E70BB',
  onAction: '#FFFFFF',
  ember: '#F38A80',
  emberSoft: '#36262C',
  danger: '#F39297',
  success: '#8DC3B1',
  overlay: 'rgba(0,0,0,0.6)',
}
export function useTheme() {
  const preference = useSettingsStore((state) => state.appearancePreference)
  const systemScheme = useColorScheme()
  const isDark = resolveColorScheme(preference, systemScheme) === 'dark'
  return { colors: isDark ? darkColors : colors, isDark }
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const

export const type = {
  display: {
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -0.65,
  },
  title: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  body: { fontSize: 16, lineHeight: 25, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  counter: {
    fontSize: 58,
    lineHeight: 70,
    fontWeight: '500',
    letterSpacing: -2,
  },
} as const
