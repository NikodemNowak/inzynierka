import { generate, isModelLoaded, loadModel } from './llm'
import { downloadModel, getModelPath, isModelDownloaded } from './modelDownload'

export type SummarizationPhase = 'downloading' | 'loading' | 'generating'

export interface SummarizationProgress {
  phase: SummarizationPhase
  percent?: number
}

const buildPrompt = (content: string): string => `
Streść poniższą notatkę po polsku w 2-4 zdaniach.
Zwróć wyłącznie gotowe streszczenie, bez nagłówków, list i komentarzy.

Notatka:
${content}
`.trim()

const cleanSummary = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .replace(/^streszczenie:\s*/i, '')
    .trim()

export const summarizeNoteContent = async (
  content: string,
  onProgress: (progress: SummarizationProgress) => void,
): Promise<string> => {
  if (!(await isModelDownloaded())) {
    onProgress({ phase: 'downloading', percent: 0 })
    await downloadModel((percent) => onProgress({ phase: 'downloading', percent }))
  }

  if (!isModelLoaded()) {
    onProgress({ phase: 'loading', percent: 0 })
    await loadModel(getModelPath(), (percent) => onProgress({ phase: 'loading', percent }))
  }

  onProgress({ phase: 'generating' })
  const result = await generate(buildPrompt(content), () => undefined)
  const summary = cleanSummary(result.text)
  if (summary.length === 0) throw new Error('Model zwrócił puste streszczenie')
  return summary
}
