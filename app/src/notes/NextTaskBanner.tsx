import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { useNoteCreatedMap } from './useNoteCreatedMap'
import { useTasksStore } from '../state/tasksStore'
import { splitTaskText } from '../tasks/taskDue'
import { groupTasksByDue } from '../tasks/taskGroups'
import { fonts, radius, useTheme } from '../ui/theme'

// The day's first open task, pulled from every note, above the list.
export function NextTaskBanner() {
  const { colors, isDark } = useTheme()
  const { t, locale } = useI18n()
  const router = useRouter()
  const tasks = useTasksStore((state) => state.tasks)
  const created = useNoteCreatedMap()
  const today = useMemo(
    () => groupTasksByDue(tasks.filter((task) => !task.done), created, new Date()).get('today') ?? [],
    [tasks, created],
  )
  const next = today[0]
  if (!next) return null
  const time = next.due && !next.allDay
    ? next.due.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : t('Dziś', 'Today')
  const title = splitTaskText(next.task.text).title
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`Najbliższe zadanie: ${title}, ${time}. Otwórz notatkę`, `Next task: ${title}, ${time}. Open the note`)}
      onPress={() => router.push(`/note/${next.task.noteId}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        marginHorizontal: 24,
        marginBottom: 8,
        paddingHorizontal: 14,
        borderRadius: radius.lg,
        backgroundColor: colors.brand,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ minHeight: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center', backgroundColor: colors.onBrand }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.brand, fontVariant: ['tabular-nums'] }}>{time}</Text>
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 15, color: isDark ? colors.onBrand : colors.onAction }}>{title}</Text>
      {today.length > 1 && (
        <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: isDark ? colors.onBrand : colors.faint }}>
          {t(`+${today.length - 1} dziś`, `+${today.length - 1} today`)}
        </Text>
      )}
    </Pressable>
  )
}
