import { resolveDue, splitTaskText } from './taskDue'

// Wednesday 14 October 2026, 10:00
const base = new Date(2026, 9, 14, 10, 0)
const at = (due: string) => {
  const value = resolveDue(due, base)
  return value && { day: `${value.date.getFullYear()}-${value.date.getMonth() + 1}-${value.date.getDate()}`, time: value.allDay ? null : `${value.date.getHours()}:${String(value.date.getMinutes()).padStart(2, '0')}` }
}

test('splits title and due', () => {
  expect(splitTaskText('Wizyta u dentysty — czwartek 16:30')).toEqual({ title: 'Wizyta u dentysty', due: 'czwartek 16:30' })
  expect(splitTaskText('Kupić mleko')).toEqual({ title: 'Kupić mleko', due: null })
})

test('relative days and clock times', () => {
  expect(at('jutro 18:00')).toEqual({ day: '2026-10-15', time: '18:00' })
  expect(at('18:00 jutro')).toEqual({ day: '2026-10-15', time: '18:00' })
  expect(at('dzisiaj')).toEqual({ day: '2026-10-14', time: null })
  expect(at('pojutrze')).toEqual({ day: '2026-10-16', time: null })
  expect(at('jutro rano')).toEqual({ day: '2026-10-15', time: '9:00' })
  expect(at('tomorrow at 6 pm')).toEqual({ day: '2026-10-15', time: '18:00' })
})

test('weekdays are the next occurrence after the recording day', () => {
  expect(at('czwartek 16:30')).toEqual({ day: '2026-10-15', time: '16:30' })
  expect(at('czwartek 12:00–14:00')).toEqual({ day: '2026-10-15', time: '12:00' })
  expect(at('środa wieczorem')).toEqual({ day: '2026-10-21', time: '19:00' })
  expect(at('poniedziałek rano')).toEqual({ day: '2026-10-19', time: '9:00' })
  expect(at('do piątku')).toEqual({ day: '2026-10-16', time: null })
  expect(at('w przyszły czwartek')).toEqual({ day: '2026-10-22', time: null })
  expect(at('friday')).toEqual({ day: '2026-10-16', time: null })
})

test('month ends, dates and days of month', () => {
  expect(at('do końca miesiąca')).toEqual({ day: '2026-10-31', time: null })
  expect(at('do końca tygodnia')).toEqual({ day: '2026-10-18', time: null })
  expect(at('na początku miesiąca')).toEqual({ day: '2026-11-1', time: null })
  expect(at('do końca listopada')).toEqual({ day: '2026-11-30', time: null })
  expect(at('25 listopada')).toEqual({ day: '2026-11-25', time: null })
  expect(at('do 10')).toEqual({ day: '2026-11-10', time: null })
  expect(at('do 20')).toEqual({ day: '2026-10-20', time: null })
  expect(at('dziesiątego')).toEqual({ day: '2026-11-10', time: null })
  expect(at('za tydzień')).toEqual({ day: '2026-10-21', time: null })
  expect(at('za 3 dni')).toEqual({ day: '2026-10-17', time: null })
  expect(at('end of month')).toEqual({ day: '2026-10-31', time: null })
})

test('a time alone is today when still ahead, otherwise tomorrow', () => {
  expect(at('16:30')).toEqual({ day: '2026-10-14', time: '16:30' })
  expect(at('8:00')).toEqual({ day: '2026-10-15', time: '8:00' })
})

test('words without a date give nothing', () => {
  expect(resolveDue('przed obroną', base)).toBeNull()
  expect(resolveDue('jak najszybciej', base)).toBeNull()
})
