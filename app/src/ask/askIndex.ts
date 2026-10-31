import { deterministicSourceUnitPlan } from '../ai/sourceUnits'
import { resolveSelfCorrections } from '../ai/selfCorrection'
import { applySpokenCorrections } from '../ai/spokenCorrections'
import { createSummarySources } from '../ai/summarySources'
import type { SummaryCorrection } from '../domain/summary'
import type { Language } from '../i18n/language'
import { resolveDue, resolveTaskDay } from '../tasks/taskDue'
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
  // Values the speaker changed, found when the note was processed.
  corrections?: readonly SummaryCorrection[]
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

type ChunkBase = Omit<AskChunk, 'id'>

// Chunks are cached per note (until its text changes) and per task (until its
// text or state changes), so toggling a task or editing one note re-splits and
// re-stems nothing else. Only the cheap assembly and document frequencies rerun.
interface NoteEntry { note: AskNote; chunks: ChunkBase[] }
const noteCache = new Map<string, NoteEntry>()
const taskCache = new Map<string, ChunkBase | null>()

const sameNote = (left: AskNote, right: AskNote): boolean =>
  left.title === right.title && left.content === right.content && left.summary === right.summary && left.createdAt === right.createdAt &&
  JSON.stringify(left.corrections ?? []) === JSON.stringify(right.corrections ?? [])

const base = (chunk: Omit<ChunkBase, 'terms'>): ChunkBase | null => {
  const found = terms(chunk.text)
  return found.length ? { ...chunk, terms: found } : null
}

const chunksOfNote = (note: AskNote): ChunkBase[] => {
  const cached = noteCache.get(note.id)
  if (cached && sameNote(cached.note, note)) return cached.chunks
  // "jutro o 18" in a note from Wednesday is Thursday: dates are read relative to the recording.
  const dayOf = (text: string): number | null => {
    const resolved = resolveDue(text, new Date(note.createdAt))
    return resolved ? startOfDay(resolved.date) : null
  }
  const chunks: ChunkBase[] = []
  const push = (chunk: Omit<ChunkBase, 'terms'>): void => {
    const made = base(chunk)
    if (made) chunks.push(made)
  }
  if (note.title.trim()) push({ noteId: note.id, kind: 'title', text: note.title, order: -1, day: null, done: false })
  // The chat quotes the final version of a changed value, like the summary.
  applySpokenCorrections(sentencesOf(note.content).map((text) => resolveSelfCorrections(text, note.language ?? 'pl')), note.corrections ?? []).forEach((text, order) => push({ noteId: note.id, kind: 'sentence', text, order, day: dayOf(text), done: false }))
  pointsOf(note.summary).forEach((text, order) => push({ noteId: note.id, kind: 'point', text, order, day: dayOf(text), done: false }))
  noteCache.set(note.id, { note: { ...note }, chunks })
  return chunks
}

export const buildAskIndex = (notes: readonly AskNote[], tasks: readonly AskTask[]): AskIndex => {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const chunks: AskChunk[] = []
  const add = (chunk: ChunkBase): void => {
    chunks.push({ ...chunk, id: chunks.length })
  }
  for (const note of notes) for (const chunk of chunksOfNote(note)) add(chunk)
  const taskKeys = new Set<string>()
  for (const task of tasks) {
    const note = byId.get(task.noteId)
    if (!note) continue
    const key = `${task.noteId}|${note.createdAt}|${task.done ? 1 : 0}|${task.text}`
    taskKeys.add(key)
    if (!taskCache.has(key)) {
      const resolved = resolveTaskDay(task.text, note.createdAt)
      taskCache.set(key, base({ noteId: note.id, kind: 'task', text: task.text, order: -1, day: resolved ? resolved.day : null, done: task.done }))
    }
    const cached = taskCache.get(key)
    if (cached) add(cached)
  }
  // Entries of deleted notes and tasks go away.
  for (const id of noteCache.keys()) if (!byId.has(id)) noteCache.delete(id)
  for (const key of taskCache.keys()) if (!taskKeys.has(key)) taskCache.delete(key)
  const df = new Map<string, number>()
  for (const chunk of chunks) for (const term of new Set(chunk.terms)) df.set(term, (df.get(term) ?? 0) + 1)
  const averageLength = chunks.reduce((sum, chunk) => sum + chunk.terms.length, 0) / Math.max(1, chunks.length)
  return { notes: byId, chunks, df, averageLength }
}
