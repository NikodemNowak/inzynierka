import { useColorScheme } from 'react-native'
import { useSettingsStore } from '../state/settingsStore'
import { resolveColorScheme } from './appearance'

// Warm paper, black ink and one highlighter yellow.
const lightColors = {
  ink: '#18181B',
  body: '#3F3E3A',
  muted: '#6B6A66',
  faint: '#A3A19B',
  line: '#E6E3DB',
  surface: '#EFEDE7',
  canvas: '#F7F6F2',
  paper: '#FFFFFF',
  navy: '#18181B',
  navySoft: '#EFEDE7',
  accent: '#18181B',
  accentSoft: '#FFF3B8',
  onAccent: '#F7F6F2',
  action: '#18181B',
  onAction: '#F7F6F2',
  marker: '#FFE066',
  markerLine: '#E8C93A',
  onMarker: '#18181B',
  ember: '#D2493A',
  emberSoft: '#FBEAE6',
  danger: '#B3362B',
  success: '#2E7D4F',
  overlay: 'rgba(24,24,27,0.38)',
}
export const colors = lightColors
export type ThemeColors = typeof colors
const darkColors: ThemeColors = {
  ink: '#EDEBE6',
  body: '#CFCDC7',
  muted: '#9A9892',
  faint: '#77756F',
  line: '#2C2C30',
  surface: '#26262A',
  canvas: '#141416',
  paper: '#1E1E21',
  navy: '#EDEBE6',
  navySoft: '#26262A',
  accent: '#EDEBE6',
  accentSoft: '#3A3420',
  onAccent: '#141416',
  action: '#EDEBE6',
  onAction: '#141416',
  marker: '#FFE066',
  markerLine: '#E8C93A',
  onMarker: '#141416',
  ember: '#F08C7F',
  emberSoft: '#3A2522',
  danger: '#F39288',
  success: '#8CC8A6',
  overlay: 'rgba(0,0,0,0.6)',
}
export function useTheme() {
  const preference = useSettingsStore((state) => state.appearancePreference)
  const systemScheme = useColorScheme()
  const isDark = resolveColorScheme(preference, systemScheme) === 'dark'
  return { colors: isDark ? darkColors : colors, isDark }
}

// Custom fonts ship one family per weight, so weights are picked by family.
export const fonts = {
  regular: 'Onest_400Regular',
  medium: 'Onest_500Medium',
  semibold: 'Onest_600SemiBold',
  bold: 'Onest_700Bold',
  serif: 'Literata_500Medium',
  serifRegular: 'Literata_400Regular',
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
  display: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 25,
    letterSpacing: -0.2,
  },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  counter: {
    fontFamily: fonts.medium,
    fontSize: 58,
    lineHeight: 70,
    letterSpacing: -2,
  },
} as const
