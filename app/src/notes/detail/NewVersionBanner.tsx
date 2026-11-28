import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text } from 'react-native'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { type, useTheme } from '../../ui/theme'
import { CROSSFADE_MS } from './Crossfade'

export function NewVersionBanner({ onOpen, onDiscard, busy, reducedMotion }: {
  onOpen: () => void
  onDiscard: () => void
  busy: boolean
  reducedMotion: boolean
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const appear = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current
  useEffect(() => {
    if (reducedMotion) return
    Animated.timing(appear, { toValue: 1, duration: CROSSFADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [appear, reducedMotion])
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.tint, opacity: appear }]}
    >
      <Text style={[styles.text, { color: colors.onTint }]}>{t('Nowa wersja jest gotowa', 'A new version is ready')}</Text>
      <Button compact variant="quiet" label={t('Odrzuć', 'Discard')} onPress={onDiscard} disabled={busy} />
      <Button compact variant="primary" label={t('Zobacz', 'View')} onPress={onOpen} disabled={busy} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  text: { ...type.label, flex: 1 },
})
