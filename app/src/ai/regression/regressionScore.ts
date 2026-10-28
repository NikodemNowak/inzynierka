// Scoring for the LLM regression suite: saved notes with the facts the output must
// (or must not) contain, and a comparison of two runs.

// 'raw' feeds the text as written, 'stripped' as iOS dictation delivers it: no punctuation.
export type Variant = 'raw' | 'stripped'

// Every entry must be found; 'a|b' inside an entry means either alternative.
// Matching is case- and diacritic-insensitive and anchored at the start of a word,
// so 'zadzwon' also finds 'Zadzwonić'. An entry ending in a digit must end the number:
// '8:00' does not match '8:005', and '30' does not match '300'.
export type Check =
  | { kind: 'summary'; all: string[] }
  | { kind: 'summaryNot'; any: string[] }
  | { kind: 'bullet'; all: string[] }
  | { kind: 'bulletNot'; all: string[] }
  | { kind: 'task'; all: string[] }
  | { kind: 'noTask'; all: string[] }
  | { kind: 'maxTasks'; count: number }

export type RegressionCase = {
  id: string
  // What went wrong before, or what the note exercises.
  why: string
  source: { suite: string } | { text: string }
  variants: Variant[]
  checks: Check[]
}

export type RunOutput = { title: string; summary: string; tasks: string[]; ms: number }

export type CheckResult = { label: string; pass: boolean }

export type CaseResult = {
  key: string
  caseId: string
  variant: Variant
  output: RunOutput | null
  error?: string
  checks: CheckResult[]
}

export type RunFile = {
  label: string
  createdAt: string
  commit: string
  model: string
  seed: number
  results: CaseResult[]
}

export const summary = (...all: string[]): Check => ({ kind: 'summary', all })
export const summaryNot = (...any: string[]): Check => ({ kind: 'summaryNot', any })
export const bullet = (...all: string[]): Check => ({ kind: 'bullet', all })
export const bulletNot = (...all: string[]): Check => ({ kind: 'bulletNot', all })
export const task = (...all: string[]): Check => ({ kind: 'task', all })
export const noTask = (...all: string[]): Check => ({ kind: 'noTask', all })
export const maxTasks = (count: number): Check => ({ kind: 'maxTasks', count })

export const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gu, 'l')
    .replace(/(?<!\d)0(\d):(\d\d)/gu, '$1:$2')
    .replace(/(\d)[  ](?=\d{3}(?!\d))/gu, '$1')
    .replace(/\s+/gu, ' ')

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const WORD_CHAR = /[\p{L}\d]/u

const altPattern = (alt: string): RegExp => {
  const folded = fold(alt.trim())
  const start = WORD_CHAR.test(folded[0] ?? '') ? '(?<![\\p{L}\\d])' : ''
  const end = /\d$/u.test(folded) ? '(?!\\d)' : ''
  return new RegExp(`${start}${escape(folded)}${end}`, 'u')
}

export const entryFound = (entry: string, text: string): boolean => {
  const folded = fold(text)
  return entry.split('|').some((alt) => alt.trim() !== '' && altPattern(alt).test(folded))
}

const allFound = (entries: string[], text: string): boolean => entries.every((entry) => entryFound(entry, text))

