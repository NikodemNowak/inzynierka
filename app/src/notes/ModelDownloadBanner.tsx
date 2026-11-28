import { useI18n } from '../i18n/useI18n'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View, type ViewStyle } from 'react-native'
import { hasPreviousModel } from '../ai/modelDownload'
import { MODEL_CONFIG } from '../ai/modelConfig'
import { useModelStore } from '../state/modelStore'
import { Group } from '../ui/Grouped'
import { Icon } from '../ui/Icon'
import { type, useTheme } from '../ui/theme'

const rowStyle = (pressed: boolean): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingVertical: 11,
  paddingHorizontal: 16,
  opacity: pressed ? 0.6 : 1,
})

// `canvas`: the banner sits on a page that is itself a group colour (Ask), so the card takes the canvas fill.
const groupStyle = (inset: number, fill?: string): ViewStyle => ({ marginHorizontal: inset, marginVertical: 8, ...(fill ? { backgroundColor: fill } : null) })

// Without the model the summary, task and chat buttons are disabled, so a missing
// model has to be said where those buttons are, not only in Settings.
function ModelMissingBanner({ inset, onCanvas }: { inset: number; onCanvas: boolean }) {
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
    <Group style={groupStyle(inset, onCanvas ? colors.canvas : undefined)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${body} ${t('Otwórz ustawienia', 'Open settings')}`}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => rowStyle(pressed)}
      >
        <Icon name="download" size={20} color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.label, color: colors.ink }}>{title}</Text>
          <Text style={{ ...type.meta, color: colors.secondary }}>{body}</Text>
        </View>
        <Icon name="chevron-right" size={16} color={colors.faint} />
      </Pressable>
    </Group>
  )
}

export function ModelDownloadBanner({ inset = 16, onCanvas = false }: { inset?: number; onCanvas?: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const router = useRouter()
  const status = useModelStore((s) => s.status)
  const progress = useModelStore((s) => s.progress)
  if (status === 'absent') return <ModelMissingBanner inset={inset} onCanvas={onCanvas} />
  if (status !== 'downloading') return null
  const value = Math.max(0, Math.min(100, Math.round(progress)))
  return (
    <Group style={groupStyle(inset, onCanvas ? colors.canvas : undefined)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          `Pobieranie modelu, ${value} procent. Otwórz ustawienia`,
          `Downloading model, ${value} percent. Open settings`,
        )}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => rowStyle(pressed)}
      >
        <Icon name="download" size={20} color={colors.accent} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ ...type.label, color: colors.ink }}>
              {t('Model · pobieranie', 'Model · downloading')}
            </Text>
            <Text style={{ ...type.meta, color: colors.secondary, fontVariant: ['tabular-nums'] }}>
              {value}%
            </Text>
          </View>
          <View
            style={{ height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: 'hidden' }}
          >
            <View
              style={{
                height: 4,
                width: '100%',
                backgroundColor: colors.accent,
                transformOrigin: 'left center',
                transform: [{ scaleX: value / 100 }],
              }}
            />
          </View>
        </View>
        <Icon name="chevron-right" size={16} color={colors.faint} />
      </Pressable>
    </Group>
  )
}
