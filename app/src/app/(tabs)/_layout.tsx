import { useI18n } from '../../i18n/useI18n'
import type { ComponentProps } from 'react'
import { Redirect, Tabs } from 'expo-router'
import { View } from 'react-native'
import { useSettingsStore } from '../../state/settingsStore'
import { HomeHeader, HomeNavigation } from '../../ui/HomeNavigation'
import { useTheme } from '../../ui/theme'
import { RecordingBanner } from '../../stt/RecordingBanner'

type TabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>['tabBar']>
>[0]
type TabLayoutProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>['layout']>
>[0]

function HomeTabBar({ state, navigation }: TabBarProps) {
  return (
    <HomeNavigation
      active={state.routes[state.index]?.name === 'tasks' ? 'tasks' : 'notes'}
      onSelect={(tab) => {
        const route = state.routes.find(
          (item) => item.name === (tab === 'notes' ? 'index' : 'tasks'),
        )
        if (!route) return
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        })
        if (!event.defaultPrevented) navigation.navigate(route.name)
      }}
    />
  )
}

function HomeFrame({ state, children }: TabLayoutProps) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <HomeHeader
        title={
          state.routes[state.index]?.name === 'tasks'
            ? t('Zadania', 'Tasks')
            : t('Notatki', 'Notes')
        }
      />
      <RecordingBanner />
      {children}
    </View>
  )
}

export default function HomeTabsLayout() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const loaded = useSettingsStore((state) => state.loaded)
  const onboardingCompleted = useSettingsStore(
    (state) => state.onboardingCompleted,
  )
  if (!loaded)
    return <View style={{ flex: 1, backgroundColor: colors.canvas }} />
  if (!onboardingCompleted) return <Redirect href="/welcome" />

  return (
    <Tabs
      initialRouteName="index"
      backBehavior="initialRoute"
      layout={HomeFrame}
      tabBar={HomeTabBar}
      screenOptions={{
        headerShown: false,
        animation: 'none',
        freezeOnBlur: true,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('Notatki', 'Notes') }} />
      <Tabs.Screen name="tasks" options={{ title: t('Zadania', 'Tasks') }} />
    </Tabs>
  )
}
