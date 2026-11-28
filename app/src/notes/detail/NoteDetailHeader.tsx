import { useEffect, useState } from 'react'
import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { useI18n } from '../../i18n/useI18n'
import { BottomSheet } from '../../ui/BottomSheet'
import { Group } from '../../ui/Grouped'
import { IconButton } from '../../ui/Icon'
import { type, useTheme } from '../../ui/theme'
import type { NoteMenuAction, NoteMenuKey } from './noteMenuActions'

function HeaderButtons({ disabled, onShare, onMore }: {
  disabled: boolean
  onShare: () => void
  onMore: () => void
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  return (
    <View style={styles.buttons}>
      <IconButton name="share" label={t('Udostępnij notatkę', 'Share note')} onPress={onShare} disabled={disabled} color={colors.accent} />
      <IconButton name="more" label={t('Więcej', 'More')} onPress={onMore} disabled={disabled} color={colors.accent} />
    </View>
  )
}

// Navigation bar of a note: back, "Udostępnij" and the "…" menu. The menu is the
// native action sheet on iOS; Android alerts hold only three buttons, so there it is a sheet.
export function NoteDetailHeader({ actions, disabled, onShare, onSelect }: {
  actions: readonly NoteMenuAction[]
  disabled: boolean
  onShare: () => void
  onSelect: (key: NoteMenuKey) => void
}) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [sheetOpen, setSheetOpen] = useState(false)
  // Processing started while the Android menu was open: it must not come back when processing ends.
  useEffect(() => {
    if (disabled) setSheetOpen(false)
  }, [disabled])
  const openMenu = () => {
    if (Platform.OS !== 'ios') {
      setSheetOpen(true)
      return
    }
    const cancel = actions.length
    const destructive = actions.findIndex((action) => action.destructive)
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), t('Anuluj', 'Cancel')],
        cancelButtonIndex: cancel,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        disabledButtonIndices: actions.flatMap((action, index) => (action.disabled ? [index] : [])),
      },
      (index) => {
        const picked = actions[index]
        // The next modal can only present after the action sheet's alert controller has gone.
        if (picked && !picked.disabled) setTimeout(() => onSelect(picked.key), 0)
      },
    )
  }
  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: '',
          headerRight: () => <HeaderButtons disabled={disabled} onShare={onShare} onMore={openMenu} />,
        }}
      />
      {Platform.OS !== 'ios' && (
        <BottomSheet visible={sheetOpen && !disabled} onClose={() => setSheetOpen(false)}>
          <Group>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(action.disabled) }}
                disabled={action.disabled}
                onPress={() => {
                  setSheetOpen(false)
                  onSelect(action.key)
                }}
                style={({ pressed }) => [styles.item, { opacity: action.disabled ? 0.4 : pressed ? 0.6 : 1 }]}
              >
                <Text style={[type.body, { color: action.destructive ? colors.danger : colors.ink }]}>{action.label}</Text>
              </Pressable>
            ))}
          </Group>
        </BottomSheet>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', alignItems: 'center' },
  item: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
})
