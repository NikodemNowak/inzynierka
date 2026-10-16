import { addTaskToCalendar, addTaskToReminders } from './taskCalendar'
import { getCalendars, requestRemindersPermissions } from 'expo-calendar'
import { createEventInCalendarAsync } from 'expo-calendar/legacy'

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
const createReminder = jest.fn(async () => ({}))
jest.mock('expo-calendar', () => ({
  EntityTypes: { REMINDER: 'reminder', EVENT: 'event' },
  requestRemindersPermissions: jest.fn(),
  getCalendars: jest.fn(),
}))
jest.mock('expo-calendar/legacy', () => ({ createEventInCalendarAsync: jest.fn() }))

// Wednesday 14 October 2026, 10:00
const recorded = new Date(2026, 9, 14, 10, 0)

beforeEach(() => {
  createReminder.mockClear()
  jest.mocked(requestRemindersPermissions).mockResolvedValue({ granted: true } as never)
  jest.mocked(getCalendars).mockResolvedValue([{ allowsModifications: false }, { allowsModifications: true, createReminder }] as never)
})

test('a reminder gets its title, due date and an alarm at that time', async () => {
  await expect(addTaskToReminders('Wizyta u psychologa — jutro 18:00', recorded, 'Z notatki: Zajęcia')).resolves.toBe('added')
  expect(createReminder).toHaveBeenCalledWith({
    title: 'Wizyta u psychologa',
    notes: 'Z notatki: Zajęcia',
    dueDate: new Date(2026, 9, 15, 18, 0),
    alarms: [{ absoluteDate: new Date(2026, 9, 15, 18, 0).toISOString() }],
  })
})

test('an all-day reminder rings in the morning, and one without a date has none', async () => {
  await addTaskToReminders('Zapłacić czynsz — do końca miesiąca', recorded)
  expect(createReminder.mock.calls[0]![0]).toMatchObject({ dueDate: new Date(2026, 9, 31), alarms: [{ absoluteDate: new Date(2026, 9, 31, 9, 0).toISOString() }] })
  await addTaskToReminders('Kupić mleko', recorded)
  expect(createReminder.mock.calls[1]![0]).toEqual({ title: 'Kupić mleko', notes: undefined })
})

test('denied permission adds nothing', async () => {
  jest.mocked(requestRemindersPermissions).mockResolvedValue({ granted: false } as never)
  await expect(addTaskToReminders('Kupić mleko', recorded)).resolves.toBe('denied')
  expect(createReminder).not.toHaveBeenCalled()
})

test('the calendar form opens prefilled and reports what the user did', async () => {
  jest.mocked(createEventInCalendarAsync).mockResolvedValue({ action: 'saved', id: '1' } as never)
  await expect(addTaskToCalendar('Wizyta u dentysty — czwartek 16:30', recorded)).resolves.toBe('added')
  expect(createEventInCalendarAsync).toHaveBeenCalledWith({
    title: 'Wizyta u dentysty', notes: undefined, startDate: new Date(2026, 9, 15, 16, 30), endDate: new Date(2026, 9, 15, 17, 30), allDay: false,
  })
  jest.mocked(createEventInCalendarAsync).mockResolvedValue({ action: 'canceled', id: null } as never)
  await expect(addTaskToCalendar('Kupić mleko', recorded)).resolves.toBe('cancelled')
})
