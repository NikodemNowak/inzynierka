import type { ComponentProps } from 'react'
import { Redirect, Tabs } from 'expo-router'
import { View } from 'react-native'
import { useSettingsStore } from '../../state/settingsStore'
import { ModelDownloadBanner } from '../../notes/ModelDownloadBanner'
import { HomeHeader, HomeNavigation } from '../../ui/HomeNavigation'
import { useTheme } from '../../ui/theme'

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]
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
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <HomeHeader
        title={state.routes[state.index]?.name === 'tasks' ? 'Zadania' : 'Notatki'}
      />
      <ModelDownloadBanner />
      {children}
    </View>
  )
}

export default function HomeTabsLayout() {
  const { colors } = useTheme()
  const loaded = useSettingsStore((state) => state.loaded)
  const onboardingCompleted = useSettingsStore((state) => state.onboardingCompleted)
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />
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
      <Tabs.Screen name="index" options={{ title: 'Notatki' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Zadania' }} />
    </Tabs>
  )
}
