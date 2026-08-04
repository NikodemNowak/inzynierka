import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { isCategory } from '../domain/categories'

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

// Plain text rather than Markdown: the note is shared into whatever the user
// picks (mail, messenger, another notes app), and most of those render markup
// as literal characters.
export const formatNoteAsText = (note: Note, tasks: readonly Task[]): string => {
  const categories = note.tags.filter(isCategory)
  const sections: string[] = [
    note.title.trim().length > 0 ? note.title.trim() : '(bez tytułu)',
    formatDate(note.createdAt),
  ]

  if (categories.length > 0) sections.push(`Kategorie: ${categories.join(', ')}`)

  const summary = note.summary?.trim() ?? ''
  if (summary.length > 0) sections.push(summary)

  // With a summary present the transcript is supporting detail, so it is
  // labelled; on its own it is simply the note's content.
  const content = note.content.trim()
  if (content.length > 0) {
    sections.push(summary.length > 0 ? `— Transkrypcja —\n${content}` : content)
  }

  if (tasks.length > 0) {
    const lines = tasks.map((task) => `${task.done ? '☑' : '☐'} ${task.text}`)
    sections.push(`— Zadania —\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}
