import { useI18n } from '../i18n/useI18n'
import { useState } from 'react'
import type { ReactNode } from 'react'
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
import { type, useTheme, fonts } from '../ui/theme'
import { categoryLabel } from '../domain/categories'

interface NotesToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  sortMode: NoteSortMode
  onSortModeChange: (mode: NoteSortMode) => void
  categories: readonly string[]
  selectedCategory: string | null
  onSelectCategory: (category: string | null) => void
  afterSearch?: ReactNode
}
export function NotesToolbar({
  query,
  onQueryChange,
  sortMode,
  onSortModeChange,
  categories,
  selectedCategory,
  onSelectCategory,
  afterSearch,
}: NotesToolbarProps) {
  const { colors, isDark } = useTheme()
  const { t, language } = useI18n()
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
          placeholder={t('Szukaj w notatkach', 'Search notes')}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t('Szukaj w notatkach', 'Search notes')}
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
            label={t('Wyczyść wyszukiwanie', 'Clear search')}
            onPress={() => onQueryChange('')}
            size={17}
          />
        )}
        <IconButton
          name="sort"
          label={t('Zmień sortowanie', 'Change sort order')}
          onPress={() => {
            Keyboard.dismiss()
            setSorting(true)
          }}
          size={17}
        />
      </View>
      {afterSearch}
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
                      ? colors.action
                      : colors.surface,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 18,
                    color:
                      selectedCategory === category
                        ? colors.onAction
                        : colors.body,
                    fontFamily: selectedCategory === category ? fonts.semibold : fonts.regular,
                  }}
                >
                  {category === null
                    ? t('Wszystkie', 'All')
                    : categoryLabel(category, language)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <BottomSheet
        visible={sorting}
        title={t('Sortowanie notatek', 'Sort notes')}
        onClose={() => setSorting(false)}
      >
        {(
          [
            {
              mode: 'updated',
              label: t('Ostatnio zmienione', 'Recently changed'),
            },
            { mode: 'created', label: t('Ostatnio dodane', 'Recently added') },
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
