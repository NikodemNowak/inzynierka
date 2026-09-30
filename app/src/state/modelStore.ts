import { create } from 'zustand'
import {
  deleteModel,
  ModelDownloadCancelledError,
  downloadModel,
  getModelSizeBytes,
  isModelDownloaded,
} from '../ai/modelDownload'
import { unloadModel } from '../ai/llm'
import { enqueueLlm } from '../ai/llmQueue'
import { modelDownloadErrorMessage } from '../ai/modelDownloadError'

export type ModelStatus = 'checking' | 'absent' | 'downloading' | 'ready'

interface ModelState {
  status: ModelStatus
  // 0-100 while downloading.
  progress: number
  isCancelling: boolean
  sizeBytes: number
  error: string | null
  refresh: () => Promise<void>
  download: () => Promise<void>
  cancelDownload: () => Promise<void>
  remove: () => Promise<void>
}

let activeDownloadController: AbortController | null = null
let activeDownloadPromise: Promise<void> | null = null

// Downloading the model is a deliberate, user-initiated action rather than a
// hidden step of note processing, so its state lives here: the welcome screen
// and the settings screen show the same progress, and it survives navigation.
export const useModelStore = create<ModelState>((set, get) => ({
  status: 'checking',
  progress: 0,
  isCancelling: false,
  sizeBytes: 0,
  error: null,

  refresh: async () => {
    if (activeDownloadPromise) return
    const downloaded = await isModelDownloaded()
    if (activeDownloadPromise) return
    const sizeBytes = downloaded ? await getModelSizeBytes() : 0
    if (activeDownloadPromise) return
    set({
      status: downloaded ? 'ready' : 'absent',
      progress: 0,
      sizeBytes,
      error: null,
    })
  },

  download: () => {
    if (activeDownloadPromise) return activeDownloadPromise
    if (get().status === 'downloading') return Promise.resolve()

    const controller = new AbortController()
    activeDownloadController = controller
    set({
      status: 'downloading',
      progress: 0,
      error: null,
      isCancelling: false,
    })

    const operation = (async () => {
      try {
        await downloadModel((progress) => {
          if (!controller.signal.aborted) set({ progress })
        }, controller.signal)
        set({
          status: 'ready',
          progress: 100,
          sizeBytes: await getModelSizeBytes(),
          error: null,
        })
      } catch (error) {
        const cancelled = error instanceof ModelDownloadCancelledError
        set({
          status: 'absent',
          progress: 0,
          sizeBytes: 0,
          error: cancelled ? null : modelDownloadErrorMessage(error),
        })
      } finally {
        if (activeDownloadController === controller)
          activeDownloadController = null
        set({ isCancelling: false })
      }
    })()

    activeDownloadPromise = operation
    void operation.then(
      () => {
        if (activeDownloadPromise === operation) activeDownloadPromise = null
      },
      () => {
        if (activeDownloadPromise === operation) activeDownloadPromise = null
      },
    )
    return operation
  },

  cancelDownload: async () => {
    const controller = activeDownloadController
    const operation = activeDownloadPromise
    if (!controller || !operation) return
    set({ isCancelling: true })
    controller.abort()
    await operation
  },

  remove: async () => {
    set({ error: null })
    try {
      // Queued so the weights are never freed from under a running generation.
      await enqueueLlm(unloadModel)
      await deleteModel()
      set({ status: 'absent', progress: 0, sizeBytes: 0 })
    } catch {
      set({ error: 'Nie udało się usunąć modelu. Spróbuj ponownie.' })
    }
  },
}))
