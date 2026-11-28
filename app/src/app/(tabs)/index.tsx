import { useI18n } from '../../i18n/useI18n'
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { SectionList, View, type SectionListRenderItem } from 'react-native'
import type { Note } from '../../domain/note'
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
import { AskCard } from '../../notes/AskCard'
import { NextTaskBanner, useNextTask } from '../../notes/NextTaskBanner'
import { listExtras } from '../../notes/listExtras'
import { groupNotesByDate, selectVisibleNotes } from '../../notes/noteListView'
import { ScreenTitle, SettingsButton } from '../../ui/ScreenTitle'
import { SectionTitle } from '../../ui/Grouped'
import { useTheme } from '../../ui/theme'

type Section = { title: string; data: Note[] }

const keyOfNote = (item: Note): string => item.id

export default function NotesListScreen() {
  const { colors } = useTheme()
  const { language, t } = useI18n()
  const notes = useNotesStore((state) => state.notes)
  const sortMode = useSettingsStore((state) => state.sortMode)
  const setSortMode = useSettingsStore((state) => state.setSortMode)
  const router = useRouter()
  const nextTask = useNextTask()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const usedCategories = useMemo(
    () => NOTE_CATEGORIES.filter((c) => notes.some((n) => n.tags.includes(c))),
    [notes],
  )
  // The input stays responsive; filtering the list follows at lower priority.
  const deferredQuery = useDeferredValue(query)
  const visibleNotes = useMemo(
    () => selectVisibleNotes(notes, { query: deferredQuery, category, sortMode }),
    [notes, deferredQuery, category, sortMode],
  )
  const sections = useMemo(
    () => groupNotesByDate(visibleNotes, sortMode, new Date(), language),
    [visibleNotes, sortMode, language],
  )
  // One stable handler per note id, so memoized rows are not invalidated.
  const handlers = useRef(new Map<string, () => void>())
  const handlerFor = useCallback(
    (id: string): (() => void) => {
      let handler = handlers.current.get(id)
      if (!handler) {
        handler = () => router.push(`/note/${id}`)
        handlers.current.set(id, handler)
      }
      return handler
    },
    [router],
  )
  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={{ paddingHorizontal: 16 }}>
        <SectionTitle>{section.title}</SectionTitle>
      </View>
    ),
    [],
  )
  const renderItem: SectionListRenderItem<Note, Section> = useCallback(
    ({ item, index, section }) => (
      <View style={{ paddingHorizontal: 16 }}>
      <NoteRow
        note={item}
        timestamp={sortMode === 'created' ? item.createdAt : item.updatedAt}
        groupPosition={
          section.data.length === 1
            ? 'only'
            : index === 0
              ? 'first'
              : index === section.data.length - 1
                ? 'last'
                : 'middle'
        }
        onPress={handlerFor(item.id)}
      />
      </View>
    ),
    [sortMode, handlerFor],
  )
  const extras = listExtras({ noteCount: notes.length, nextTask, query })
  const header = (
    <View>
      <ModelDownloadBanner />
      {extras.ask && <AskCard onPress={() => router.push('/ask')} />}
      {extras.nextTask && nextTask && <NextTaskBanner next={nextTask} />}
    </View>
  )
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenTitle title={t('Notatki', 'Notes')} right={<SettingsButton />} />
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
      {(!notes.length || !visibleNotes.length) && <ModelDownloadBanner />}
      {!notes.length ? (
        <NotesEmptyState />
      ) : !visibleNotes.length ? (
        <NotesNoResultsState
          hasSearch={deferredQuery.trim().length > 0}
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
          keyExtractor={keyOfNote}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
        />
      )}
    </View>
  )
}
