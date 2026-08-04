import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import type { Note } from '../domain/note'
import type { Task } from '../domain/task'
import { listMetrics, type GenerationMetric } from '../data/metricsRepository'

const EXPORT_VERSION = 1

interface ExportedTask {
  text: string
  done: boolean
  createdAt: number
}

interface ExportedNote {
  id: string
  title: string
  content: string
  summary: string | null
  tags: string[]
  durationMs: number | null
  createdAt: number
  updatedAt: number
  tasks: ExportedTask[]
}

export interface ExportPayload {
  version: number
  exportedAt: number
  notes: ExportedNote[]
  // Performance measurements travel with the export so the numbers behind the
  // stated criteria can be read off a device that is not attached to a debugger.
  metrics: GenerationMetric[]
}

// The app has no cloud sync, so this file is the only way a user's own data can
// leave the device on their terms. Machine-readable on purpose: an export that
// cannot be parsed elsewhere is not portable data.
// audioUri is deliberately absent — it is a path on this device only, and
// including it would suggest the recordings travel with the file. They do not.
export const buildExportPayload = (
  notes: readonly Note[],
  tasks: readonly Task[],
  exportedAt: number,
  metrics: readonly GenerationMetric[] = [],
): ExportPayload => ({
  version: EXPORT_VERSION,
  exportedAt,
  metrics: [...metrics],
  notes: notes.map((note) => ({
    id: note.id,
    title: note.title,
    content: note.content,
    summary: note.summary,
    tags: note.tags,
    durationMs: note.durationMs,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tasks: tasks
      .filter((task) => task.noteId === note.id)
      .map((task) => ({ text: task.text, done: task.done, createdAt: task.createdAt })),
  })),
})

export const exportFileName = (exportedAt: number): string => {
  const date = new Date(exportedAt)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `notatki-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

export const shareNotesExport = async (
  notes: readonly Note[],
  tasks: readonly Task[],
): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Udostępnianie plików jest niedostępne na tym urządzeniu')
  }

  const exportedAt = Date.now()
  const payload = buildExportPayload(notes, tasks, exportedAt, await listMetrics())
  // Written to the cache directory: the file exists only to hand over to the
  // share sheet, and the system may reclaim it afterwards.
  const path = `${FileSystem.cacheDirectory}${exportFileName(exportedAt)}`
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2))

  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: 'Eksport notatek',
    UTI: 'public.json',
  })
}
