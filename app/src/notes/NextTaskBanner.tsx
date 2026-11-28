import { plPlural } from '../i18n/plPlural'
import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { useNoteCreatedMap } from './useNoteCreatedMap'
import { useTasksStore } from '../state/tasksStore'
import { splitTaskText } from '../tasks/taskDue'
import { groupTasksByDue } from '../tasks/taskGroups'
import { Group } from '../ui/Grouped'
import { type, useTheme } from '../ui/theme'

export interface NextTask {
  readonly noteId: string
  readonly title: string
  readonly due: Date | null
  readonly allDay: boolean
  readonly overdue: boolean
  readonly more: number
}

// The first open task that is overdue or due today, pulled from every note.
export function useNextTask(): NextTask | null {
  const tasks = useTasksStore((state) => state.tasks)
  const created = useNoteCreatedMap()
  return useMemo(() => {
    const groups = groupTasksByDue(tasks.filter((task) => !task.done), created, new Date())
    const overdue = groups.get('overdue') ?? []
    const today = groups.get('today') ?? []
    const next = overdue[0] ?? today[0]
    if (!next) return null
    return {
      noteId: next.task.noteId,
      title: splitTaskText(next.task.text).title,
      due: next.due,
      allDay: next.allDay,
      overdue: overdue.length > 0,
      more: overdue.length + today.length - 1,
    }
  }, [tasks, created])
}

export const morePhrase = (count: number, t: (pl: string, en: string) => string): string =>
  t(
    `+${count} ${plPlural(count, 'zadanie', 'zadania', 'zadań')}`,
    `+${count} ${count === 1 ? 'task' : 'tasks'}`,
  )

export function NextTaskBanner({ next }: { next: NextTask }) {
  const { colors } = useTheme()
  const { t, locale } = useI18n()
  const router = useRouter()
  const when = next.overdue
    ? t('Zaległe', 'Overdue')
    : next.due && !next.allDay
      ? `${t('Dziś', 'Today')} ${next.due.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
      : t('Dziś', 'Today')
  return (
    <Group style={{ marginHorizontal: 16, marginTop: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          `Najbliższe zadanie: ${next.title}, ${when}. Otwórz notatkę`,
          `Next task: ${next.title}, ${when}. Open the note`,
        )}
        onPress={() => router.push(`/note/${next.noteId}`)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          height: 46,
          paddingHorizontal: 16,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: next.overdue ? colors.red : colors.accent,
          }}
        />
        <Text numberOfLines={1} style={{ ...type.label, fontWeight: '400', color: colors.ink, flex: 1 }}>
          <Text style={{ fontWeight: '600' }}>{when}</Text>
          {` · ${next.title}`}
        </Text>
        {next.more > 0 && (
          <Text style={{ ...type.meta, color: colors.secondary }}>{morePhrase(next.more, t)}</Text>
        )}
      </Pressable>
    </Group>
  )
}