export const stripPunctuation = (text: string): string =>
  text
    .replace(/\s[—–-]\s/gu, ' ')
    .replace(/[!?…„”"()]/gu, ' ')
    .replace(/[.,:;](?!\d)|(?<!\d)[.,:;]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

export const checkLabel = (check: Check): string => {
  switch (check.kind) {
    case 'summary': return `summary: ${check.all.join(' + ')}`
    case 'summaryNot': return `summary without: ${check.any.join(' | ')}`
    case 'bullet': return `one bullet: ${check.all.join(' + ')}`
    case 'bulletNot': return `no bullet: ${check.all.join(' + ')}`
    case 'task': return `task: ${check.all.join(' + ')}`
    case 'noTask': return `no task: ${check.all.join(' + ')}`
    case 'maxTasks': return `at most ${check.count} tasks`
  }
}

const bulletsOf = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter(Boolean)

export const runCheck = (check: Check, output: RunOutput): boolean => {
  switch (check.kind) {
    case 'summary': return allFound(check.all, output.summary)
    case 'summaryNot': return !check.any.some((entry) => entryFound(entry, output.summary))
    case 'bullet': return bulletsOf(output.summary).some((line) => allFound(check.all, line))
    case 'bulletNot': return !bulletsOf(output.summary).some((line) => allFound(check.all, line))
    case 'task': return output.tasks.some((line) => allFound(check.all, line))
    case 'noTask': return !output.tasks.some((line) => allFound(check.all, line))
    case 'maxTasks': return output.tasks.length <= check.count
  }
}

export const scoreOutput = (checks: Check[], output: RunOutput | null): CheckResult[] =>
  checks.map((check) => ({ label: checkLabel(check), pass: output !== null && runCheck(check, output) }))

export type CheckChange = { key: string; label: string }

export type RunComparison = {
  base: { passed: number; total: number }
  head: { passed: number; total: number }
  improved: CheckChange[]
  regressed: CheckChange[]
  // Same checks, different words: worth a look, not a verdict.
  changedOutputs: string[]
  onlyInHead: string[]
}

const tally = (run: RunFile): { passed: number; total: number } => {
  const checks = run.results.flatMap((result) => result.checks)
  return { passed: checks.filter((check) => check.pass).length, total: checks.length }
}

const outputText = (output: RunOutput | null): string =>
  output ? [output.title, output.summary, ...output.tasks].join('\n') : ''

export const compareRuns = (base: RunFile, head: RunFile): RunComparison => {
  const before = new Map(base.results.map((result) => [result.key, result]))
  const improved: CheckChange[] = []
  const regressed: CheckChange[] = []
  const changedOutputs: string[] = []
  const onlyInHead: string[] = []
  for (const result of head.results) {
    const old = before.get(result.key)
    if (!old) {
      onlyInHead.push(result.key)
      continue
    }
    const oldChecks = new Map(old.checks.map((check) => [check.label, check.pass]))
    for (const check of result.checks) {
      const was = oldChecks.get(check.label)
      if (was === undefined) continue
      if (!was && check.pass) improved.push({ key: result.key, label: check.label })
      if (was && !check.pass) regressed.push({ key: result.key, label: check.label })
    }
    if (outputText(old.output) !== outputText(result.output)) changedOutputs.push(result.key)
  }
  return { base: tally(base), head: tally(head), improved, regressed, changedOutputs, onlyInHead }
}

const percent = ({ passed, total }: { passed: number; total: number }): string =>
  `${passed}/${total} (${total === 0 ? 0 : Math.round((passed / total) * 100)}%)`

const outputBlock = (result: CaseResult | undefined): string[] => {
  if (!result?.output) return [`    (no output${result?.error ? `: ${result.error}` : ''})`]
  return [
    ...bulletsOf(result.output.summary).map((line) => `    ${line}`),
    ...result.output.tasks.map((line) => `    [ ] ${line}`),
  ]
}

const changeLines = (changes: CheckChange[], base: RunFile, head: RunFile, withOutputs: boolean): string[] => {
  const byKey = new Map<string, string[]>()
  for (const change of changes) byKey.set(change.key, [...(byKey.get(change.key) ?? []), change.label])
  const before = new Map(base.results.map((result) => [result.key, result]))
  const after = new Map(head.results.map((result) => [result.key, result]))
  return [...byKey].flatMap(([key, labels]) => [
    `- ${key}`,
    ...labels.map((label) => `  - ${label}`),
    ...(withOutputs ? ['  before:', ...outputBlock(before.get(key)), '  after:', ...outputBlock(after.get(key))] : []),
  ])
}

export const formatReport = (base: RunFile | null, head: RunFile): string => {
  const failing = head.results.flatMap((result) =>
    result.checks.filter((check) => !check.pass).map((check) => `- ${result.key}: ${check.label}`))
  const lines = [
    `# LLM regression: ${head.label}`,
    '',
    `Commit ${head.commit}, model ${head.model}, seed ${head.seed}.`,
    `Passed ${percent(tally(head))}.`,
  ]
  if (base) {
    const comparison = compareRuns(base, head)
    lines.push(
      `Base ${base.label} (${base.commit}): ${percent(comparison.base)}.`,
      '',
      `## Regressed (${comparison.regressed.length})`,
      ...changeLines(comparison.regressed, base, head, true),
      '',
      `## Improved (${comparison.improved.length})`,
      ...changeLines(comparison.improved, base, head, false),
      '',
      `## Output changed, checks unchanged (${comparison.changedOutputs.length})`,
      ...comparison.changedOutputs.map((key) => `- ${key}`),
    )
    if (comparison.onlyInHead.length > 0) lines.push('', '## New cases', ...comparison.onlyInHead.map((key) => `- ${key}`))
  }
  lines.push('', `## Failing now (${failing.length})`, ...failing)
  return `${lines.join('\n')}\n`
}
