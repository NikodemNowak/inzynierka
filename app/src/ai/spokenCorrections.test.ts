import { generate } from './llm'
import { applySpokenCorrections, correctedText, findSpokenCorrections } from './spokenCorrections'

jest.mock('./llm', () => ({ generate: jest.fn() }))
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }))

const reply = (text: string) => ({
  text, ttftMs: 0, tokensPerSecond: 0, wallMs: 0,
  completion: { status: 'complete', truncated: false, stoppedLimit: false, contextFull: false, interrupted: false, stoppedEos: true, stoppingWord: '' },
})

describe('applySpokenCorrections', () => {
  test('a value corrected right away drops the old value and the cue', () => {
    expect(correctedText('piwo na sobotę, cztery, nie, sześć, bo Kuba przychodzi', [{ old: 'cztery', new: 'sześć' }]))
      .toBe('piwo na sobotę, sześć, bo Kuba przychodzi')
    expect(correctedText('zapisać się do dermatologa znaczy nie do okulisty', [{ old: 'dermatologa', new: 'okulisty' }]))
      .toBe('zapisać się do okulisty')
  })

  test('a value changed later is replaced where it was first stated', () => {
    expect(correctedText('release w czwartek tak jak w planie ale crash blokuje więc jednak przesuwamy na wtorek', [{ old: 'czwartek', new: 'wtorek' }]))
      .toBe('release w wtorek tak jak w planie ale crash blokuje więc jednak przesuwamy na wtorek')
  })

  test('the model quoting the whole correction as the old value still works', () => {
    expect(correctedText('do dermatologa znaczy nie do okulisty', [{ old: 'do dermatologa znaczy nie do okulisty', new: 'do okulisty' }]))
      .toBe('do okulisty')
  })

  test.each([
    ['new value not in the text', { old: 'cztery', new: 'siedem' }],
    ['old value only after the new one', { old: 'sześć', new: 'cztery' }],
    ['same value', { old: 'cztery', new: 'cztery' }],
    ['new value contains the old one', { old: 'piętnaście', new: 'dziesiątej piętnaście' }],
    ['empty new value', { old: 'cztery', new: ' , ' }],
    ['empty old value', { old: '', new: 'sześć' }],
  ])('ignores a pair with %s', (_label, correction) => {
    const text = 'piwo cztery nie sześć o dziesiątej piętnaście'
    expect(correctedText(text, [correction])).toBe(text)
  })

  test('a day is not replaced by an hour', () => {
    const text = 'wymiana na sobotę miało być na dziewiątą ale przesunęli na dziesiątą'
    expect(correctedText(text, [{ old: 'na sobotę', new: 'na dziesiątą' }])).toBe(text)
  })

  test('a value the speaker settles in place is left as spoken', () => {
    const text = 'menu sto czterdzieści złotych, nie, czekaj, sto czterdzieści to było bez napojów, z napojami sto sześćdziesiąt pięć'
    expect(correctedText(text, [{ old: 'sto czterdzieści', new: 'sto sześćdziesiąt pięć' }])).toBe(text)
  })

  test('only whole words match', () => {
    expect(correctedText('pięćdziesiąt a potem pięć', [{ old: 'pięć', new: 'sześć' }])).toBe('pięćdziesiąt a potem pięć')
  })

  test('each piece keeps its place when a correction spans two of them', () => {
    expect(applySpokenCorrections(['kolokwium dwunastego listopada', 'nie czekaj trzynastego listopada w piątek'], [{ old: 'dwunastego listopada', new: 'trzynastego listopada' }]))
      .toEqual(['kolokwium ', 'trzynastego listopada w piątek'])
  })
})

describe('findSpokenCorrections', () => {
  beforeEach(() => jest.mocked(generate).mockReset())

  test('keeps a listed change the model confirms on its passage', async () => {
    jest.mocked(generate)
      .mockResolvedValueOnce(reply('{"zmiany":[{"stare":"cztery","nowe":"sześć"},{"stare":"w sobotę","nowe":"w niedzielę"}]}') as never)
      .mockResolvedValueOnce(reply('{"odpowiedz":"tak"}') as never)
      .mockResolvedValueOnce(reply('{"odpowiedz":"nie"}') as never)
    await expect(findSpokenCorrections(['piwo cztery nie sześć w sobotę a obiad w niedzielę'], 'pl')).resolves.toEqual([{ old: 'cztery', new: 'sześć' }])
    expect(jest.mocked(generate).mock.calls[1][0]).toContain('najpierw podał "cztery"')
  })

  test('a listed pair that is not in the text is dropped without asking', async () => {
    jest.mocked(generate).mockResolvedValueOnce(reply('{"zmiany":[{"stare":"pięć","nowe":"sześć"}]}') as never)
    await expect(findSpokenCorrections(['piwo cztery nie sześć na wieczór'], 'pl')).resolves.toEqual([])
    expect(generate).toHaveBeenCalledTimes(1)
  })

  test('the summary and the task list share one model call', async () => {
    jest.mocked(generate).mockResolvedValue(reply('{"zmiany":[]}') as never)
    await findSpokenCorrections(['jutro o ósmej zajęcia'], 'pl')
    await findSpokenCorrections(['jutro o ósmej zajęcia'], 'pl')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  test('malformed output means no corrections', async () => {
    jest.mocked(generate).mockResolvedValue(reply('nie wiem') as never)
    await expect(findSpokenCorrections(['coś innego zupełnie'], 'pl')).resolves.toEqual([])
  })

  test('English notes are not sent', async () => {
    await expect(findSpokenCorrections(['four no wait five'], 'en')).resolves.toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('applySpokenCorrections with earlier mentions', () => {
  test('a mention of the old value shortly before the correction changes too', () => {
    expect(correctedText('zapłaciłem 300 zł za druk plakatu. Poprawka, nie 300, tylko 350 zł', [{ old: '300', new: '350' }]))
      .toBe('zapłaciłem 350 zł za druk plakatu. Poprawka, nie 350 zł')
  })
})

describe('applySpokenCorrections for a change far from the old value', () => {
  const filler = Array.from({ length: 60 }, (_, index) => `słowo${index}`).join(' ')

  test('the statement that set the value takes the new one, the explanation stays', () => {
    const text = `budżet 4000 złotych na dwoje ${filler} wcześniej mówiłam cztery tysiące ale po policzeniu lotów realnie to będzie 5200`
    expect(correctedText(text, [{ old: 'cztery tysiące', new: '5200', context: 'realnie to będzie 5200' }]))
      .toBe(`budżet 5200 złotych na dwoje ${filler} wcześniej mówiłam cztery tysiące ale po policzeniu lotów realnie to będzie 5200`)
  })

  test('the quoted change sentence picks which mention of the new value is meant', () => {
    const text = `prezentacja w czwartek o jedenastej ${filler} w piątek kwiaty dla Ewy ${filler} więc przełożyli na piątek ta sama godzina`
    const [corrected] = applySpokenCorrections([text], [{ old: 'w czwartek', new: 'na piątek', context: 'przełożyli na piątek ta sama godzina' }])
    expect(corrected.startsWith('prezentacja na piątek o jedenastej')).toBe(true)
  })
})
