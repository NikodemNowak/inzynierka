import type { Language } from '../i18n/language'
import type { SummaryDocument } from './summary'
import type { AudioTimeline } from './audioTimeline'

export interface Note {
  id: string
  title: string
  content: string
  summary: string | null
  summaryDocument?: SummaryDocument | null
  tags: string[]
  audioUri: string | null
  durationMs: number | null
  audioTimeline?: AudioTimeline | null
  createdAt: number
  updatedAt: number
  language?: Language
  transcriptionIncomplete?: boolean
}

export interface NoteInput {
  language?: Language
  transcriptionIncomplete?: boolean
  title: string
  content: string
  summary: string | null
  summaryDocument?: SummaryDocument | null
  tags: string[]
  audioUri: string | null
  durationMs: number | null
  // Only set when a recording is first saved; edits keep the stored one.
  audioTimeline?: AudioTimeline | null
}
