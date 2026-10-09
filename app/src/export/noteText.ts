import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { categoryLabel, isCategory } from '../domain/categories'
import { localeForLanguage, type Language } from '../i18n/language'

const formatDate = (ms: number, language: Language): string =>
  new Date(ms).toLocaleString(localeForLanguage(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

// Plain text rather than Markdown: the note is shared into whatever the user
// picks (mail, messenger, another notes app), and most of those render markup
// as literal characters.
export const formatNoteAsText = (
  note: Note,
  tasks: readonly Task[],
  language: Language = 'pl',
): string => {
  const categories = note.tags.filter(isCategory)
  const sections: string[] = [
    note.title.trim().length > 0
      ? note.title.trim()
      : language === 'pl'
        ? '(bez tytułu)'
        : '(untitled)',
    formatDate(note.createdAt, language),
  ]

  if (categories.length > 0)
    sections.push(
      `${language === 'pl' ? 'Kategorie' : 'Categories'}: ${categories.map((category) => categoryLabel(category, language)).join(', ')}`,
    )

  const summary = note.summary?.trim() ?? ''
  if (summary.length > 0) sections.push(summary)

  // With a summary present the transcript is supporting detail, so it is
  // labelled; on its own it is simply the note's content.
  const content = note.content.trim()
  if (content.length > 0) {
    sections.push(
      summary.length > 0
        ? `— ${language === 'pl' ? 'Transkrypcja' : 'Transcript'} —\n${content}`
        : content,
    )
  }

  if (tasks.length > 0) {
    const lines = tasks.map((task) => `${task.done ? '☑' : '☐'} ${task.text}`)
    sections.push(
      `— ${language === 'pl' ? 'Zadania' : 'Tasks'} —\n${lines.join('\n')}`,
    )
  }

  return sections.join('\n\n')
}
