import { Platform } from 'react-native'
import { requestRemindersPermissions } from 'expo-calendar'
import { createEventInCalendarAsync, createReminderAsync } from 'expo-calendar/legacy'
import { resolveDue, splitTaskText } from './taskDue'

// Hand a task to the system Reminders or Calendar app, only when the user asks.
// Calendar uses the system form: the user sees and confirms the event, and iOS
// needs no calendar permission for it. Reminders need the user's permission.

// 'opened': the system form closed without saying whether it saved (Android).
export type CalendarOutcome = 'added' | 'opened' | 'cancelled' | 'denied' | 'unavailable'

export const remindersAvailable = Platform.OS === 'ios'

// An all-day task still gets a nudge in the morning of its day.
const ALL_DAY_ALARM_HOUR = 9
const EVENT_MINUTES = 60

const atHour = (date: Date, hour: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0)

export const addTaskToReminders = async (text: string, recordedAt: Date, notes?: string): Promise<CalendarOutcome> => {
  if (!remindersAvailable) return 'unavailable'
  const permission = await requestRemindersPermissions()
  if (!permission.granted) return 'denied'
  const { title, due } = splitTaskText(text)
  const resolved = due ? resolveDue(due, recordedAt) : null
  // null: the list the user chose as default in Reminders.
  await createReminderAsync(null, {
    title,
    notes,
    ...(resolved
      ? {
          dueDate: resolved.date,
          alarms: [{ absoluteDate: (resolved.allDay ? atHour(resolved.date, ALL_DAY_ALARM_HOUR) : resolved.date).toISOString() }],
        }
      : {}),
  })
  return 'added'
}

export const addTaskToCalendar = async (text: string, recordedAt: Date, notes?: string): Promise<CalendarOutcome> => {
  const { title, due } = splitTaskText(text)
  const resolved = due ? resolveDue(due, recordedAt) : null
  // Without a date the form opens on tomorrow morning; the user picks the time there.
  const start = resolved?.date ?? atHour(new Date(recordedAt.getFullYear(), recordedAt.getMonth(), recordedAt.getDate() + 1), ALL_DAY_ALARM_HOUR)
  const allDay = resolved?.allDay ?? false
  const end = allDay ? start : new Date(start.getTime() + EVENT_MINUTES * 60000)
  const result = await createEventInCalendarAsync({ title, notes, startDate: start, endDate: end, allDay })
  return result.action === 'saved' ? 'added' : result.action === 'done' ? 'opened' : 'cancelled'
}
