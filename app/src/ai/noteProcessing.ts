import { generate, isModelLoaded, loadModel } from './llm'
import { getModelPath, isModelDownloaded } from './modelDownload'
import {
  cleanSummary,
  cleanTitle,
  fallbackTitle,
  isCopy,
  isUngrounded,
  parseTags,
} from './noteOutput'
import { recordGeneration } from './generationMetrics'
import { NOTE_CATEGORIES } from '../domain/categories'

export type ProcessingPhase = 'loading' | 'title' | 'summary' | 'tags'

// Thrown instead of silently fetching 1 GB or more: the model only ever arrives
// through an explicit request from the user, on the welcome or settings screen.
export const MODEL_MISSING_MESSAGE =
  'Model językowy nie jest pobrany. Włącz go w Ustawieniach, aby korzystać z funkcji AI.'

export interface ProcessingProgress {
  phase: ProcessingPhase
  percent?: number
}

export interface NoteProcessingResult {
  title: string
  summary: string
  tags: string[]
}

const TITLE_SYSTEM =
  'Tworzysz krótkie, trafne tytuły polskich notatek. Odpowiadasz wyłącznie po polsku.'

const SUMMARY_SYSTEM =
  'Streszczasz polskie notatki głosowe zwięźle i rzeczowo. Odpowiadasz wyłącznie po polsku.'

const TAGS_SYSTEM =
  'Nadajesz krótkie tagi tematyczne polskim notatkom. Odpowiadasz wyłącznie po polsku.'

const titlePrompt = (content: string): string =>
  `/no_think
Podaj tytuł dla poniższej notatki.
Wymagania:
- 3-5 słów, fraza rzeczownikowa (nie zdanie, nie pytanie).
- Oddaj główny temat CAŁEJ notatki, nie pierwszy szczegół.
- Jeśli notatka obejmuje kilka różnych spraw, podaj ich wspólny motyw (np. "Zadania na tydzień"), nie jedną z nich.
- Bez kropki, bez cudzysłowów, bez słów "notatka", "nagranie", "tekst".
- Nie powtarzaj wstępu notatki ani tych instrukcji. Zwróć wyłącznie sam tytuł.

Notatka:
"""
${content}
"""`

const summaryPrompt = (content: string): string =>
  `/no_think
Streść poniższą notatkę w 2-4 zdaniach. Streszczenie ma być wyraźnie krótsze niż notatka.
Zasady:
- Oddaj najważniejszą treść notatki, niezależnie od tego, czego dotyczy.
- Pełne, płynne zdania. Bez wypunktowań, bez list, bez nagłówka z dwukropkiem na początku.
- Zachowaj konkretne zadania, terminy, osoby i liczby dokładnie jak w notatce.
- Pomiń wstęp i dygresje (np. "taka notatka na szybko", "żeby nie zapomnieć").
- Nie zaczynaj od "Notatka"/"Dla notatki"/"Ta notatka". Własnymi słowami; nie kopiuj zdań z notatki i nie powtarzaj tych instrukcji.

Notatka:
"""
${content}
"""`

const tagsPrompt = (content: string): string =>
  `/no_think
Przypisz poniższą notatkę do pasujących kategorii z listy.
Lista kategorii: ${NOTE_CATEGORIES.join(', ')}.
Zasady:
- Wybierz 1-2 kategorie, które najlepiej pasują. Jeśli żadna nie pasuje, napisz "brak".
- Użyj WYŁĄCZNIE nazw z listy, oddzielonych przecinkiem.
- Zwróć tylko nazwy kategorii, nic więcej.

Notatka:
"""
${content}
"""`

export const ensureModelReady = async (
  onProgress: (progress: ProcessingProgress) => void,
): Promise<void> => {
  if (!(await isModelDownloaded())) throw new Error(MODEL_MISSING_MESSAGE)
  if (!isModelLoaded()) {
    onProgress({ phase: 'loading', percent: 0 })
    await loadModel(getModelPath(), (percent) => onProgress({ phase: 'loading', percent }))
  }
}

export const processNoteWithLlm = async (
  content: string,
  onProgress: (progress: ProcessingProgress) => void,
): Promise<NoteProcessingResult> => {
  await ensureModelReady(onProgress)

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length

  // Short notes have nothing to compress — any "summary" would just be a copy.
  // Skip summarization and only generate a title from the content itself.
  let summary = ''
  if (wordCount >= 30) {
    onProgress({ phase: 'summary' })
    const summaryResult = await generate(summaryPrompt(content), () => undefined, {
      system: SUMMARY_SYSTEM,
      nPredict: 256,
    })
    recordGeneration('summary', content.length, summaryResult)
    summary = cleanSummary(summaryResult.text)

    if (summary.length === 0) throw new Error('Model zwrócił puste streszczenie')
    if (isCopy(summary, content)) {
      throw new Error(
        'Model przepisał treść zamiast ją streścić (lokalny model jest za słaby na tym urządzeniu — na docelowym Qwen3-4B będzie poprawnie)',
      )
    }
    if (isUngrounded(summary, content)) {
      throw new Error(
        'Model wygenerował streszczenie niezwiązane z treścią (lokalny model jest za słaby na tym urządzeniu — na docelowym Qwen3-4B będzie poprawnie)',
      )
    }
  }

  // Title from the full note, not the summary: the note's opening usually states
  // the main topic, whereas the summary reorders/drops it and the title then
  // latches onto a side detail.
  const titleSource = content
  onProgress({ phase: 'title' })
  const titleResult = await generate(titlePrompt(titleSource), () => undefined, {
    system: TITLE_SYSTEM,
    nPredict: 24,
  })
  recordGeneration('title', titleSource.length, titleResult)
  const generatedTitle = cleanTitle(titleResult.text)
  // No grounding check on the title: a good title generalises (e.g. "Zadania na
  // tydzień") with words that need not appear verbatim in the note. cleanTitle
  // already drops instruction echoes, so a non-empty result is usable.
  const title =
    generatedTitle.length > 0 ? generatedTitle : fallbackTitle(summary.length > 0 ? summary : content)

  onProgress({ phase: 'tags' })
  const tagsResult = await generate(tagsPrompt(content), () => undefined, {
    system: TAGS_SYSTEM,
    nPredict: 40,
  })
  recordGeneration('tags', content.length, tagsResult)
  const tags = parseTags(tagsResult.text)

  return { title, summary, tags }
}
