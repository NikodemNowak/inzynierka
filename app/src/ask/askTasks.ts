import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { localeForLanguage, type Language } from '../i18n/language'
import { resolveTaskDay, splitTaskText, type TaskDay } from '../tasks/taskDue'
import { groupTasksByDue, type TaskGroup } from '../tasks/taskGroups'
import type { AskAnswer, AskItem, AskSource } from './askAnswer'
import { GENERIC_DAY_WORDS, HAVE_QUESTION, TASK_WORDS, isTaskQuestion, questionDays, type DayRange } from './askRetrieval'
import { plain, terms } from './askText'

// "Co mam dzisiaj?" is not a search: the tasks that are due are known, so the
// answer is computed here from them, with no model call and no guessing.

export type TaskScopeKind = 'today' | 'tomorrow' | 'dayAfter' | 'day' | 'week' | 'nextWeek' | 'weekend' | 'overdue' | 'all' | 'range'

export interface TaskScope {
  // null: every open task, grouped by when it is due.
  range: DayRange | null
  kind: TaskScopeKind
}

const DAY = 86400000
const OVERDUE_CAP = 5
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const GENERIC = new Set(terms(`${GENERIC_DAY_WORDS} wszystkie otwarte open all`))
// Words of the question that are neither a day nor a task cue: a topic ("urodziny taty").
const topicTerms = (question: string): string[] => terms(question).filter((term) => !GENERIC.has(term) && !/^\d/u.test(term))

export const rangeKind = (range: DayRange, now: Date, question = ''): TaskScopeKind => {
  const today = startOfDay(now)
  if (range.from === Number.NEGATIVE_INFINITY) return 'overdue'
  if (/\bweekend\w*\b/u.test(plain(question))) return 'weekend'
  if (range.from === range.to) {
    const shift = Math.round((range.from - today) / DAY)
    return shift === 0 ? 'today' : shift === 1 ? 'tomorrow' : shift === 2 ? 'dayAfter' : 'day'
  }
  const weekEnd = today + ((7 - now.getDay()) % 7) * DAY
  if (range.from === today && range.to === weekEnd) return 'week'
  if (range.from === weekEnd + DAY && range.to === weekEnd + 7 * DAY) return 'nextWeek'
  return 'range'
}

const directScope = (question: string, now: Date): TaskScope | null => {
  if (!isTaskQuestion(question, now) || topicTerms(question).length) return null
  const range = questionDays(question, now)
  if (!range) return TASK_WORDS.test(plain(question)) ? { range: null, kind: 'all' } : null
  // A day in the past is a memory question, not a list of what is due.
  if (range.to < startOfDay(now) && range.from !== Number.NEGATIVE_INFINITY) return null
  return { range, kind: rangeKind(range, now, question) }
}

// A short follow-up ("A jutro?") keeps asking about tasks after a task question.
export const taskScope = (question: string, now: Date, previous?: string): TaskScope | null => {
  const direct = directScope(question, now)
  if (direct || !previous) return direct
  const text = plain(question)
  if (TASK_WORDS.test(text) || HAVE_QUESTION.test(text) || topicTerms(question).length || question.trim().split(/\s+/u).length > 5) return null
  if (!directScope(previous, now)) return null
  const range = questionDays(question, now)
  if (!range || (range.to < startOfDay(now) && range.from !== Number.NEGATIVE_INFINITY)) return null
  return { range, kind: rangeKind(range, now, question) }
}

const WEEKDAYS = { pl: ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } as const
const MONTHS = {
  pl: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
} as const

const clock = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

// "16:30" inside a single day; "jutro · 16:30" or "czw. 15 paź" across days.
const dueLabel = (due: TaskDay, now: Date, language: Language, mode: 'time' | 'full'): string | undefined => {
  const time = due.allDay ? '' : clock(due.date)
  if (mode === 'time') return time || undefined
  const shift = Math.round((due.day - startOfDay(now)) / DAY)
  const day = shift === 0 ? (language === 'pl' ? 'dziś' : 'today')
    : shift === 1 ? (language === 'pl' ? 'jutro' : 'tomorrow')
      : `${WEEKDAYS[language][due.date.getDay()]} ${due.date.getDate()} ${MONTHS[language][due.date.getMonth()]}`
  return time ? `${day} · ${time}` : day
}

