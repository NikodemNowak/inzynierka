import { parseAnswerBlocks, sourceChipLabel, stripCitationMarks } from './answerPresentation'

describe('stripCitationMarks', () => {
  test('removes a mark before the full stop', () => {
    expect(stripCitationMarks('Jutro 8:30 [1].')).toBe('Jutro 8:30.')
  })
  test('removes adjacent marks', () => {
    expect(stripCitationMarks('Budżet to 180 zł [1][2].')).toBe('Budżet to 180 zł.')
  })
  test('removes two-digit marks', () => {
    expect(stripCitationMarks('Zakupy [12] jutro')).toBe('Zakupy jutro')
  })
  test('removes a mark before a comma', () => {
    expect(stripCitationMarks('Mleko [1], chleb [2], masło')).toBe('Mleko, chleb, masło')
  })
  test('leaves text without marks unchanged', () => {
    const text = 'Spotkanie o 11:00 [w sali 3], weź wydruk.'
    expect(stripCitationMarks(text)).toBe(text)
  })
  test('drops a mark that is still being typed', () => {
    expect(stripCitationMarks('Jutro masz zajęcia [')).toBe('Jutro masz zajęcia')
    expect(stripCitationMarks('Jutro masz zajęcia [1')).toBe('Jutro masz zajęcia')
  })
  test('drops a leading mark', () => {
    expect(stripCitationMarks('[1] Zakupy')).toBe('Zakupy')
  })
})

describe('parseAnswerBlocks', () => {
  test('plain lines are paragraphs', () => {
    expect(parseAnswerBlocks('Jutro masz trzy rzeczy:\nMiłego dnia.')).toEqual([
      { kind: 'paragraph', text: 'Jutro masz trzy rzeczy:' },
      { kind: 'paragraph', text: 'Miłego dnia.' },
    ])
  })
  test('numbered lines become one ordered list', () => {
    expect(parseAnswerBlocks('Intro:\n1. 8:30 zajęcia [1]\n2. 11:00 promotor\n3. 19:00 zakupy')).toEqual([
      { kind: 'paragraph', text: 'Intro:' },
      { kind: 'list', ordered: true, items: ['8:30 zajęcia', '11:00 promotor', '19:00 zakupy'], labels: ['1.', '2.', '3.'] },
    ])
  })
  test('dash and bullet lines become one unordered list', () => {
    expect(parseAnswerBlocks('- mleko\n• chleb\n* masło')).toEqual([
      { kind: 'list', ordered: false, items: ['mleko', 'chleb', 'masło'], labels: ['•', '•', '•'] },
    ])
  })
  test('a paragraph between lists splits them', () => {
    expect(parseAnswerBlocks('- a\nśrodek\n1. b')).toEqual([
      { kind: 'list', ordered: false, items: ['a'], labels: ['•'] },
      { kind: 'paragraph', text: 'środek' },
      { kind: 'list', ordered: true, items: ['b'], labels: ['1.'] },
    ])
  })
  test('citation marks are stripped everywhere and blank lines ignored', () => {
    expect(parseAnswerBlocks('Tak [1].\n\n\n- coś [2]')).toEqual([
      { kind: 'paragraph', text: 'Tak.' },
      { kind: 'list', ordered: false, items: ['coś'], labels: ['•'] },
    ])
  })
  test('an ordinal date stays a paragraph', () => {
    expect(parseAnswerBlocks('27. listopada spotkanie')).toEqual([{ kind: 'paragraph', text: '27. listopada spotkanie' }])
    expect(parseAnswerBlocks('1. Marca spotkanie')).toEqual([{ kind: 'paragraph', text: '1. Marca spotkanie' }])
  })
  test('the model numbers are kept', () => {
    expect(parseAnswerBlocks('3. Kupić mleko')).toEqual([{ kind: 'list', ordered: true, items: ['Kupić mleko'], labels: ['3.'] }])
  })
  test('a hyphen inside a sentence is not a list', () => {
    expect(parseAnswerBlocks('Tak - może')).toEqual([{ kind: 'paragraph', text: 'Tak - może' }])
  })
})

describe('sourceChipLabel', () => {
  const now = new Date(2026, 10, 27, 15)
  const at = (day: number, hour = 9): number => new Date(2026, 10, day, hour).getTime()
  test('today and yesterday', () => {
    expect(sourceChipLabel('Plan na jutro', at(27), now, 'pl')).toBe('Plan na jutro · dziś')
    expect(sourceChipLabel('Plan', at(26), now, 'pl')).toBe('Plan · wczoraj')
    expect(sourceChipLabel('Plan', at(27), now, 'en')).toBe('Plan · today')
    expect(sourceChipLabel('Plan', at(26), now, 'en')).toBe('Plan · yesterday')
  })
  test('older notes get a short date', () => {
    expect(sourceChipLabel('Plan', at(3), now, 'pl')).toMatch(/^Plan · 3 /u)
  })
  test('unknown date gives the title only', () => {
    expect(sourceChipLabel('Plan', undefined, now, 'pl')).toBe('Plan')
  })
})
