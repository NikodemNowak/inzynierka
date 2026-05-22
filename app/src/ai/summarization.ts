import { generate, isModelLoaded, loadModel } from './llm'
import { downloadModel, getModelPath, isModelDownloaded } from './modelDownload'

export type SummarizationPhase = 'downloading' | 'loading' | 'generating'

export interface SummarizationProgress {
  phase: SummarizationPhase
  percent?: number
}

const buildPrompt = (content: string): string => `
/no_think
Napisz bardzo krótkie streszczenie notatki po polsku.
Odpowiedz jednym zdaniem, 8-14 słów.
Bez prefiksów typu "Notatka:" albo "Streszczenie:".
Nie dodawaj informacji spoza tekstu.

Tekst notatki:
"""
${content}
"""
`.trim()

const cleanSummary = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .replace(/^(streszczenie|notatka|podgląd):\s*/i, '')
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