const plural = (count: number, one: string, few: string, many: string): string =>
  count === 1 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many

const tasksWord = (count: number, language: Language): string =>
  language === 'pl' ? plural(count, 'zadanie', 'zadania', 'zadań') : count === 1 ? 'task' : 'tasks'
const overdueWord = (count: number, language: Language): string =>
  language === 'pl' ? plural(count, 'zaległe zadanie', 'zaległe zadania', 'zaległych zadań') : count === 1 ? 'overdue task' : 'overdue tasks'

const scopeLabel = (scope: TaskScope, language: Language): string => {
  const pl = language === 'pl'
  switch (scope.kind) {
    case 'today': return pl ? 'dziś' : 'today'
    case 'tomorrow': return pl ? 'jutro' : 'tomorrow'
    case 'dayAfter': return pl ? 'pojutrze' : 'the day after tomorrow'
    case 'week': return pl ? 'ten tydzień' : 'this week'
    case 'nextWeek': return pl ? 'przyszły tydzień' : 'next week'
    case 'weekend': return pl ? 'weekend' : 'the weekend'
    case 'day': {
      const from = scope.range?.from ?? 0
      return new Date(from).toLocaleDateString(localeForLanguage(language), { day: 'numeric', month: 'long' })
    }
    default: return pl ? 'ten okres' : 'this period'
  }
}

const GROUP_LABEL: Readonly<Record<Language, Record<TaskGroup, string>>> = {
  pl: { overdue: 'Zaległe', today: 'Dziś', week: 'Ten tydzień', later: 'Później', undated: 'Bez terminu' },
  en: { overdue: 'Overdue', today: 'Today', week: 'This week', later: 'Later', undated: 'No date' },
}

export const followUpsFor = (kind: TaskScopeKind, language: Language): string[] => {
  const pl = language === 'pl'
  switch (kind) {
    case 'today': return pl ? ['A jutro?', 'Co zaległe?'] : ['And tomorrow?', 'What is overdue?']
    case 'tomorrow': return pl ? ['A pojutrze?', 'Co mam w tym tygodniu?'] : ['And the day after?', 'What do I have this week?']
    case 'nextWeek': return pl ? ['Co mam w tym tygodniu?', 'Co zaległe?'] : ['What do I have this week?', 'What is overdue?']
    case 'overdue': return pl ? ['Co mam dzisiaj?', 'Co mam jutro?'] : ['What do I have today?', 'What do I have tomorrow?']
    default: return pl ? ['Co mam dzisiaj?', 'Co zaległe?'] : ['What do I have today?', 'What is overdue?']
  }
}

interface Row {
  id: string
  noteId: string
  text: string
  title: string
  resolved: TaskDay | null
}

