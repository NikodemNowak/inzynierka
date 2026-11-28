import { useMemo } from 'react'
import { useColorScheme } from 'react-native'
import { useSettingsStore } from '../state/settingsStore'
import { resolveColorScheme } from './appearance'

// iOS-like grouped palette: system grays, one blue accent.
export const lightColors = {
  ink: '#000000',
  body: '#000000',
  muted: '#6C6C70',
  faint: '#8E8E93',
  line: '#C6C6C8',
  surface: '#E3E3E8',
  canvas: '#F2F2F7',
  paper: '#FFFFFF',
  accent: '#0064D2',
  accentSoft: '#E3EEFB',
  onAccent: '#FFFFFF',
  action: '#0064D2',
  onAction: '#FFFFFF',
  marker: '#0064D2',
  markerLine: '#0064D2',
  markerSoft: '#E3EEFB',
  onMarker: '#FFFFFF',
  brand: '#0064D2',
  onBrand: '#FFFFFF',
  raised: '#FFFFFF',
  ember: '#D70015',
  emberSoft: '#FDE8EA',
  danger: '#D70015',
  success: '#248A3D',
  overlay: 'rgba(0,0,0,0.32)',
  group: '#FFFFFF',
  field: '#E3E3E8',
  secondary: '#6C6C70',
  tint: '#E3EEFB',
  onTint: '#00489A',
  track: '#E5E5EA',
  bar: '#FFFFFF',
  red: '#D70015',
}
export const colors = lightColors
export type ThemeColors = typeof colors
export const darkColors: ThemeColors = {
  ink: '#FFFFFF',
  body: '#FFFFFF',
  muted: '#98989F',
  faint: '#636366',
  line: '#38383A',
  surface: '#2C2C2E',
  canvas: '#000000',
  paper: '#1C1C1E',
  accent: '#4C9BFF',
  accentSoft: '#0E2440',
  onAccent: '#FFFFFF',
  action: '#4C9BFF',
  onAction: '#FFFFFF',
  marker: '#4C9BFF',
  markerLine: '#4C9BFF',
  markerSoft: '#0E2440',
  onMarker: '#FFFFFF',
  brand: '#4C9BFF',
  onBrand: '#FFFFFF',
  raised: '#636366',
  ember: '#FF6961',
  emberSoft: '#3A1D20',
  danger: '#FF6961',
  success: '#30D158',
  overlay: 'rgba(0,0,0,0.55)',
  group: '#1C1C1E',
  field: '#1C1C1E',
  secondary: '#98989F',
  tint: '#0E2440',
  onTint: '#8CC0FF',
  track: '#3A3A3C',
  bar: '#1C1C1E',
  red: '#FF6961',
}
export function useTheme() {
  const preference = useSettingsStore((state) => state.appearancePreference)
  const systemScheme = useColorScheme()
  const isDark = resolveColorScheme(preference, systemScheme) === 'dark'
  return useMemo(
    () => ({ colors: isDark ? darkColors : colors, isDark }),
    [isDark],
  )
}

// System font (SF Pro on iOS): weights are picked with fontWeight.
export const font = {
  regular: { fontWeight: '400' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
} as const

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
  lg: 18,
  pill: 999,
} as const

export const type = {
  display: { ...font.bold, fontSize: 34, lineHeight: 41, letterSpacing: -0.4 },
  noteTitle: { ...font.bold, fontSize: 28, lineHeight: 34 },
  section: { ...font.bold, fontSize: 20, lineHeight: 25 },
  title: { ...font.semibold, fontSize: 17, lineHeight: 22 },
  body: { ...font.regular, fontSize: 17, lineHeight: 22 },
  label: { ...font.semibold, fontSize: 15, lineHeight: 20 },
  meta: { ...font.regular, fontSize: 15, lineHeight: 20 },
  caption: { ...font.semibold, fontSize: 13, lineHeight: 18 },
  counter: {
    ...font.semibold,
    fontSize: 48,
    lineHeight: 56,
    fontVariant: ['tabular-nums'],
  },
} as const
