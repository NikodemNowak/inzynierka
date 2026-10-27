import { StyleSheet, View } from 'react-native'
import { Icon } from './Icon'
import { radius, useTheme } from './theme'

export type EmptyIllustrationKind = 'note' | 'search' | 'tasks'

// Paper card with a highlighter stroke behind one line, as in the onboarding art.
export function EmptyIllustration({
  kind,
  label,
}: {
  kind: EmptyIllustrationKind
  label: string
}) {
  const { colors } = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.card,
        { backgroundColor: colors.paper, borderColor: colors.line },
      ]}
    >
      <View style={styles.row}>
        {kind === 'tasks' && (
          <View style={[styles.box, { borderColor: colors.faint }]} />
        )}
        <View style={styles.markerWrap}>
          <View style={[styles.stroke, { backgroundColor: colors.marker }]} />
          <View
            style={[styles.line, { backgroundColor: colors.ink, width: '70%' }]}
          />
        </View>
      </View>
      {[0.85, 0.6].map((fraction, index) => (
        <View key={index} style={styles.row}>
          {kind === 'tasks' && (
            <View style={[styles.box, { borderColor: colors.faint }]} />
          )}
          <View
            style={[
              styles.line,
              { backgroundColor: colors.line, width: `${fraction * 100}%` },
            ]}
          />
        </View>
      ))}
      {kind === 'note' && (
        <View style={styles.bars}>
          {[10, 20, 14, 26, 16, 8].map((height, index) => (
            <View
              key={index}
              style={{
                width: 3,
                height,
                borderRadius: radius.pill,
                backgroundColor: colors.ink,
              }}
            />
          ))}
        </View>
      )}
      {kind === 'search' && (
        <View style={styles.badge}>
          <Icon name="search" size={22} color={colors.ink} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: 168,
    paddingVertical: 20,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    gap: 12,
    transform: [{ rotate: '-3deg' }],
    marginBottom: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3 },
  markerWrap: { flex: 1, justifyContent: 'center' },
  stroke: {
    position: 'absolute',
    left: -4,
    right: 0,
    height: 14,
    borderRadius: 4,
  },
  line: { height: 5, borderRadius: radius.pill },
  bars: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  badge: { alignSelf: 'flex-end', marginTop: 2 },
})
