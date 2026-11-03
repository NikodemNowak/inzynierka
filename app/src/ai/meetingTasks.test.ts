import { generate } from './llm'
import { extractMeetingTasks, isRecordedConversation, meetingParts, mergeMeetingTasks, parseMeetingLines } from './meetingTasks'

jest.mock('./llm', () => ({ generate: jest.fn() }))
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }))

const reply = (text: string) => ({ text, completion: { interrupted: false } }) as Awaited<ReturnType<typeof generate>>
const filler = (count: number): string => Array.from({ length: count }, (_, index) => `słowo${index}`).join(' ')
const units = (texts: readonly string[]) => texts.map((text, id) => ({ id, text }))

describe('isRecordedConversation', () => {
  test('a long recording where people address each other is a conversation', () => {
    const turn = 'Paweł zaczynasz czy czekamy na Martę. Możesz sprawdzić logi. Dawaj, Tomek, zrobisz to do czwartku.'
    expect(isRecordedConversation(units(Array.from({ length: 60 }, () => `${turn} ${filler(4)}`)))).toBe(true)
  })

  test('a long spoken note with only "wiesz" fillers is not', () => {
    const sentence = 'Muszę jutro kupić chleb, wiesz, i zadzwonić do mamy w sprawie urodzin.'
    expect(isRecordedConversation(units(Array.from({ length: 80 }, () => sentence)))).toBe(false)
  })

  test('a short conversation stays with the note pipeline', () => {
    expect(isRecordedConversation(units(['Tomek, zrobisz to? Możesz do czwartku?']))).toBe(false)
  })
})

describe('meetingParts', () => {
  test('parts overlap and cover every unit', () => {
    const parts = meetingParts(units(Array.from({ length: 30 }, () => filler(50))))
    expect(parts.length).toBeGreaterThan(2)
    expect(parts[1]![0]!.id).toBeLessThan(parts[0]!.at(-1)!.id + 1)
    expect(parts.at(-1)!.at(-1)!.id).toBe(29)
  })
})

describe('parseMeetingLines', () => {
  test('reads tasks, drops names and empty deadlines', () => {
    expect(parseMeetingLines('- Tomek: odnowić certyfikat APNs — czwartek\n- przygotować makiety — brak\n-'))
      .toEqual([{ title: 'odnowić certyfikat APNs', due: 'czwartek' }, { title: 'przygotować makiety', due: null }])
  })
})

describe('mergeMeetingTasks', () => {
  test('a later mention of the same task wins and keeps its first place', () => {
    expect(mergeMeetingTasks([
      { title: 'Odnowić certyfikat', due: 'środa', sourceIds: [1] },
      { title: 'Przygotować makiety', due: 'czwartek', sourceIds: [2] },
      { title: 'odnowić certyfikat APNs', due: 'czwartek', sourceIds: [9] },
    ])).toEqual([
      { title: 'odnowić certyfikat APNs', due: 'czwartek', sourceIds: [9] },
      { title: 'Przygotować makiety', due: 'czwartek', sourceIds: [2] },
    ])
  })
})

describe('extractMeetingTasks', () => {
  test('one call per part, merged and linked to the matching sentence', async () => {
    jest.mocked(generate)
      .mockResolvedValueOnce(reply('- naprawić crash logowania — piątek'))
      .mockResolvedValueOnce(reply('-'))
    const meeting = units([`${filler(300)} Nikodem naprawisz crash logowania do piątku`, filler(300), filler(300)])
    await expect(extractMeetingTasks(meeting)).resolves.toEqual([{ title: 'naprawić crash logowania', due: 'piątek', sourceIds: [0] }])
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

describe('mergeMeetingTasks keys', () => {
  test('the same invitation in other words is one task, its fuller wording stays', () => {
    expect(mergeMeetingTasks([
      { title: 'Wysłać zaproszenie do Złotego Kłosu', due: null, sourceIds: [1] },
      { title: 'Wyślanie zaproszenia', due: 'dzisiaj', sourceIds: [5] },
      { title: 'Przygotować makiety ekranów', due: 'czwartek', sourceIds: [3] },
    ])).toEqual([
      { title: 'Wysłać zaproszenie do Złotego Kłosu', due: 'dzisiaj', sourceIds: [1] },
      { title: 'Przygotować makiety ekranów', due: 'czwartek', sourceIds: [3] },
    ])
  })
})
