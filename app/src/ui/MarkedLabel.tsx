import { Animated, Text, View } from 'react-native'
import { fonts, useTheme } from './theme'

// A label whose second part sits on a highlighter stroke; `sweep` (0→1) redraws it.
export function MarkedLabel({ lead, marked, sweep }: { lead: string; marked: string; sweep: Animated.Value }) {
  const { colors } = useTheme()
  const style = { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={style}>{lead} </Text>
      <View>
        <Animated.View
          style={{
            position: 'absolute',
            left: -2,
            right: -2,
            top: 1,
            bottom: 0,
            borderRadius: 3,
            backgroundColor: colors.marker,
            transformOrigin: 'left',
            transform: [{ scaleX: sweep }],
          }}
        />
        <Text style={[style, { color: colors.onMarker }]}>{marked}</Text>
      </View>
    </View>
  )
}
