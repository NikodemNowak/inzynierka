export interface Note {
  id: string
  title: string
  content: string
  summary: string | null
  createdAt: number
  updatedAt: number
}

export interface NoteInput {
  title: string
  content: string
  summary: string | null
}
