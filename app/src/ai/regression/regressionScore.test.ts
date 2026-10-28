import { REGRESSION_CASES } from './regressionCases'
import {
  bullet, bulletNot, compareRuns, entryFound, formatReport, noTask, scoreOutput, stripPunctuation, summary, summaryNot, task,
  type RunFile, type RunOutput,
} from './regressionScore'

const output = (summaryText: string, tasks: string[]): RunOutput => ({ title: 'T', summary: summaryText, tasks, ms: 0 })

const run = (label: string, passes: boolean[], tasks: string[] = []): RunFile => ({
  label, createdAt: '', commit: label, model: 'm', seed: 42,
  results: [{
    key: 'case/raw', caseId: 'case', variant: 'raw', output: output('• a', tasks),
    checks: passes.map((pass, index) => ({ label: `check ${index}`, pass })),
  }],
})

describe('entryFound', () => {
  it('ignores case and diacritics and anchors at a word start', () => {
    expect(entryFound('zadzwon', 'Zadzwonić do mamy')).toBe(true)
    expect(entryFound('ksiazk', 'Oddać książkę')).toBe(true)
    expect(entryFound('ola', 'Zapytać kolegę')).toBe(false)
  })

  it('treats a trailing number as whole', () => {
    expect(entryFound('30', 'do 300 osób')).toBe(false)
    expect(entryFound('30', 'do 30 osób')).toBe(true)
    expect(entryFound('8:00', 'o 18:00')).toBe(false)
    expect(entryFound('8:30', 'jutro o 08:30')).toBe(true)
    expect(entryFound('19500', '19 500 zł')).toBe(true)
  })

  it('accepts any alternative', () => {
    expect(entryFound('10:00|o dziesiatej', 'zajęcia o dziesiątej')).toBe(true)
  })
})

describe('stripPunctuation', () => {
  it('drops punctuation but keeps times and decimals', () => {
    expect(stripPunctuation('Jutro, o 8:30, testy. Gorączka 38,5 — paracetamol!')).toBe('Jutro o 8:30 testy Gorączka 38,5 paracetamol')
  })
})

describe('scoreOutput', () => {
  const result = output('• Jutro o 8:30 pokazać testy\n• O 10:00 zajęcia z projektu', ['Pokazać testy — jutro 8:30', 'Zajęcia z projektu — 10:00'])

  it('checks summary, single bullets and tasks', () => {
    const checks = [
      summary('8:30', '10:00'),
      summaryNot('9:00'),
      bullet('test', '8:30'),
      bulletNot('test', '10:00'),
      task('test', '8:30'),
      noTask('test', '10:00'),
      bullet('test', '10:00'),
    ]
    expect(scoreOutput(checks, result).map((check) => check.pass)).toEqual([true, true, true, true, true, true, false])
  })

  it('fails every check without output', () => {
    expect(scoreOutput([summaryNot('x')], null)).toEqual([{ label: 'summary without: x', pass: false }])
  })
})

describe('compareRuns', () => {
  it('splits flipped checks into improved and regressed', () => {
    const comparison = compareRuns(run('a', [true, false, true]), run('b', [false, true, true], ['new task']))
    expect(comparison.regressed).toEqual([{ key: 'case/raw', label: 'check 0' }])
    expect(comparison.improved).toEqual([{ key: 'case/raw', label: 'check 1' }])
    expect(comparison.changedOutputs).toEqual(['case/raw'])
    expect(comparison.base).toEqual({ passed: 2, total: 3 })
  })

  it('reports regressions with both outputs', () => {
    const report = formatReport(run('a', [true]), run('b', [false], ['Zrobić coś']))
    expect(report).toContain('## Regressed (1)')
    expect(report).toContain('[ ] Zrobić coś')
  })
})

describe('REGRESSION_CASES', () => {
  it('has unique ids and labels', () => {
    const ids = REGRESSION_CASES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of REGRESSION_CASES) {
      const labels = scoreOutput(item.checks, null).map((check) => check.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('names suite notes that exist', () => {
    const notes = (require('../../benchmark/suiteData.json') as { notes: { id: string }[] }).notes.map((note) => note.id)
    for (const item of REGRESSION_CASES) {
      if ('suite' in item.source) expect(notes).toContain(item.source.suite)
    }
  })
})
