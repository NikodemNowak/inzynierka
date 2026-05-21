import { create } from 'zustand'
import type { Note, NoteInput } from '../domain/note'
import * as repository from '../data/notesRepository'

interface NotesState {
  notes: Note[]
  loaded: boolean
  load: () => Promise<void>
  add: (input: NoteInput) => Promise<Note>
  update: (id: string, input: NoteInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

const byNewest = (a: Note, b: Note): number => b.updatedAt - a.updatedAt

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  load: async () => {
    const notes = await repository.listNotes()
    set({ notes, loaded: true })
  },
  add: async (input) => {
    const note = await repository.createNote(input)
    set({ notes: [note, ...get().notes] })
    return note
  },
  update: async (id, input) => {
    const updated = await repository.updateNote(id, input)
    set({ notes: get().notes.map((n) => (n.id === id ? updated : n)).sort(byNewest) })
  },
  remove: async (id) => {
    await repository.deleteNote(id)
    set({ notes: get().notes.filter((n) => n.id !== id) })
  },
}))
