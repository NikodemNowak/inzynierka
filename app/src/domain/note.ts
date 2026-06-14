export interface Note {
  id: string
  title: string
  content: string
  summary: string | null
  tags: string[]
  audioUri: string | null
  durationMs: number | null
  createdAt: number
  updatedAt: number
}

export interface NoteInput {
  title: string
  content: string
  summary: string | null
  tags: string[]
  audioUri: string | null
  durationMs: number | null
}
