import { Pressable } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from './theme'

// Six evenly spaced teeth keep the cog symmetric and legible at toolbar size.
const settingsOutline = Array.from({ length: 6 }, (_, tooth) =>
  [
    [-30, 7.6],
    [-16, 7.6],
    [-11, 10],
    [11, 10],
    [16, 7.6],
  ]
    .map(([offset, radius]) => {
      const angle = ((tooth * 60 - 90 + offset) * Math.PI) / 180
      return `${(12 + radius * Math.cos(angle)).toFixed(3)} ${(12 + radius * Math.sin(angle)).toFixed(3)}`
    })
    .join('L'),
).join('L')

const paths = {
  'chevron-left': 'm14 5-7 7 7 7',
  'chevron-right': 'm10 5 7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  stop: 'M6 6h12v12H6Z',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  waveform: 'M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4',
  note: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8M8 16h5',
  tasks: 'm4 7 2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7',
  settings: `M${settingsOutline}ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7`,
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15m5.5 13 5 5',
  sort: 'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z',
  share: 'M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3',
  calendar: 'M4 6h16v15H4ZM4 10h16M8 3v4M16 3v4M12 13v5M9.5 15.5h5',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-4 10 3 3 5-6',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3',
  phone:
    'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM11 18h2',
  sparkles:
    'M9 2c1.1 5.2 2.2 6.3 7.5 7.5C11.2 10.7 10.1 11.8 9 17c-1.1-5.2-2.2-6.3-7.5-7.5C6.8 8.3 7.9 7.2 9 2ZM18 13c.6 3.1 1.4 3.9 4.5 4.5-3.1.6-3.9 1.4-4.5 4.5-.6-3.1-1.4-3.9-4.5-4.5 3.1-.6 3.9-1.4 4.5-4.5Z',
  'arrow-right': 'M3 12h18m-7-7 7 7-7 7',
  file: 'M14 2H4v20h16V8Zm0 0v6h6M8 13h8M8 17h5',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v6h-6',
  alert: 'M12 3 2 21h20ZM12 9v5M12 17v.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const
export type IconName = keyof typeof paths
export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconName
  size?: number
  color?: string
}) {
  const { colors } = useTheme()
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path
        d={paths[name]}
        stroke={color ?? colors.ink}
        strokeWidth={name === 'more' ? 3.5 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={
          name === 'play' || name === 'stop' ? (color ?? colors.ink) : 'none'
        }
      />
    </Svg>
  )
}
export function IconButton({
  name,
  label,
  onPress,
  disabled = false,
  size = 22,
}: {
  name: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  size?: number
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.55 : 1,
      })}
    >
      <Icon name={name} size={size} color={colors.ink} />
    </Pressable>
  )
}
