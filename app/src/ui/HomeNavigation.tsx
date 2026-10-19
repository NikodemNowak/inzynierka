import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'expo-router'
import { Animated, Easing, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Icon, IconButton, type IconName } from './Icon'
import { useReducedMotion } from './Motion'
import { type, useTheme, fonts, radius } from './theme'

export function HomeHeader({ title }: { title: string }) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  return (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingBottom: 12,
        paddingLeft: 24,
        paddingRight: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.canvas,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          ...type.display,
          fontSize: 32,
          lineHeight: 40,
          color: colors.ink,
          flex: 1,
        }}
      >
        {title}
      </Text>
      <IconButton
        name="sparkles"
        label={t('Zapytaj notatki', 'Ask your notes')}
        onPress={() => router.push('/ask')}
      />
      <IconButton
        name="settings"
        label={t('Ustawienia', 'Settings')}
        onPress={() => router.push('/settings')}
      />
    </View>
  )
}
const addOptions: ReadonlyArray<{
  icon: IconName
  title: string
  titleEn: string
  description: string
  descriptionEn: string
  route: '/record' | '/import' | '/note/new'
}> = [
  {
    icon: 'mic',
    title: 'Nagraj',
    titleEn: 'Record',
    description: 'Mów, a tekst pojawi się na żywo',
    descriptionEn: 'Speak and see your words appear live',
    route: '/record',
  },
  {
    icon: 'file',
    title: 'Importuj audio',
    titleEn: 'Import audio',
    description: 'Zamień plik audio w notatkę',
    descriptionEn: 'Turn an audio file into a note',
    route: '/import',
  },
  {
    icon: 'edit',
    title: 'Napisz ręcznie',
    titleEn: 'Write a note',
    description: 'Zapisz myśl własnymi słowami',
    descriptionEn: 'Capture a thought in your own words',
    route: '/note/new',
  },
]
export type HomeTab = 'notes' | 'tasks'

export function HomeNavigation({
  active,
  onSelect,
}: {
  active: HomeTab
  onSelect: (tab: HomeTab) => void
}) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <View
        testID="home-tab-bar"
        style={{
          paddingBottom: Math.max(insets.bottom, 10),
          paddingTop: 10,
          borderTopWidth: 0.5,
          borderTopColor: colors.line,
          backgroundColor: colors.canvas,
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
        }}
      >
        {(['notes', 'add', 'tasks'] as const).map((tab) =>
          tab === 'add' ? (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityLabel={t('Dodaj notatkę', 'Add note')}
              onPress={() => setAdding(true)}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: colors.action,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="plus" size={28} color={colors.marker} />
            </Pressable>
          ) : (
            <Pressable
              key={tab}
              onPress={() => {
                if (active !== tab) onSelect(tab)
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active === tab }}
              accessibilityLabel={
                tab === 'notes' ? t('Notatki', 'Notes') : t('Zadania', 'Tasks')
              }
              style={{
                minWidth: 90,
                minHeight: 52,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <Icon
                name={tab === 'notes' ? 'note' : 'tasks'}
                size={22}
                color={active === tab ? colors.accent : colors.muted}
              />
              <Text
                style={{
                  fontSize: 11,
                  lineHeight: 15,
                  fontFamily: active === tab ? fonts.semibold : fonts.regular,
                  color: active === tab ? colors.accent : colors.muted,
                }}
              >
                {tab === 'notes'
                  ? t('Notatki', 'Notes')
                  : t('Zadania', 'Tasks')}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      <BottomSheet
        visible={adding}
        title={t('Nowa notatka', 'New note')}
        onClose={() => setAdding(false)}
      >
        {addOptions.map((option, index) => {
          const primary = index === 0
          return (
            <StaggerIn key={option.route} index={index} visible={adding}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t(option.title, option.titleEn)}. ${t(option.description, option.descriptionEn)}`}
                onPress={() => {
                  setAdding(false)
                  router.push(option.route)
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: primary ? 16 : 14,
                  alignItems: 'center',
                  minHeight: primary ? 88 : 64,
                  paddingHorizontal: primary ? 18 : 16,
                  borderRadius: primary ? 22 : radius.lg,
                  backgroundColor: primary ? colors.action : colors.canvas,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                {primary ? (
                  <RecordBadge />
                ) : (
                  <View style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={option.icon} color={colors.ink} size={20} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: primary ? 18 : 16, lineHeight: primary ? 24 : 22, color: primary ? colors.onAction : colors.ink }}>
                    {t(option.title, option.titleEn)}
                  </Text>
                  <Text style={{ ...type.meta, fontSize: primary ? 14 : 13, color: primary ? colors.faint : colors.muted }}>
                    {t(option.description, option.descriptionEn)}
                  </Text>
                </View>
              </Pressable>
            </StaggerIn>
          )
        })}
        <Button
          label={t('Anuluj', 'Cancel')}
          variant="quiet"
          onPress={() => setAdding(false)}
        />
      </BottomSheet>
    </>
  )
}

// Rows slide up one after another once the sheet opens.
function StaggerIn({ index, visible, children }: { index: number; visible: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(visible && !reduced ? 0 : 1)).current
  useEffect(() => {
    if (!visible || reduced) { progress.setValue(1); return }
    progress.setValue(0)
    Animated.timing(progress, { toValue: 1, duration: 320, delay: 90 + index * 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [visible, reduced, index, progress])
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      {children}
    </Animated.View>
  )
}

function RecordBadge() {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [pulse, reduced])
  return (
    <View style={{ width: 52, height: 52 }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 26, backgroundColor: colors.marker, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 26, backgroundColor: colors.marker, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="mic" size={22} color={colors.onMarker} />
      </View>
    </View>
  )
}
