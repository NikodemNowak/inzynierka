import { useState } from 'react'
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { NoteSortMode } from './noteListView'
import { Icon, IconButton } from '../ui/Icon'
import { BottomSheet } from '../ui/BottomSheet'
import { type, useTheme } from '../ui/theme'

interface NotesToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  sortMode: NoteSortMode
  onSortModeChange: (mode: NoteSortMode) => void
  categories: readonly string[]
  selectedCategory: string | null
  onSelectCategory: (category: string | null) => void
}
export function NotesToolbar({
  query,
  onQueryChange,
  sortMode,
  onSortModeChange,
  categories,
  selectedCategory,
  onSelectCategory,
}: NotesToolbarProps) {
  const { colors, isDark } = useTheme()
  const [sorting, setSorting] = useState(false)
  return (
    <View>
      <View
        style={{
          marginHorizontal: 24,
          borderRadius: 13,
          backgroundColor: colors.surface,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 13,
        }}
      >
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Szukaj w notatkach"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Szukaj w notatkach"
          autoCorrect={false}
          returnKeyType="search"
          keyboardAppearance={isDark ? 'dark' : 'light'}
          selectionColor={colors.accent}
          style={{
            flex: 1,
            minHeight: 46,
            color: colors.ink,
            fontSize: 15,
            paddingHorizontal: 10,
            paddingVertical: 11,
          }}
        />
        {!!query && (
          <IconButton
            name="close"
            label="Wyczyść wyszukiwanie"
            onPress={() => onQueryChange('')}
            size={17}
          />
        )}
      </View>
      {!!categories.length && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 7,
            gap: 7,
          }}
        >
          {[null, ...categories].map((category) => (
            <Pressable
              key={category ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCategory === category }}
              onPress={() => onSelectCategory(category)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 18,
                  backgroundColor:
                    selectedCategory === category
                      ? colors.accentSoft
                      : colors.surface,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 18,
                    color:
                      selectedCategory === category
                        ? colors.accent
                        : colors.body,
                    fontWeight: selectedCategory === category ? '600' : '400',
                  }}
                >
                  {category ?? 'Wszystkie'}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Pressable
        onPress={() => {
          Keyboard.dismiss()
          setSorting(true)
        }}
        accessibilityRole="button"
        accessibilityLabel="Zmień sortowanie"
        style={{
          minHeight: 42,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-end',
          marginRight: 24,
        }}
      >
        <Icon name="sort" color={colors.muted} size={13} />
        <Text style={{ ...type.meta, color: colors.muted }}>
          {sortMode === 'updated' ? 'Ostatnio zmienione' : 'Ostatnio dodane'}
        </Text>
      </Pressable>
      <BottomSheet
        visible={sorting}
        title="Sortowanie notatek"
        onClose={() => setSorting(false)}
      >
        {(
          [
            { mode: 'updated', label: 'Ostatnio zmienione' },
            { mode: 'created', label: 'Ostatnio dodane' },
          ] as const
        ).map(({ mode, label }) => (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityState={{ checked: sortMode === mode }}
            onPress={() => {
              onSortModeChange(mode)
              setSorting(false)
            }}
            style={{
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ ...type.body, color: colors.ink }}>{label}</Text>
            {sortMode === mode && <Icon name="check" color={colors.accent} />}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  )
}
