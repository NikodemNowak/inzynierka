import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { NoteSortMode } from './noteListView'
import { colors, radius, spacing, type } from '../ui/theme'

interface NotesToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  sortMode: NoteSortMode
  onSortModeChange: (mode: NoteSortMode) => void
  // Only categories actually used by existing notes, so the filter stays bounded.
  categories: readonly string[]
  selectedCategory: string | null
  onSelectCategory: (category: string | null) => void
}

const SORT_OPTIONS: ReadonlyArray<{ mode: NoteSortMode; label: string }> = [
  { mode: 'updated', label: 'Ostatnia zmiana' },
  { mode: 'created', label: 'Data nagrania' },
]

export function NotesToolbar({
  query,
  onQueryChange,
  sortMode,
  onSortModeChange,
  categories,
  selectedCategory,
  onSelectCategory,
}: NotesToolbarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Szukaj w notatkach"
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          // Own affordance rather than TextInput's clearButtonMode, which exists
          // on iOS only and would leave Android without a way to clear.
          <Pressable
            onPress={() => onQueryChange('')}
            hitSlop={10}
            style={styles.clear}
            accessibilityLabel="Wyczyść wyszukiwanie"
          >
            <Text style={styles.clearMark}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Sorting is a reading preference, not a filter, so it stays typographic
          — underlined text — while filters stay as chips. */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map(({ mode, label }) => (
          <Pressable key={mode} onPress={() => onSortModeChange(mode)} hitSlop={6}>
            <Text style={[styles.sort, sortMode === mode && styles.sortActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterBar}
        >
          <Pressable onPress={() => onSelectCategory(null)}>
            <Text style={[styles.chip, selectedCategory === null && styles.chipActive]}>
              Wszystkie
            </Text>
          </Pressable>
          {categories.map((category) => (
            <Pressable key={category} onPress={() => onSelectCategory(category)}>
              <Text style={[styles.chip, selectedCategory === category && styles.chipActive]}>
                {category}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  searchRow: { justifyContent: 'center', paddingHorizontal: spacing.lg },
  search: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    paddingRight: 40,
  },
  clear: { position: 'absolute', right: spacing.lg + spacing.md },
  clearMark: { fontSize: 15, color: colors.muted },
  sortRow: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.lg },
  sort: { ...type.label, color: colors.faint, paddingBottom: 2 },
  sortActive: {
    color: colors.ink,
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
  },
  filterScroll: { flexGrow: 0 },
  filterBar: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  chip: {
    ...type.label,
    color: colors.body,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy, color: colors.paper },
})
