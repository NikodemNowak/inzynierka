import { useColorScheme } from 'react-native'

// Shared semantic colors; app screens follow the system appearance.
export const colors = {
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
  accent: '#3566A8',
  accentSoft: '#E8F0FC',
  onAccent: '#FFFFFF',
  ember: '#D95750',
  emberSoft: '#FFF0EE',
  danger: '#B93F44',
  success: '#39705F',
  overlay: 'rgba(13,22,35,0.38)',
}
export type ThemeColors = typeof colors
const darkColors: ThemeColors = {
  ink: '#EEF3FA',
  body: '#C0CBD9',
  muted: '#99A9BE',
  faint: '#75869D',
  line: '#293746',
  surface: '#1C2A38',
  canvas: '#111A23',
  paper: '#16212D',
  navy: '#8BB8F2',
  navySoft: '#223952',
  accent: '#8BB8F2',
  accentSoft: '#223952',
  onAccent: '#10233D',
  ember: '#F38A80',
  emberSoft: '#36262C',
  danger: '#F39297',
  success: '#8DC3B1',
  overlay: 'rgba(0,0,0,0.6)',
}
export function useTheme() {
  const isDark = useColorScheme() === 'dark'
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

// Kept for development screens; recording timers use tabular system numerals.
export const mono = undefined

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
