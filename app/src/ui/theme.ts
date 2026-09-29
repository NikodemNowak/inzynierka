import { Platform } from 'react-native'

// Palette carried over from the thesis presentation, so screenshots of the app
// sit next to the slides without a colour clash.
export const colors = {
  ink: '#111827',
  body: '#374151',
  muted: '#6B7280',
  faint: '#9CA3AF',
  line: '#E2E8F0',
  surface: '#F1F5F9',
  canvas: '#F8FAFC',
  paper: '#FFFFFF',
  navy: '#1F4E79',
  navySoft: '#EAF0F6',
  // Reserved for one meaning only: the microphone is live. Never decorative.
  ember: '#B45309',
  emberSoft: '#FDF3E7',
  danger: '#B91C1C',
  success: '#2E7D32',
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
  sm: 6,
  md: 12,
  lg: 18,
  pill: 999,
} as const

// Time is the spine of a voice note — when it was recorded, how long it ran.
// Setting it in monospace keeps digits aligned down a list and marks them as
// data rather than prose.
export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })

export const type = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 16, fontFamily: mono },
  counter: { fontSize: 52, lineHeight: 60, fontFamily: mono, fontWeight: '600' },
} as const
