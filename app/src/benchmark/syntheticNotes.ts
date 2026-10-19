import type { AskNote, AskTask } from '../ask/askIndex'

// Deterministic filler notes (10 a day, mostly Polish) for timing word search
// at the size of a year or more of use. Topics repeat on purpose, like real notes.

const NAMES = ['Ania', 'Kasia', 'Marta', 'Ola', 'Magda', 'Tomek', 'Piotrek', 'Kuba', 'Marek', 'Wojtek']
const DAYS = ['w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę', 'jutro', 'dzisiaj']
const HOURS = ['o ósmej', 'o dziesiątej', 'o dwunastej', 'o czternastej', 'o szesnastej', 'o osiemnastej']
const SHOP = ['mleko', 'chleb', 'jajka', 'masło', 'ser', 'pomidory', 'jabłka', 'kawę', 'makaron', 'ryż']
const DOCTORS = ['dentysty', 'okulisty', 'dermatologa', 'internisty', 'ortopedy']
const FILLER = ['Pogoda była beznadziejna, cały dzień padało.', 'W tramwaju był straszny tłok.', 'Wieczorem obejrzałem odcinek serialu.', 'Ogólnie dzień był w porządku.']
const EN = ['I have a dentist appointment on Friday at 9.', 'I need to buy milk, eggs and coffee.', 'Meeting with Emma on Monday about the project.', 'The car service is on Tuesday.']

export const syntheticNotes = (count: number, end = new Date(2026, 8, 30, 21).getTime()): { notes: AskNote[]; tasks: AskTask[] } => {
  let seed = 7
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % n
  }
  const pick = <T,>(items: readonly T[]): T => items[next(items.length)]!
  const notes: AskNote[] = []
  const tasks: AskTask[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `syn-${i}`
    const createdAt = end - Math.floor(i / 10) * 86400000 - next(12) * 3600000
    if (next(5) === 0) {
      notes.push({ id, title: 'Note', content: [pick(EN), pick(EN), pick(EN)].join(' '), summary: null, createdAt, language: 'en' })
      continue
    }
    const sentences: string[] = []
    for (let k = 0; k < 3 + next(6); k += 1) {
      const topic = next(7)
      if (topic === 0) sentences.push(`${pick(DAYS)} ${pick(HOURS)} mam wizytę u ${pick(DOCTORS)}.`)
      else if (topic === 1) sentences.push(`Muszę kupić ${pick(SHOP)}, ${pick(SHOP)} i ${pick(SHOP)}.`)
      else if (topic === 2) sentences.push(`${pick(NAMES)} prosiła, żebym oddzwonił ${pick(DAYS)} w sprawie wyjazdu.`)
      else if (topic === 3) sentences.push(`Rachunek za prąd wynosi ${100 + next(300)} złotych, zapłacić do ${10 + next(18)}.`)
      else if (topic === 4) sentences.push(`Przegląd samochodu ${pick(DAYS)} ${pick(HOURS)}.`)
      else if (topic === 5) sentences.push(`Spotkanie z promotorem ${pick(DAYS)} ${pick(HOURS)}.`)
      else sentences.push(pick(FILLER))
    }
    notes.push({ id, title: sentences[0]!.slice(0, 40), content: sentences.join(' '), summary: null, createdAt, language: 'pl' })
    if (next(2) === 0) tasks.push({ noteId: id, text: `Kupić ${pick(SHOP)}`, done: false })
  }
  return { notes, tasks }
}