// Deterministic answer for "what do I have today / tomorrow / this week / overdue / to do".
export const answerTaskQuestion = (
  scope: TaskScope,
  input: { notes: readonly Note[]; tasks: readonly Task[] },
  language: Language,
  now: Date,
): AskAnswer => {
  const pl = language === 'pl'
  const today = startOfDay(now)
  const notes = new Map(input.notes.map((note) => [note.id, note]))
  // Only open tasks count, each read against the day its note was recorded.
  const rows: Row[] = input.tasks.flatMap((task) => {
    const note = notes.get(task.noteId)
    if (task.done || !note) return []
    return [{ id: task.id, noteId: task.noteId, text: task.text, title: splitTaskText(task.text).title, resolved: resolveTaskDay(task.text, note.createdAt) }]
  })
  const byDue = (left: Row, right: Row): number => (left.resolved?.date.getTime() ?? 0) - (right.resolved?.date.getTime() ?? 0)
  const sections: { label: TaskGroup | null; rows: Row[]; mode: 'time' | 'full'; overdue: boolean; heading?: string }[] = []
  let overdueAll: Row[] = []
  let inScope = 0

  if (scope.kind === 'all') {
    const created = new Map(input.notes.map((note) => [note.id, note.createdAt]))
    const groups = groupTasksByDue(rows, created, now)
    for (const [group, list] of groups) {
      if (!list.length) continue
      sections.push({ label: group, rows: list.map((item) => item.task), mode: 'full', overdue: group === 'overdue' })
      inScope += list.length
    }
  } else if (scope.range) {
    const { from, to } = scope.range
    const picked = rows.filter((row) => row.resolved && row.resolved.day >= from && row.resolved.day <= to).sort(byDue)
    inScope = picked.length
    const single = scope.kind === 'today' || scope.kind === 'tomorrow' || scope.kind === 'dayAfter' || scope.kind === 'day'
    if (scope.kind === 'overdue') sections.push({ label: 'overdue', rows: picked, mode: 'full', overdue: true })
    else {
      if (picked.length) sections.push({ label: 'today', rows: picked, mode: single ? 'time' : 'full', overdue: false, heading: scope.kind === 'today' ? GROUP_LABEL[language].today : pl ? 'W terminie' : 'Due' })
      if (scope.kind === 'today') {
        overdueAll = rows.filter((row) => row.resolved && row.resolved.day < today).sort(byDue)
        // The freshest few; the rest is one question away ("Co zaległe?").
        const shown = overdueAll.slice(-OVERDUE_CAP)
        if (shown.length) {
          const extra = overdueAll.length - shown.length
          sections.push({ label: 'overdue', rows: shown, mode: 'full', overdue: true, heading: extra > 0 ? `${GROUP_LABEL[language].overdue} (${overdueAll.length})` : GROUP_LABEL[language].overdue })
        }
      }
    }
  }

  const items: AskItem[] = []
  const sources: AskSource[] = []
  const sourceFor = (noteId: string): void => {
    if (sources.some((source) => source.noteId === noteId)) return
    const title = notes.get(noteId)?.title.trim() || (pl ? 'Bez tytułu' : 'Untitled')
    sources.push({ number: sources.length + 1, noteId, title })
  }
  const grouped = sections.length > 1
  for (const section of sections) {
    const heading = grouped ? (section.heading ?? (section.label ? GROUP_LABEL[language][section.label] : undefined)) : undefined
    for (const row of section.rows) {
      sourceFor(row.noteId)
      const due = row.resolved ? dueLabel(row.resolved, now, language, section.mode) : undefined
      items.push({
        text: row.title,
        noteId: row.noteId,
        ...(due ? { due } : {}),
        ...(section.overdue ? { overdue: true } : {}),
        ...(heading ? { group: heading } : {}),
      })
    }
  }

  const label = scopeLabel(scope, language)
  const overdueCount = overdueAll.length
  let intro: string
  if (scope.kind === 'all') {
    intro = inScope ? (pl ? `Masz ${inScope} otwartych zadań:` : `You have ${inScope} open tasks:`) : pl ? 'Nie masz otwartych zadań.' : 'You have no open tasks.'
  } else if (scope.kind === 'overdue') {
    intro = inScope ? (pl ? `Masz ${inScope} ${overdueWord(inScope, language)}:` : `You have ${inScope} ${overdueWord(inScope, language)}:`) : pl ? 'Nie masz zaległych zadań.' : 'You have no overdue tasks.'
  } else if (inScope) {
    intro = pl ? `Na ${label} masz ${inScope} ${tasksWord(inScope, language)}:` : `You have ${inScope} ${tasksWord(inScope, language)} for ${label}:`
  } else {
    const none = pl ? `Na ${label} nie masz zadań.` : `No tasks for ${label}.`
    intro = overdueCount
      ? `${none} ${pl ? `Masz jednak ${overdueCount} ${overdueWord(overdueCount, language)}:` : `You do have ${overdueCount} ${overdueWord(overdueCount, language)}:`}`
      : none
  }
  const lines = items.map((item) => `- ${item.text}${item.due ? ` — ${item.due}` : ''}`)
  return {
    text: [intro, ...lines].join('\n'),
    sources,
    cited: sources,
    deterministic: true,
    intro,
    items,
    followUps: followUpsFor(scope.kind, language),
  }
}
