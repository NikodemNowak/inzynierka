import { generate } from './llm'
import {
  adjustCategories,
  fixAcademicDoctor,
  fixCountryPreposition,
  fixInstrumentalCoordination,
  fixNameAfterWith,
  fixObliqueName,
  fixTitleCase,
  generateTitleAndTags,
  isOffPoints,
  isPlanLead,
  stripNumbers,
  titleProblems,
} from './titleTags'

jest.mock('./llm', () => ({ generate: jest.fn() }))
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }))
const model = jest.mocked(generate)
const response = (text: string) => ({
  text, ttftMs: 1, wallMs: 2, promptMs: 1, predictedMs: 1, promptTokens: 20, predictedTokens: 10, tokensPerSecond: 20,
})

describe('title grammar repairs', () => {
  it('moves a nominative conjunct in front of a "z" phrase', () => {
    expect(fixInstrumentalCoordination('Spotkanie z promotorem i prace dyplomowe')).toBe('Prace dyplomowe i spotkanie z promotorem')
    expect(fixInstrumentalCoordination('Dziennik: rozmowa z mamą i zakupy')).toBe('Dziennik: zakupy i rozmowa z mamą')
    expect(fixInstrumentalCoordination('Spotkanie z promotorem i ankietą')).toBe('Spotkanie z promotorem i ankietą')
    expect(fixInstrumentalCoordination('Spotkanie z lekarzem i w aptece')).toBe('Spotkanie z lekarzem i w aptece')
    expect(fixInstrumentalCoordination('Remont łazienki i oferty')).toBe('Remont łazienki i oferty')
  })

  it('uses "w" for a country in the locative', () => {
    expect(fixCountryPreposition('Plan urlopu na Portugalii')).toBe('Plan urlopu w Portugalii')
    expect(fixCountryPreposition('Wakacje na Słowacji')).toBe('Wakacje na Słowacji')
    expect(fixCountryPreposition('Spotkanie na lekcji')).toBe('Spotkanie na lekcji')
  })

  it('puts a name after "z" in the instrumental', () => {
    expect(fixNameAfterWith('Dziennik: pożegnanie z Kuba')).toBe('Dziennik: pożegnanie z Kubą')
    expect(fixNameAfterWith('Rozmowa z Julia')).toBe('Rozmowa z Julią')
    expect(fixNameAfterWith('Szkolenie z pierwszej pomocy')).toBe('Szkolenie z pierwszej pomocy')
  })

  it('restores the nominative of a name that stands alone in the oblique case', () => {
    const content = 'Staś ma pięć lat. Mama bierze Stasia w sobotę.'
    expect(fixObliqueName('Stasia z zapaleniem ucha', content)).toBe('Staś z zapaleniem ucha')
    expect(fixObliqueName('Staś z zapaleniem ucha', content)).toBe('Staś z zapaleniem ucha')
    expect(fixObliqueName('Julia z pracy', 'Julia dzwoniła.')).toBe('Julia z pracy')
  })

  it('names the supervisor when the doctor is the supervisor', () => {
    const content = 'Byłem u promotora, u doktora Zielińskiego, tramwaj się spóźnił.'
    expect(fixAcademicDoctor('Spotkanie u doktora Zielińskiego', content)).toBe('Spotkanie z promotorem')
    expect(fixAcademicDoctor('Wizyta u doktor Nowickiej', content)).toBe('Wizyta u doktor Nowickiej')
    expect(fixAcademicDoctor('Spotkanie u doktora Zielińskiego', 'Byłem u doktora Zielińskiego.')).toBe('Spotkanie u doktora Zielińskiego')
  })

  it('strips figures and their prepositions', () => {
    expect(stripNumbers('Kalkulacja 25% na 12 000 zł', 'pl')).toBe('Kalkulacja')
    expect(stripNumbers('Kalkulacja 25% i podwyżka', 'pl')).toBe('Kalkulacja i podwyżka')
    expect(stripNumbers('Remont łazienki', 'pl')).toBe('Remont łazienki')
  })

  it('writes English titles in sentence case but keeps names', () => {
    const content = 'okay so the electricity bill is due. I will see Chris on Monday, Chris is moving. Plan for the week.'
    expect(fixTitleCase('Electricity Bill and Chris', content, 'en')).toBe('Electricity bill and Chris')
    expect(fixTitleCase('Weekly Plan and Tasks', content, 'en')).toBe('Weekly plan and tasks')
    expect(fixTitleCase('Thesis Advisor Meeting', 'Meeting with my advisor about the thesis.', 'en')).toBe('Thesis advisor meeting')
    expect(fixTitleCase('Meeting with ACME', 'We met ACME today.', 'en')).toBe('Meeting with ACME')
  })
})

