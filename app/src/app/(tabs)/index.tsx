import { useI18n } from '../../i18n/useI18n'
import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { SectionList, Text, View } from 'react-native'
import { useNotesStore } from '../../state/notesStore'
import { useSettingsStore } from '../../state/settingsStore'
import { NOTE_CATEGORIES } from '../../domain/categories'
import { NoteRow } from '../../notes/NoteRow'
import { NotesToolbar } from '../../notes/NotesToolbar'
import { ModelDownloadBanner } from '../../notes/ModelDownloadBanner'
import {
  NotesEmptyState,
  NotesNoResultsState,
} from '../../notes/NotesEmptyStates'
import { DraftBanner } from '../../notes/DraftBanner'
import { NextTaskBanner } from '../../notes/NextTaskBanner'
import { groupNotesByDate, selectVisibleNotes } from '../../notes/noteListView'
import { type, useTheme } from '../../ui/theme'

export default function NotesListScreen() {
  const { colors } = useTheme()
  const { language } = useI18n()
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
    () => groupNotesByDate(visibleNotes, sortMode, new Date(), language),
    [visibleNotes, sortMode, language],
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
          afterSearch={<ModelDownloadBanner />}
        />
      )}
      {!notes.length && <ModelDownloadBanner />}
      {notes.length > 0 && !query.trim() && <NextTaskBanner />}
      {!notes.length ? (
        <NotesEmptyState />
      ) : !visibleNotes.length ? (
        <NotesNoResultsState
          hasSearch={query.trim().length > 0}
          onClear={() => {
            if (query.trim()) {
              setQuery('')
              return
            }
            setCategory(null)
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
                fontSize: 13,
                lineHeight: 18,
                marginTop: 14,
                marginBottom: 8,
                marginLeft: 4,
              }}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <NoteRow
              note={item}
              timestamp={
                sortMode === 'created' ? item.createdAt : item.updatedAt
              }
              groupPosition={
                section.data.length === 1
                  ? 'only'
                  : index === 0
                    ? 'first'
                    : index === section.data.length - 1
                      ? 'last'
                      : 'middle'
              }
              onPress={() => router.push(`/note/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  )
}
