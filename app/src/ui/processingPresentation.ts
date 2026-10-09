import type { ProcessingProgress } from '../ai/noteProcessing'

type Translate = (polish: string, english: string) => string
export type ProcessingVisualStage = 'queued' | 'loading' | 'processing' | 'saving'

// Counts describe completed work, never an estimated time or an invented percent.
export const processingPresentation = (
  progress: ProcessingProgress | undefined,
  t: Translate,
): { label: string; stage: ProcessingVisualStage } => {
  if (progress?.phase === 'queued')
    return { label: t('Czekam na model…', 'Waiting for model…'), stage: 'queued' }
  if (progress?.phase === 'loading')
    return { label: t('Wczytuję model…', 'Loading model…'), stage: 'loading' }
  if (progress?.phase === 'processing' && progress.detail === 'structure')
    return { label: t('Porządkuję wypowiedź…', 'Structuring speech…'), stage: 'processing' }

  const label = progress?.phase === 'summary'
    ? t('Tworzę podsumowanie…', 'Preparing summary…')
    : progress?.phase === 'title'
      ? t('Dobieram tytuł…', 'Preparing title…')
      : progress?.phase === 'tags'
        ? t('Dobieram kategorię…', 'Choosing a category…')
        : progress?.phase === 'reduction'
          ? t('Łączę informacje…', 'Combining information…')
          : progress?.phase === 'fragment'
            ? t('Analizuję fragmenty…', 'Analyzing sections…')
            : t('Opracowuję tekst…', 'Processing text…')
  const { completed, total } = progress ?? {}
  const counts = typeof completed === 'number' && typeof total === 'number' &&
    Number.isInteger(completed) && Number.isInteger(total) &&
    total > 0 && completed >= 0 && completed <= total
  return { label: counts ? `${label.replace(/…$/, '')} · ${completed}/${total}` : label, stage: 'processing' }
}
