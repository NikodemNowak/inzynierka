import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { Platform, Pressable, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../i18n/useI18n'
import { BottomSheet } from './BottomSheet'
import { Group, Row } from './Grouped'
import { Icon, type IconName } from './Icon'
import { tabBarPath } from './tabBarShape'
import { font, useTheme } from './theme'

export type HomeTab = 'notes' | 'tasks'

function TabButton({
  tab,
  active,
  onSelect,
}: {
  tab: HomeTab
  active: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  const { colors } = useTheme()
  const label = tab === 'notes' ? t('Notatki', 'Notes') : t('Zadania', 'Tasks')
  const color = active ? colors.accent : colors.secondary
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        position: 'absolute',
        top: 30,
        width: 88,
        alignItems: 'center',
        gap: 2,
        ...(tab === 'notes' ? { left: 24 } : { right: 24 }),
      }}
    >
      <Icon name={tab === 'notes' ? 'note' : 'tasks'} size={28} color={color} />
      <Text style={{ ...font.semibold, fontSize: 11, lineHeight: 14, color }}>
        {label}
      </Text>
    </Pressable>
  )
}

function SheetIcon({ name }: { name: IconName }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: colors.canvas,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={18} color={colors.accent} />
    </View>
  )
}

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
  const [width, setWidth] = useState(390)
  const path = useMemo(() => tabBarPath(width), [width])
  const go = (route: '/record' | '/import' | '/note/new') => {
    setAdding(false)
    router.push(route)
  }
  return (
    <>
      <View
        testID="home-tab-bar"
        pointerEvents="box-none"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ height: 96 + Math.max(insets.bottom - 20, 0), marginTop: -22 }}
      >
        <Svg
          width={width}
          height={96}
          viewBox={`0 0 ${width} 96`}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          <Path d={path.fill} fill={colors.bar} />
          <Path d={path.stroke} fill="none" stroke={colors.line} strokeWidth={0.75} />
        </Svg>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 95,
            bottom: 0,
            backgroundColor: colors.bar,
          }}
        />
        <TabButton
          tab="notes"
          active={active === 'notes'}
          onSelect={() => {
            if (active !== 'notes') onSelect('notes')
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Dodaj notatkę', 'Add note')}
          onPress={() => setAdding(true)}
          style={({ pressed }) => ({
            position: 'absolute',
            top: 8,
            left: width / 2 - 30,
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: colors.accent,
            shadowOpacity: 0.22,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            ...(Platform.OS === 'android' ? { elevation: 4 } : null),
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Icon name="plus" size={28} color="#FFFFFF" />
        </Pressable>
        <TabButton
          tab="tasks"
          active={active === 'tasks'}
          onSelect={() => {
            if (active !== 'tasks') onSelect('tasks')
          }}
        />
      </View>
      <BottomSheet
        visible={adding}
        title={t('Nowa notatka', 'New note')}
        onClose={() => setAdding(false)}
      >
        <Group>
          <Row
            title={t('Nagraj', 'Record')}
            subtitle={t(
              'Mów, tekst pojawia się na bieżąco',
              'Speak and watch the text appear',
            )}
            accessibilityLabel={`${t('Nagraj', 'Record')}. ${t('Mów, tekst pojawia się na bieżąco', 'Speak and watch the text appear')}`}
            leading={
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.red,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="mic" size={20} color="#FFFFFF" />
              </View>
            }
            onPress={() => go('/record')}
          />
        </Group>
        <Group style={{ marginTop: 12 }}>
          <Row
            title={t('Importuj nagranie', 'Import recording')}
            subtitle={t('Plik audio z telefonu', 'Audio file from your phone')}
            accessibilityLabel={`${t('Importuj nagranie', 'Import recording')}. ${t('Plik audio z telefonu', 'Audio file from your phone')}`}
            leading={<SheetIcon name="upload" />}
            onPress={() => go('/import')}
          />
          <Row
            title={t('Napisz notatkę', 'Write a note')}
            subtitle={t('Tekst z klawiatury', 'Type with the keyboard')}
            accessibilityLabel={`${t('Napisz notatkę', 'Write a note')}. ${t('Tekst z klawiatury', 'Type with the keyboard')}`}
            leading={<SheetIcon name="edit" />}
            onPress={() => go('/note/new')}
          />
        </Group>
      </BottomSheet>
    </>
  )
}
