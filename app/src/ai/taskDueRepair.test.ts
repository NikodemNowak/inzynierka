import { digitView, dueResolves, inferDue, repairDue, whenOf } from './taskDueRepair'
import { hourValues } from './taskLines'

describe('whenOf', () => {
  test('reads weekdays, clocks, dates and day parts from the digit view', () => {
    const when = whenOf(digitView('Kontrola jest dwudziestego siódmego października, we wtorek, o szesnastej piętnaście'))
    expect(when.dates).toEqual([{ day: 27, month: 'października' }])
    expect(when.weekdays.map((w) => w.index)).toEqual([2])
    expect(when.clocks.map((c) => `${c.hour}:${c.minute}`)).toEqual(['16:15'])
  })

  test('garbled weekday forms still name the day', () => {
    expect(whenOf('10 sobaty').weekdays.map((w) => w.index)).toEqual([6])
  })
})

describe('repairDue', () => {
  test('a clock number glued to a weekday becomes weekday and time', () => {
    expect(repairDue('Wymienić opony', '10 sobaty', 'Mam wymianę na sobotę dwudziestego czwartego, miało być na dziewiątą, ale przesunęli na dziesiątą', hourValues)).toEqual({
      title: 'Wymienić opony',
      due: 'sobota 10:00',
    })
    expect(repairDue('Spotkanie online', '10 piątku', 'zrobić spotkanie online z oddziałem, w piątek o dziesiątej', hourValues).due).toBe('piątek 10:00')
  })

  test('a bare hour gets minutes, a bare day number loses its junk', () => {
    expect(repairDue('Oddać sprawozdanie', 'wtorek 14', 'Sprawozdanie oddaję we wtorek o czternastej', hourValues).due).toBe('wtorek 14:00')
    expect(repairDue('Oddzwonić', 'jutro przed 9', 'Oddzwonię jutro przed dziewiątą', hourValues).due).toBe('jutro przed 9:00')
  })

  test('a day without a clock gains the single clock of the sentence', () => {
    expect(repairDue('Wizyta u psychologa', 'jutro', 'O osiemnastej jutro jadę do psychologa', hourValues).due).toBe('jutro 18:00')
    // opening hours and a booked table are not the due time
    expect(repairDue('Zapisać się na szczepienie', 'poniedziałek', 'dzwonię od ósmej rano, to może w poniedziałek z pracy', hourValues).due).toBe('poniedziałek')
    expect(repairDue('Zarezerwować stolik', 'jutro', 'Muszę zarezerwować stolik na dziewiętnastą, najlepiej jutro', hourValues).due).toBe('jutro')
  })

  test('a spoken date gets its month', () => {
    expect(repairDue('Zawieźć kota', 'czwartego wieczorem', 'trzeba go zawieźć czwartego listopada wieczorem', hourValues).due).toBe('4 listopada wieczorem')
  })

  test('end of the week forms resolve', () => {
    expect(repairDue('Zapisać się na kurs', 'do końca tego tygodnia', 'zapisać się do końca tego tygodnia', hourValues).due).toBe('do końca tygodnia')
    expect(dueResolves(repairDue('Wybrać płytki', 'do końca przyszłego tygodnia', 'do końca przyszłego tygodnia', hourValues).due!)).toBe(true)
  })

  test('a due that is no date moves into the title', () => {
    expect(repairDue('Brać probiotyk', '2 godziny po antybiotyku', 'probiotyk dwie godziny po antybiotyku', hourValues)).toEqual({
      title: 'Brać probiotyk 2 godziny po antybiotyku',
      due: null,
    })
  })

  test('a clear due stays as it is', () => {
    expect(repairDue('Zapłacić rachunek', 'do 20', 'zapłacić rachunek do dwudziestego', hourValues).due).toBe('do 20')
    expect(repairDue('Wysłać ofertę', 'czwartek', 'w czwartek wysyłam ofertę', hourValues).due).toBe('czwartek')
  })
})

describe('repairDue day choice and title tails', () => {
  test('two numbers in a due: the one the sentence states as the day', () => {
    expect(repairDue('Zapłacić ratę za laptop', '22 dwudziestego', 'Rata za laptopa, trzysta złotych, do dwudziestego drugiego, to jest przed wypłatą', hourValues).due).toBe('do 22')
  })

  test('after a spoken correction the later day stands', () => {
    expect(repairDue('Wizyta u hydraulika', '08:00', 'Hydraulik miał przyjść w środę, ale dzwonił, że jednak w czwartek o ósmej rano, więc muszę być w domu', hourValues).due).toBe('czwartek 8:00')
  })

  test('a recurring schedule does not get a day', () => {
    expect(repairDue('Brać antybiotyk', 'rano o 8:00, wieczorem o 20:00', 'Od jutra biorę antybiotyk rano o ósmej i wieczorem o dwudziestej', hourValues).due).toBe('rano o 8:00, wieczorem o 20:00')
  })

  test('a month the sentence never said is dropped, the day number stays', () => {
    expect(repairDue('Zrobić morfologię', '26 października rano', 'najlepiej w poniedziałek dwudziestego szóstego rano', hourValues).due).toBe('poniedziałek 26 rano')
  })

  test('a day part left in the title joins the due', () => {
    expect(repairDue('Zadzwonić do Oli rano', 'jutro', 'jutro rano zadzwonię do Oli', hourValues)).toEqual({ title: 'Zadzwonić do Oli', due: 'jutro rano' })
  })
})

describe('inferDue', () => {
  test('adds the day said next to the task words', () => {
    expect(inferDue('Kupić kwiaty', 'Kwiaty kupić w czwartek po drodze z pracy', hourValues)).toBe('czwartek')
    expect(inferDue('Zadzwonić do mamy', 'Zadzwonię do mamy jutro rano', hourValues)).toBe('jutro rano')
  })

  test('does not borrow a day that belongs to another clause', () => {
    expect(inferDue('Dokończyć ekran nagrywania', 'zostało mi dokończyć ekran nagrywania poprawić eksport notatek i przygotować prezentację na poniedziałek', hourValues)).toBeNull()
  })

  test('does not repeat a day already in the title', () => {
    expect(inferDue('Przesunąć 2 spotkania w czwartek', 'Muszę przesunąć dwa spotkania w czwartek', hourValues)).toBeNull()
  })

  test('two different days are ambiguous', () => {
    expect(inferDue('Kupić kwiaty', 'W piątek lub w sobotę kupić kwiaty', hourValues)).toBeNull()
  })
})

test('an ordinal due that the sentence states as an hour becomes that hour', () => {
  const cited = 'a o dziesiątej mamy zajęcia z projektu kompetencyjnego'
  expect(repairDue('Zajęcia z projektu', 'dziesiąte', cited, hourValues).due).toBe('10:00')
  expect(repairDue('Zajęcia z projektu', 'dziesiątego', cited, hourValues).due).toBe('10:00')
  // "do dziesiątego" in the sentence is a day of the month.
  expect(repairDue('Oddać raport', 'do dziesiątego', 'raport do dziesiątego a o dziesiątej zajęcia', hourValues).due).not.toBe('10:00')
})
