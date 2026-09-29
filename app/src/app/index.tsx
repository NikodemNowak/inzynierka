import { useState } from 'react'
import { Link, Redirect, Stack, useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNotesStore } from '../state/notesStore'
import { useSettingsStore } from '../state/settingsStore'
import { NOTE_CATEGORIES } from '../domain/categories'
import { NoteRow } from '../notes/NoteRow'
import { NotesToolbar } from '../notes/NotesToolbar'
import { DraftBanner } from '../notes/DraftBanner'
import { selectVisibleNotes } from '../notes/noteListView'
import { Button } from '../ui/Button'
import { colors, radius, spacing, type } from '../ui/theme'

export default function NotesListScreen() {
  const notes = useNotesStore((state) => state.notes)
  const sortMode = useSettingsStore((state) => state.sortMode)
  const setSortMode = useSettingsStore((state) => state.setSortMode)
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const onboardingCompleted = useSettingsStore((state) => state.onboardingCompleted)
  const router = useRouter()
  const insets = useSafeAreaInsets()

  // Search text and the selected category are transient: reopening the list
  // should show everything, the way any search box behaves. Only the sort mode
  // is a preference worth persisting.
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const usedCategories = NOTE_CATEGORIES.filter((c) => notes.some((n) => n.tags.includes(c)))
  const visibleNotes = selectVisibleNotes(notes, { query, category, sortMode })

  const clearFilters = () => {
    setQuery('')
    setCategory(null)
  }

  // First run: explain what the app does and ask about the model download before
  // anything else happens. Waits for settings so the screen never flashes.
  if (!settingsLoaded) return <View style={styles.screen} />
  if (!onboardingCompleted) return <Redirect href="/welcome" />

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Notatki',
          headerRight: () => (
            <View style={styles.headerLinks}>
              <Pressable
                onPress={() => router.push('/tasks')}
                style={styles.headerAction}
                accessibilityRole="button"
              >
                <Text style={styles.headerLink}>Zadania</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/settings')}
                style={styles.headerAction}
                accessibilityRole="button"
              >
                <Text style={styles.headerLink}>Ustawienia</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <DraftBanner />

      {notes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Jeszcze nic tu nie ma</Text>
          <Text style={styles.emptyBody}>
            Nagraj pierwszą notatkę. Mowa zamieni się w tekst na tym urządzeniu.
          </Text>
        </View>
      ) : (
        <>
          <NotesToolbar
            query={query}
            onQueryChange={setQuery}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            categories={usedCategories}
            selectedCategory={category}
            onSelectCategory={setCategory}
          />
          {visibleNotes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Brak wyników</Text>
              <Text style={styles.emptyBody}>
                {query.trim().length > 0
                  ? `Żadna notatka nie zawiera „${query.trim()}”.`
                  : 'Żadna notatka nie należy do tej kategorii.'}
              </Text>
              <Button label="Wyczyść filtry" onPress={clearFilters} style={styles.emptyAction} />
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={visibleNotes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <NoteRow
                  note={item}
                  timestamp={sortMode === 'created' ? item.createdAt : item.updatedAt}
                  onPress={() => router.push(`/note/${item.id}`)}
                />
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </>
      )}

      {/* Recording is what the app is for, so it sits under the thumb rather
          than crowded into the header with everything else. */}
      <View style={[styles.actionBar, { paddingBottom: spacing.sm + insets.bottom }]}>
        <Button label="Nagraj notatkę" variant="primary" onPress={() => router.push('/record')} />
        <View style={styles.secondaryActions}>
          <Button label="Wczytaj plik" variant="quiet" onPress={() => router.push('/import')} />
          <Text style={styles.actionDivider}>·</Text>
          <Button label="Wpisz ręcznie" variant="quiet" onPress={() => router.push('/note/new')} />
        </View>
      </View>

      {__DEV__ && (
        <View style={[styles.devBar, { paddingBottom: insets.bottom }]}>
          <Link href="/dev/poc" style={styles.devLink}>
            POC LLM
          </Link>
          <Link href="/dev/stt-probe" style={styles.devLink}>
            STT probe
          </Link>
          <Link href="/dev/metrics" style={styles.devLink}>
            Wydajność
          </Link>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  listContent: { paddingBottom: spacing.sm },
  separator: { height: 1, backgroundColor: colors.line, marginLeft: spacing.lg },
  headerLinks: { flexDirection: 'row', gap: spacing.md },
  headerAction: { minHeight: 44, justifyContent: 'center' },
  headerLink: { ...type.label, color: colors.navy },
  empty: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...type.title, color: colors.ink },
  emptyBody: { ...type.body, color: colors.muted },
  emptyAction: { alignSelf: 'flex-start', marginTop: spacing.sm },
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
    gap: spacing.xs,
  },
  secondaryActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionDivider: { color: colors.faint, paddingHorizontal: spacing.xs },
  devBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  devLink: { ...type.meta, color: colors.faint },
})
