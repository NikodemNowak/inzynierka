import { useI18n } from '../i18n/useI18n'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { radius, spacing, type, useTheme, fonts } from '../ui/theme'

export function TasksEmptyState({ onOpenNotes }: { onOpenNotes: () => void }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.container}>
      <View style={styles.illustration}>
        <View style={[styles.halo, { backgroundColor: colors.accentSoft }]} />
        <View
          style={[
            styles.clipboard,
            { borderColor: colors.faint, backgroundColor: colors.paper },
          ]}
        >
          <View
            style={[
              styles.clip,
              { backgroundColor: colors.paper, borderColor: colors.faint },
            ]}
          />
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.listRow}>
              <View style={[styles.checkbox, { borderColor: colors.faint }]} />
              <View
                style={[
                  styles.line,
                  {
                    backgroundColor: colors.faint,
                    width: index === 2 ? 26 : 35,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        <View style={[styles.dot, { backgroundColor: colors.accentSoft }]} />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.ink }]}
      >
        {t('Jeszcze bez zadań', 'No tasks yet')}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        {t(
          'Otwórz notatkę i wybierz „Zaproponuj zadania”.',
          'Open a note and choose “Suggest tasks”.',
        )}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenNotes}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.actionText, { color: colors.accent }]}>
          {t('Przejdź do notatek', 'Go to notes')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  illustration: {
    width: 154,
    height: 145,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  halo: {
    position: 'absolute',
    width: 143,
    height: 67,
    borderRadius: radius.pill,
    top: 45,
    opacity: 0.62,
  },
  clipboard: {
    width: 78,
    height: 104,
    borderWidth: 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    gap: 10,
  },
  clip: {
    position: 'absolute',
    top: -7,
    width: 29,
    height: 13,
    borderWidth: 2,
    borderRadius: 7,
  },
  listRow: { width: 48, flexDirection: 'row', alignItems: 'center', gap: 7 },
  checkbox: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3 },
  line: { height: 2, borderRadius: radius.pill, opacity: 0.76 },
  dot: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    right: 12,
    bottom: 13,
  },
  title: { ...type.title, fontSize: 23, lineHeight: 29, textAlign: 'center' },
  description: {
    ...type.body,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  action: {
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  actionText: { ...type.body, fontSize: 15, fontFamily: fonts.medium },
})
