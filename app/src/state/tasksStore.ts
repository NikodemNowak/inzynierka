import { create } from 'zustand'
import type { Task } from '../domain/task'
import * as repository from '../data/tasksRepository'

interface TasksState {
  tasks: Task[]
  load: () => Promise<void>
  addForNote: (noteId: string, texts: string[]) => Promise<void>
  toggle: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  removeForNote: (noteId: string) => Promise<void>
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  load: async () => {
    set({ tasks: await repository.listTasks() })
  },
  addForNote: async (noteId, texts) => {
    const created = await repository.createTasks(noteId, texts)
    set({ tasks: [...created, ...get().tasks] })
  },
  toggle: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    await repository.setTaskDone(id, !task.done)
    set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })
  },
  remove: async (id) => {
    await repository.deleteTask(id)
    set({ tasks: get().tasks.filter((t) => t.id !== id) })
  },
  removeForNote: async (noteId) => {
    await repository.deleteTasksForNote(noteId)
    set({ tasks: get().tasks.filter((t) => t.noteId !== noteId) })
  },
}))
