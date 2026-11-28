import { usePathname, useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { Dot } from '../ui/Dot'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'
import { useCaptureActivity } from './useCaptureActivity'

// True while the banner is on screen. It then owns the status bar inset, so the
// screen title below must not pad for it a second time.
export function useRecordingBannerVisible(): boolean {
  const activity = useCaptureActivity()
  const path = usePathname()
  return activity !== null && path !== '/record'
}

// `inset` pads for the status bar; headers that already do so pass false.
export function RecordingBanner({ inset = true }: { inset?: boolean }) {
  const activity = useCaptureActivity()
  const path = usePathname()
  const router = useRouter()
  const { t } = useI18n()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  if (!activity || path === '/record') return null
  const seconds = Math.floor(activity.durationMs / 1000)
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const interrupted = activity.state === 'interrupted'
  return (
    <View style={{ paddingTop: inset ? insets.top : 0 }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${interrupted ? t('Nagranie przerwane', 'Recording interrupted') : t('Trwa nagrywanie', 'Recording in progress')}. ${duration}. ${t('Wróć do nagrania', 'Return to recording')}`}
      onPress={() => router.navigate('/record')}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: colors.group,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {interrupted ? (
        <Icon name="mic" size={18} color={colors.red} />
      ) : (
        <Dot color={colors.red} />
      )}
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
    </View>
  )
}