describe('title checks', () => {
  it('rejects a title that starts with an adverb or a filler', () => {
    expect(titleProblems('Wcześniej pomysł', ['Kalkulacja wcześniej pomysł na prowizję'], 'pl')).toContain('opener')
    expect(titleProblems('Earlier idea', ['Earlier idea about pricing'], 'en')).toContain('opener')
    expect(titleProblems('First aid training', ['First aid training course'], 'en')).not.toContain('opener')
  })

  it('rejects a title that starts with a word in an oblique case', () => {
    expect(titleProblems('Wizytę u lekarza', ['Wizytę u lekarza zaplanować'], 'pl')).toContain('oblique-head')
    expect(titleProblems('Wizyta u lekarza', ['Wizyta u lekarza'], 'pl')).not.toContain('oblique-head')
  })

  it('flags a title that none of the points mention', () => {
    const points = ['Nie przedłużam karnetu na siłownię', 'Zapisy na kurs fotografii']
    expect(isOffPoints('Spotkanie z sąsiadką i piesem', points, 'pl')).toBe(true)
    expect(isOffPoints('Rezygnacja z karnetu', points, 'pl')).toBe(false)
    expect(isOffPoints('Dziennik: plan', points, 'pl')).toBe(false)
  })

  it('treats "Sprawa ..." as an empty head', () => {
    expect(titleProblems('Sprawa psa u weterynarza', ['Pies u weterynarza'], 'pl')).toContain('vacuous-head')
  })
})

describe('categories', () => {
  it('adds health for a psychologist visit and drops it for a pet at the vet', () => {
    expect(adjustCategories(['Praca'], 'Jutro o osiemnastej jadę do psychologa.')).toEqual(['Praca', 'Zdrowie'])
    expect(adjustCategories(['Praca', 'Dom', 'Finanse'], 'Wizyta u dentysty.')).toEqual(['Praca', 'Dom', 'Zdrowie'])
    expect(adjustCategories(['Zdrowie'], 'The vet said the vaccination is in December.')).toEqual([])
    expect(adjustCategories(['Zdrowie'], 'Doctor said rest. The dog is at the vet.')).toEqual(['Zdrowie'])
    expect(adjustCategories(['Praca'], 'Raport dla zarządu.')).toEqual(['Praca'])
  })

  it('detects an announced weekly plan', () => {
    expect(isPlanLead('Plan na tydzień, długi. Poniedziałek: ...')).toBe(true)
    expect(isPlanLead('Plan for the week, a long one.')).toBe(true)
    expect(isPlanLead('Weekly plan.')).toBe(true)
    expect(isPlanLead('Plan mieszkania do remontu.')).toBe(false)
  })
})

describe('generateTitleAndTags round 16', () => {
  it('titles an announced weekly plan as a plan and files it under planning', async () => {
    model.mockReset()
    model.mockResolvedValueOnce(response('Tytuł: Prezentacja i dentysta\nKategoria: 1\nDodatkowe: 0'))
    const result = await generateTitleAndTags({
      opening: 'Plan na tydzień, długi.',
      points: ['Prezentacja dla zarządu w poniedziałek', 'Wizyta u dentysty'],
      content: 'Plan na tydzień, długi. Prezentacja dla zarządu w poniedziałek. Wizyta u dentysty.',
    }, 'pl')
    expect(result.title).toBe('Plan tygodnia')
    expect(result.categories).toEqual(['Planowanie', 'Praca', 'Zdrowie'])
  })

  it('names the invented word in the repair prompt', async () => {
    model.mockReset()
    model.mockResolvedValueOnce(response('Tytuł: Spotkanie z mgr Trzebą\nKategoria: 1\nDodatkowe: 0'))
    model.mockResolvedValueOnce(response('Tytuł: Plan testów oprogramowania'))
    const content = 'Jutro zajęcia z panem mgr trzeba pokazać plany testów oprogramowania.'
    const result = await generateTitleAndTags({
      opening: content, points: ['Pokazać plany testów oprogramowania'], content,
    }, 'pl')
    expect(model.mock.calls[1][0]).toContain('Nie używaj słowa: „trzebą”')
    expect(result.title).toBe('Plan testów oprogramowania')
  })

  it('keeps a lone topic word in the last-resort title', async () => {
    model.mockReset()
    model.mockResolvedValueOnce(response('Tytuł: Kalkulacja 25% na 12 000 zł\nKategoria: 1\nDodatkowe: 0'))
    model.mockResolvedValueOnce(response('Tytuł: Kalkulacja 12 tys zł'))
    const content = 'Kalkulacja przy stałych 25% daje 3 000 zł.'
    const result = await generateTitleAndTags({ opening: content, points: ['Kalkulacja 25% na 12 000 zł'], content }, 'pl')
    expect(result.titleFallback).toBe(true)
    expect(result.title).toBe('Notatka: kalkulacja')
  })
})
