import { usePathname, useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'
import { useCaptureActivity } from './useCaptureActivity'

export function RecordingBanner() {
  const activity = useCaptureActivity()
  const path = usePathname()
  const router = useRouter()
  const { t } = useI18n()
  const { colors } = useTheme()
  if (!activity || path === '/record') return null
  const seconds = Math.floor(activity.durationMs / 1000)
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const interrupted = activity.state === 'interrupted'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${interrupted ? t('Nagranie przerwane', 'Recording interrupted') : t('Trwa nagrywanie', 'Recording in progress')}. ${duration}. ${t('Wróć do nagrania', 'Return to recording')}`}
      onPress={() => router.navigate('/record')}
      style={({ pressed }) => ({
        marginHorizontal: 20,
        marginBottom: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: colors.emberSoft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon name="mic" size={18} color={colors.ember} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.label, color: colors.ink }}>
          {interrupted
            ? t('Nagranie przerwane', 'Recording interrupted')
            : t('Trwa nagrywanie', 'Recording in progress')}
        </Text>
        {interrupted && (
          <Text style={{ ...type.meta, color: colors.body }}>
            {t('Dotknij, aby wznowić lub zapisać', 'Tap to resume or save')}
          </Text>
        )}
      </View>
      <Text
        style={{
          ...type.label,
          color: colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {duration}
      </Text>
      <Icon name="chevron-right" size={16} color={colors.body} />
    </Pressable>
  )
}
