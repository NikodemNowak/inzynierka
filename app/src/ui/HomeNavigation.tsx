import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Icon, IconButton, type IconName } from './Icon'
import { type, useTheme } from './theme'

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
              <Icon name="plus" size={28} color={colors.onAction} />
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
                  fontWeight: active === tab ? '600' : '400',
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
        {addOptions.map((option) => (
          <Pressable
            key={option.route}
            accessibilityRole="button"
            onPress={() => {
              setAdding(false)
              router.push(option.route)
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: 15,
              alignItems: 'center',
              padding: 16,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.paper,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 32,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={option.icon} color={colors.accent} size={24} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ ...type.title, fontSize: 17, color: colors.ink }}>
                {t(option.title, option.titleEn)}
              </Text>
              <Text style={{ ...type.meta, fontSize: 13, color: colors.muted }}>
                {t(option.description, option.descriptionEn)}
              </Text>
            </View>
            <Icon name="chevron-right" color={colors.faint} size={18} />
          </Pressable>
        ))}
        <Button
          label={t('Anuluj', 'Cancel')}
          variant="quiet"
          onPress={() => setAdding(false)}
        />
      </BottomSheet>
    </>
  )
}
