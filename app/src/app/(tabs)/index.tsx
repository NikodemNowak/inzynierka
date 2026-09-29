import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { SectionList, Text, View } from 'react-native'
import { useNotesStore } from '../../state/notesStore'
import { useSettingsStore } from '../../state/settingsStore'
import { NOTE_CATEGORIES } from '../../domain/categories'
import { NoteRow } from '../../notes/NoteRow'
import { NotesToolbar } from '../../notes/NotesToolbar'
import { DraftBanner } from '../../notes/DraftBanner'
import { groupNotesByDate, selectVisibleNotes } from '../../notes/noteListView'
import { EmptyState } from '../../ui/EmptyState'
import { type, useTheme } from '../../ui/theme'

export default function NotesListScreen() {
  const { colors } = useTheme()
  const notes = useNotesStore((state) => state.notes)
  const sortMode = useSettingsStore((state) => state.sortMode)
  const setSortMode = useSettingsStore((state) => state.setSortMode)
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const usedCategories = useMemo(
    () => NOTE_CATEGORIES.filter((c) => notes.some((n) => n.tags.includes(c))),
    [notes],
  )
  const visibleNotes = useMemo(
    () => selectVisibleNotes(notes, { query, category, sortMode }),
    [notes, query, category, sortMode],
  )
  const sections = useMemo(
    () => groupNotesByDate(visibleNotes, sortMode),
    [visibleNotes, sortMode],
  )
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <DraftBanner />
      {notes.length > 0 && (
        <NotesToolbar
          query={query}
          onQueryChange={setQuery}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          categories={usedCategories}
          selectedCategory={category}
          onSelectCategory={setCategory}
        />
      )}
      {!notes.length ? (
        <EmptyState
          title="Miejsce na Twoje myśli"
          description="Dotknij plusa na dole, aby nagrać, zaimportować lub napisać pierwszą notatkę."
        />
      ) : !visibleNotes.length ? (
        <EmptyState
          icon="search"
          title="Brak wyników"
          description={
            query.trim()
              ? `Nie znaleźliśmy notatek pasujących do „${query.trim()}”.`
              : 'W tej kategorii nie ma jeszcze notatek.'
          }
          action={{
            label: 'Wyczyść filtry',
            onPress: () => {
              setQuery('')
              setCategory(null)
            },
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20 }}
          renderSectionHeader={({ section }) => (
            <Text
              style={{
                ...type.label,
                color: colors.muted,
                fontSize: 12,
                marginTop: 10,
                marginBottom: 10,
              }}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <NoteRow
              note={item}
              timestamp={
                sortMode === 'created' ? item.createdAt : item.updatedAt
              }
              onPress={() => router.push(`/note/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  )
}
