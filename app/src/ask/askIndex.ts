import { deterministicSourceUnitPlan } from '../ai/sourceUnits'
import { createSummarySources } from '../ai/summarySources'
import type { Language } from '../i18n/language'
import { resolveDue, splitTaskText } from '../tasks/taskDue'
import { terms } from './askText'

// Everything the chat can quote: transcript sentences, summary points and tasks,
// each tied to its note. Built in memory from the stores; a note set of a few
// hundred notes stays well under a millisecond per question to score.

export interface AskNote {
  id: string
  title: string
  content: string
  summary: string | null
  createdAt: number
  language?: Language
}

export interface AskTask {
  noteId: string
  text: string
  done: boolean
}

export type ChunkKind = 'sentence' | 'point' | 'task' | 'title'

export interface AskChunk {
  id: number
  noteId: string
  kind: ChunkKind
  text: string
  // Position of a sentence in its note, to add neighbours as context.
  order: number
  // Calendar day of a task deadline (start of day, ms) when it resolves.
  day: number | null
  done: boolean
  terms: string[]
}

export interface AskIndex {
  notes: ReadonlyMap<string, AskNote>
  chunks: readonly AskChunk[]
  // Document frequency per term and average chunk length, for BM25.
  df: ReadonlyMap<string, number>
  averageLength: number
}

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const sentencesOf = (content: string): string[] => {
  const plan = deterministicSourceUnitPlan(content) ?? undefined
  return createSummarySources(content, plan).map((unit) => unit.text).filter((text) => text.trim().length > 0)
}

const pointsOf = (summary: string | null): string[] =>
  (summary ?? '').split(/\r?\n/u).map((line) => line.replace(/^\s*[•\-*]\s*/u, '').trim()).filter(Boolean)

export const buildAskIndex = (notes: readonly AskNote[], tasks: readonly AskTask[]): AskIndex => {
  const chunks: AskChunk[] = []
  const push = (chunk: Omit<AskChunk, 'id' | 'terms'>): void => {
    const found = terms(chunk.text)
    if (found.length) chunks.push({ ...chunk, id: chunks.length, terms: found })
  }
  for (const note of notes) {
    // "jutro o 18" in a note from Wednesday is Thursday: dates are read relative to the recording.
    const dayOf = (text: string): number | null => {
      const resolved = resolveDue(text, new Date(note.createdAt))
      return resolved ? startOfDay(resolved.date) : null
    }
    if (note.title.trim()) push({ noteId: note.id, kind: 'title', text: note.title, order: -1, day: null, done: false })
    sentencesOf(note.content).forEach((text, order) => push({ noteId: note.id, kind: 'sentence', text, order, day: dayOf(text), done: false }))
    pointsOf(note.summary).forEach((text, order) => push({ noteId: note.id, kind: 'point', text, order, day: dayOf(text), done: false }))
  }
  const byId = new Map(notes.map((note) => [note.id, note]))
  for (const task of tasks) {
    const note = byId.get(task.noteId)
    if (!note) continue
    const { due } = splitTaskText(task.text)
    const resolved = due ? resolveDue(due, new Date(note.createdAt)) : null
    push({ noteId: note.id, kind: 'task', text: task.text, order: -1, day: resolved ? startOfDay(resolved.date) : null, done: task.done })
  }
  const df = new Map<string, number>()
  for (const chunk of chunks) for (const term of new Set(chunk.terms)) df.set(term, (df.get(term) ?? 0) + 1)
  const averageLength = chunks.reduce((sum, chunk) => sum + chunk.terms.length, 0) / Math.max(1, chunks.length)
  return { notes: byId, chunks, df, averageLength }
}
