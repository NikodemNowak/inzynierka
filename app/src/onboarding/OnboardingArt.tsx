import { StyleSheet, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon, type IconName } from '../ui/Icon'
import { useTheme } from '../ui/theme'

export type OnboardingPage = 0 | 1 | 2 | 3 | 4

const ICONS: IconName[] = ['lock', 'mic', 'sparkles', 'chat', 'tasks']

// One static accent icon per onboarding page.
export function OnboardingArt({ page }: { page: OnboardingPage }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const labels = [
    t('Kłódka: zapis zostaje na telefonie', 'A lock: everything stays on the phone'),
    t('Mikrofon: słowa pojawiają się podczas mówienia', 'A microphone: words appear as you speak'),
    t('Iskry: streszczenie z notatki', 'Sparkles: a summary of the note'),
    t('Czat: pytanie do notatek', 'Chat: a question to your notes'),
    t('Zadania z terminami wyłapane z notatek', 'Tasks with due dates picked up from notes'),
  ]
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={labels[page]} style={styles.scene}>
      <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
        <Icon name={ICONS[page]} size={44} color={colors.accent} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  scene: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 96, height: 96, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})
