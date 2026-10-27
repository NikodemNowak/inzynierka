import { useI18n } from '../i18n/useI18n'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useModelStore } from '../state/modelStore'
import { Icon } from '../ui/Icon'
import { radius, useTheme, fonts } from '../ui/theme'

export function ModelDownloadBanner() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const router = useRouter()
  const status = useModelStore((s) => s.status)
  const progress = useModelStore((s) => s.progress)
  if (status !== 'downloading') return null
  const value = Math.max(0, Math.min(100, Math.round(progress)))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        `Pobieranie modelu, ${value} procent. Otwórz ustawienia`,
        `Downloading model, ${value} percent. Open settings`,
      )}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => ({
        marginHorizontal: 24,
        marginTop: 8,
        marginBottom: 8,
        borderRadius: radius.lg,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: colors.paper,
        borderWidth: 1,
        borderColor: colors.line,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="download" size={19} color={colors.ink} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.body, fontSize: 12, fontFamily: fonts.regular }}>
            {t('Model · pobieranie', 'Model · downloading')}
          </Text>
          <Text
            style={{
              color: colors.ink,
              fontSize: 12,
              fontFamily: fonts.semibold,
              fontVariant: ['tabular-nums'],
            }}
          >
            {value}%
          </Text>
        </View>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.surface,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 4,
              width: '100%',
              backgroundColor: colors.marker,
              transformOrigin: 'left center',
              transform: [{ scaleX: value / 100 }],
            }}
          />
        </View>
      </View>
      <Icon name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  )
}
