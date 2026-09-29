import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useModelStore } from '../state/modelStore'
import { Icon } from '../ui/Icon'
import { useTheme } from '../ui/theme'

export function ModelDownloadBanner() {
  const { colors } = useTheme()
  const router = useRouter()
  const status = useModelStore((s) => s.status)
  const progress = useModelStore((s) => s.progress)
  if (status !== 'downloading') return null
  const value = Math.max(0, Math.min(100, Math.round(progress)))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pobieranie modelu, ${value} procent. Otwórz ustawienia`}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => ({
        marginHorizontal: 24,
        marginBottom: 10,
        borderRadius: 12,
        padding: 12,
        backgroundColor: colors.accentSoft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="download" size={19} color={colors.accent} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.body, fontSize: 12 }}>
            Pobieranie modelu
          </Text>
          <Text
            style={{
              color: colors.accent,
              fontSize: 12,
              fontWeight: '600',
              fontVariant: ['tabular-nums'],
            }}
          >
            {value}%
          </Text>
        </View>
        <View
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.line,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 3,
              width: `${value}%`,
              backgroundColor: colors.accent,
            }}
          />
        </View>
      </View>
      <Icon name="chevron-right" size={16} color={colors.accent} />
    </Pressable>
  )
}
