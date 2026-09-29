import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet } from './BottomSheet'
import { Icon, IconButton, type IconName } from './Icon'
import { type, useTheme } from './theme'

export function HomeHeader({ title }: { title: string }) {
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
        label="Ustawienia"
        onPress={() => router.push('/settings')}
      />
    </View>
  )
}
const addOptions: ReadonlyArray<{
  icon: IconName
  title: string
  description: string
  route: '/record' | '/import' | '/note/new'
}> = [
  {
    icon: 'mic',
    title: 'Nagraj notatkę',
    description: 'Mów, a tekst pojawi się na żywo',
    route: '/record',
  },
  {
    icon: 'file',
    title: 'Importuj nagranie',
    description: 'Zamień plik audio w notatkę',
    route: '/import',
  },
  {
    icon: 'edit',
    title: 'Napisz ręcznie',
    description: 'Zapisz myśl własnymi słowami',
    route: '/note/new',
  },
]
export function HomeNavigation({ active }: { active: 'notes' | 'tasks' }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <View
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
              accessibilityLabel="Dodaj notatkę"
              onPress={() => setAdding(true)}
              style={({ pressed }) => ({
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="plus" size={28} color={colors.onAccent} />
            </Pressable>
          ) : (
            <Pressable
              key={tab}
              onPress={() => {
                if (active !== tab)
                  router.replace(tab === 'notes' ? '/' : '/tasks')
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active === tab }}
              accessibilityLabel={tab === 'notes' ? 'Notatki' : 'Zadania'}
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
                {tab === 'notes' ? 'Notatki' : 'Zadania'}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      <BottomSheet
        visible={adding}
        title="Nowa notatka"
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
              paddingVertical: 13,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={option.icon} color={colors.accent} size={24} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ ...type.title, fontSize: 17, color: colors.ink }}>
                {option.title}
              </Text>
              <Text style={{ ...type.meta, fontSize: 13, color: colors.muted }}>
                {option.description}
              </Text>
            </View>
            <Icon name="chevron-right" color={colors.faint} size={18} />
          </Pressable>
        ))}
      </BottomSheet>
    </>
  )
}
