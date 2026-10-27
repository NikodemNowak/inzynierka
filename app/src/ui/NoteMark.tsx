import Svg, { Path, Rect } from 'react-native-svg'

const BARS = [[36, 62, 6], [43, 59, 12], [50, 57, 16], [57, 60, 10], [64, 58, 14], [71, 62, 6]] as const

// The app's mark: a page whose voice is highlighted. Same geometry as the icon.
export function NoteMark({ width = 64 }: { width?: number }) {
  return (
    <Svg width={width} height={(width * 92) / 70} viewBox="24 18 70 92" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M32 22h40l16 16v60a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill="#F7F6F2" stroke="#DDD9CF" strokeWidth={0.5} />
      <Path d="M72 22v12a4 4 0 0 0 4 4h12z" fill="#D6D2C6" />
      <Rect x={34} y={44} width={36} height={5} rx={2.5} fill="#C9C6BE" />
      <Path d="M30 56h52l3 18H30z" fill="#FFE066" />
      {BARS.map(([x, y, h]) => <Rect key={x} x={x} y={y} width={4} height={h} rx={2} fill="#18181B" />)}
      <Rect x={34} y={82} width={28} height={5} rx={2.5} fill="#C9C6BE" />
    </Svg>
  )
}
