import { useI18n } from '../i18n/useI18n'
import { useState } from 'react'
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native'
import type { NoteSortMode } from './noteListView'
import { Icon, IconButton } from '../ui/Icon'
import { BottomSheet } from '../ui/BottomSheet'
import { Group } from '../ui/Grouped'
import { type, useTheme, font } from '../ui/theme'
import { categoryLabel } from '../domain/categories'

interface NotesToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  sortMode: NoteSortMode
  onSortModeChange: (mode: NoteSortMode) => void
  categories: readonly string[]
  selectedCategory: string | null
  onSelectCategory: (category: string | null) => void
}

function ChoiceRow({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 12,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ ...type.body, color: colors.ink }}>{label}</Text>
      {selected && <Icon name="check" size={18} color={colors.accent} />}
    </Pressable>
  )
}

// Search field with a sort icon; sorting and the category filter live in a sheet.
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
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <View
        style={{
          height: 38,
          borderRadius: 10,
          backgroundColor: colors.field,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 10,
          gap: 8,
        }}
      >
        <Icon name="search" size={18} color={colors.secondary} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={t('Szukaj', 'Search')}
          placeholderTextColor={colors.secondary}
          accessibilityLabel={t('Szukaj w notatkach', 'Search notes')}
          autoCorrect={false}
          returnKeyType="search"
          keyboardAppearance={isDark ? 'dark' : 'light'}
          selectionColor={colors.accent}
          style={{ flex: 1, height: 38, color: colors.ink, ...font.regular, fontSize: 17, padding: 0 }}
        />
        {!!query && (
          <IconButton
            name="close"
            label={t('Wyczyść wyszukiwanie', 'Clear search')}
            color={colors.secondary}
            onPress={() => onQueryChange('')}
            size={16}
          />
        )}
        <IconButton
          name="sort"
          label={t('Sortowanie i filtry', 'Sort and filters')}
          color={selectedCategory ? colors.accent : colors.secondary}
          onPress={() => {
            Keyboard.dismiss()
            setOpen(true)
          }}
          size={18}
        />
      </View>
      <BottomSheet
        visible={open}
        title={t('Sortowanie i filtry', 'Sort and filters')}
        onClose={() => setOpen(false)}
      >
        <Group>
          {(
            [
              { mode: 'updated', label: t('Ostatnio zmienione', 'Recently changed') },
              { mode: 'created', label: t('Ostatnio dodane', 'Recently added') },
            ] as const
          ).map(({ mode, label }) => (
            <ChoiceRow
              key={mode}
              label={label}
              selected={sortMode === mode}
              onPress={() => {
                onSortModeChange(mode)
                setOpen(false)
              }}
            />
          ))}
        </Group>
        {!!categories.length && (
          <>
            <Text
              style={{ ...type.caption, color: colors.secondary, marginTop: 16, marginBottom: 8, marginHorizontal: 4 }}
            >
              {t('Kategoria', 'Category')}
            </Text>
            <Group>
              {[null, ...categories].map((category) => (
                <ChoiceRow
                  key={category ?? 'all'}
                  label={category === null ? t('Wszystkie', 'All') : categoryLabel(category, language)}
                  selected={selectedCategory === category}
                  onPress={() => {
                    onSelectCategory(category)
                    setOpen(false)
                  }}
                />
              ))}
            </Group>
          </>
        )}
      </BottomSheet>
    </View>
  )
}
