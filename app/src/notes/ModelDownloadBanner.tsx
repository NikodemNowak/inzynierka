import { useI18n } from '../i18n/useI18n'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View, type ViewStyle } from 'react-native'
import { hasPreviousModel } from '../ai/modelDownload'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { useModelStore } from '../state/modelStore'
import { Icon } from '../ui/Icon'
import { radius, useTheme, fonts } from '../ui/theme'

const cardStyle = (inset: number, pressed: boolean, colors: { paper: string; line: string }): ViewStyle => ({
  marginHorizontal: inset,
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
})

// Without the model the summary, task and chat buttons are disabled, so a missing
// model has to be said where those buttons are, not only in Settings.
function ModelMissingBanner({ inset }: { inset: number }) {
  const { colors } = useTheme()
  const { t, locale } = useI18n()
  const router = useRouter()
  const [replaced, setReplaced] = useState(false)
  useEffect(() => {
    let alive = true
    hasPreviousModel().then((found) => { if (alive) setReplaced(found) }, () => undefined)
    return () => { alive = false }
  }, [])
  const size = `${(MODEL_CONFIG.approxSizeMb / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`
  const title = replaced
    ? t('Pobierz nowy model', 'Download the new model')
    : t('Pobierz model, żeby opracować notatki', 'Download the model to process notes')
  const body = replaced
    ? t(
        `Aplikacja używa teraz innego modelu. Do czasu pobrania nie powstaną tytuły, podsumowania, zadania ani odpowiedzi w czacie. Około ${size}, jednorazowo.`,
        `The app now uses a different model. Until it is downloaded there are no titles, summaries, tasks or chat answers. About ${size}, once.`,
      )
    : t(
        `Bez niego nie powstaną tytuły, podsumowania, zadania ani odpowiedzi w czacie. Około ${size}, jednorazowo; notatki zostają na telefonie.`,
        `Without it there are no titles, summaries, tasks or chat answers. About ${size}, once; notes stay on the phone.`,
      )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body} ${t('Otwórz ustawienia', 'Open settings')}`}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => cardStyle(inset, pressed, colors)}
    >
      <Icon name="download" size={19} color={colors.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontSize: 15, fontFamily: fonts.semibold }}>{title}</Text>
        <Text style={{ color: colors.body, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular }}>{body}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  )
}

export function ModelDownloadBanner({ inset = 24 }: { inset?: number }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const router = useRouter()
  const status = useModelStore((s) => s.status)
  const progress = useModelStore((s) => s.progress)
  if (status === 'absent') return <ModelMissingBanner inset={inset} />
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
      style={({ pressed }) => cardStyle(inset, pressed, colors)}
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
