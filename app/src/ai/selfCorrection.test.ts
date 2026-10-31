import { resolveSelfCorrections } from './selfCorrection'

const pl = (text: string): string => resolveSelfCorrections(text, 'pl')

describe('resolveSelfCorrections', () => {
  test.each([
    ['zapisać się do dermatologa, znaczy nie, do okulisty, bo dermatolog to było w zeszłym roku',
      'zapisać się do okulisty, bo dermatolog to było w zeszłym roku'],
    ['pierwsze kolokwium jest dwunastego listopada, nie, czekaj, trzynastego, w piątek',
      'pierwsze kolokwium jest trzynastego listopada, w piątek'],
    ['Domek kosztuje dwa tysiące sto za dwie noce, nie, sorry, dwa tysiące czterysta, bo doliczają sprzątanie',
      'Domek kosztuje dwa tysiące czterysta, bo doliczają sprzątanie'],
    ['wyślę mu drugi rozdział w poniedziałek, nie, czekaj, w przyszły wtorek',
      'wyślę mu drugi rozdział w przyszły wtorek'],
    ['spotkanie o szesnastej nie czekaj o siedemnastej w biurze', 'spotkanie o siedemnastej w biurze'],
    ['spotkanie o szesnastej nie czekaj siedemnastej', 'spotkanie o siedemnastej'],
    ['do dwudziestu osób, nie, czekaj, do trzydziestu', 'do trzydziestu osób'],
    ['ankietę wysłać do dwudziestu osób nie czekaj do trzydziestu i jeszcze', 'ankietę wysłać do trzydziestu osób i jeszcze'],
    ['w poniedziałek nie czekaj we wtorek oddam', 'we wtorek oddam'],
    ['Dwunastego, nie, czekaj, trzynastego jest kolokwium', 'Trzynastego jest kolokwium'],
    ['kupić cztery piwa nie sorry sześć piw', 'kupić sześć piw'],
    ['Jeszcze piwo na sobotę, cztery, nie, sześć, bo Kuba przychodzi', 'Jeszcze piwo na sobotę, sześć, bo Kuba przychodzi'],
    ['spotkanie o szesnastej nie o siedemnastej', 'spotkanie o siedemnastej'],
  ])('%s', (input, expected) => {
    expect(pl(input)).toBe(expected)
  })

  test.each([
    // Nothing before the cue matches what follows it.
    'Nie, czekaj, samochód jest u mechanika, to pojadę pociągiem',
    'to znaczy nie wiem, czy przyjdę',
    'nie, sorry, nie mogę jutro',
    // The cue is in a new sentence; the earlier sentence is not touched.
    'Jutro o ósmej. Nie, czekaj, o ósmej mam zajęcia',
    'muszę oddać książkę nie sorry',
    // A bare "nie" without numbers on both sides is ordinary negation.
    'o ósmej nie da rady',
    'w czwartek nie w piątek',
    'mam trzy nie mam czterech',
    // The words after the cue restate the old value and explain it.
    'menu w Zajeździe sto czterdzieści złotych, nie, czekaj, sto czterdzieści to było bez napojów',
    'zrobię w poniedziałek po południu albo nie czekaj w poniedziałek po południu jest planowanie',
    'o szóstej czterdzieści z Modlina nie czekaj z Modlina był ten pierwszy',
    'do dynamiki bryły sztywnej włącznie znaczy nie włącznie czekaj do dynamiki bez bryły',
  ])('leaves "%s" as spoken', (input) => {
    expect(pl(input)).toBe(input)
  })

  test('English text is not changed', () => {
    expect(resolveSelfCorrections('at four, nie czekaj, at five', 'en')).toBe('at four, nie czekaj, at five')
  })

  test('two corrections in one note', () => {
    expect(pl('domek za dwa tysiące sto nie sorry dwa tysiące czterysta a wyjazd o piętnastej nie czekaj o czternastej'))
      .toBe('domek za dwa tysiące czterysta a wyjazd o czternastej')
  })
})
