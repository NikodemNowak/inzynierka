import { create } from 'zustand'
import {
  deleteModel,
  downloadModel,
  getModelSizeBytes,
  isModelDownloaded,
} from '../ai/modelDownload'
import { unloadModel } from '../ai/llm'
import { enqueueLlm } from '../ai/llmQueue'

export type ModelStatus = 'checking' | 'absent' | 'downloading' | 'ready'

interface ModelState {
  status: ModelStatus
  // 0-100 while downloading.
  progress: number
  sizeBytes: number
  error: string | null
  refresh: () => Promise<void>
  download: () => Promise<void>
  remove: () => Promise<void>
}

// Downloading the model is a deliberate, user-initiated action rather than a
// hidden step of note processing, so its state lives here: the welcome screen
// and the settings screen show the same progress, and it survives navigation.
export const useModelStore = create<ModelState>((set, get) => ({
  status: 'checking',
  progress: 0,
  sizeBytes: 0,
  error: null,

  refresh: async () => {
    const downloaded = await isModelDownloaded()
    set({
      status: downloaded ? 'ready' : 'absent',
      sizeBytes: downloaded ? await getModelSizeBytes() : 0,
    })
  },

  download: async () => {
    if (get().status === 'downloading') return
    set({ status: 'downloading', progress: 0, error: null })
    try {
      await downloadModel((progress) => set({ progress }))
      set({ status: 'ready', progress: 100, sizeBytes: await getModelSizeBytes() })
    } catch (e) {
      set({
        status: 'absent',
        progress: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  remove: async () => {
    set({ error: null })
    try {
      // Queued so the weights are never freed from under a running generation.
      await enqueueLlm(unloadModel)
      await deleteModel()
      set({ status: 'absent', progress: 0, sizeBytes: 0 })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
