import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { NoteSortMode } from './noteListView'

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
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          // Own affordance rather than TextInput's clearButtonMode, which exists
          // on iOS only and would leave Android without a way to clear.
          <Pressable onPress={() => onQueryChange('')} hitSlop={8} style={styles.clear}>
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.sortRow}>
        {SORT_OPTIONS.map(({ mode, label }) => (
          <Pressable key={mode} onPress={() => onSortModeChange(mode)}>
            <Text style={[styles.sortChip, sortMode === mode && styles.chipActive]}>{label}</Text>
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
            <Text style={[styles.filterChip, selectedCategory === null && styles.chipActive]}>
              Wszystkie
            </Text>
          </Pressable>
          {categories.map((category) => (
            <Pressable key={category} onPress={() => onSelectCategory(category)}>
              <Text
                style={[styles.filterChip, selectedCategory === category && styles.chipActive]}
              >
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
  container: { gap: 8, paddingTop: 8 },
  searchRow: { justifyContent: 'center', paddingHorizontal: 16 },
  search: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 36,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  clear: { position: 'absolute', right: 26 },
  clearText: { fontSize: 16, color: '#6B7280' },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  sortChip: {
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  filterScroll: { flexGrow: 0 },
  filterBar: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  filterChip: {
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  chipActive: { backgroundColor: '#1F4E79', color: '#FFFFFF' },
})
