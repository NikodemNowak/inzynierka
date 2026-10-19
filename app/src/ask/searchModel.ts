import { create } from 'zustand'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { indexFor } from './askService'
import { releaseEmbedder } from './embedder'
import { deleteEmbeddingModel, downloadEmbeddingModel, isEmbeddingModelDownloaded } from './embeddingModel'
import { clearVectors, indexMissingVectors } from './vectorStore'

// The optional search model: its download state and the background job that
// keeps note vectors up to date while it is installed.

interface SearchModelState {
  downloaded: boolean
  downloading: boolean
  percent: number
  error: string | null
  refresh: () => Promise<void>
  download: () => Promise<void>
  cancel: () => void
  remove: () => Promise<void>
}

let controller: AbortController | null = null

const indexNow = (): void => {
  if (!useSearchModelStore.getState().downloaded) return
  const index = indexFor(useNotesStore.getState().notes, useTasksStore.getState().tasks)
  void indexMissingVectors(index).catch(() => undefined)
}

export const useSearchModelStore = create<SearchModelState>((set) => ({
  downloaded: false,
  downloading: false,
  percent: 0,
  error: null,
  refresh: async () => set({ downloaded: await isEmbeddingModelDownloaded() }),
  download: async () => {
    controller = new AbortController()
    set({ downloading: true, percent: 0, error: null })
    try {
      await downloadEmbeddingModel((percent) => set({ percent }), controller.signal)
      set({ downloaded: true })
      indexNow()
    } catch (error) {
      set({ error: controller.signal.aborted ? null : error instanceof Error ? error.message : String(error) })
    } finally {
      set({ downloading: false })
      controller = null
    }
  },
  cancel: () => controller?.abort(),
  remove: async () => {
    await releaseEmbedder()
    await deleteEmbeddingModel()
    await clearVectors()
    set({ downloaded: false })
  },
}))

// New or edited notes get vectors a few seconds after they settle.
export const startSearchIndexing = (): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(indexNow, 8000)
  }
  void useSearchModelStore.getState().refresh().then(schedule)
  const unsubscribeNotes = useNotesStore.subscribe((state, previous) => {
    if (state.notes !== previous.notes) schedule()
  })
  const unsubscribeTasks = useTasksStore.subscribe((state, previous) => {
    if (state.tasks !== previous.tasks) schedule()
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribeNotes()
    unsubscribeTasks()
  }
}
