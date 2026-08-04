import { generate, isModelLoaded, loadModel } from './llm'
import { getModelPath, isModelDownloaded } from './modelDownload'
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

const BANNED_PREFIXES = [
  'notatka',
  'nagranie',
  'transkrypt',
  'streszczenie',
  'podsumowanie',
  'tytuł',
  'ten tekst',
  'autor',
]

// Conversational fillers a chatty note opens with; the model tends to parrot
// them ("Dobrze, to taka notatka na szybko...") instead of getting to the point.
const FILLER_OPENER =
  /^(dobrze|dobra|no|ok|okej|okay|tak|więc|wiec|cóż|coz|otóż|otoz|hej|a więc|a wiec)\b[\s,.:;–—-]*/i

// The model sometimes regurgitates its own instructions/system prompt instead
// of answering. Such output is never a valid title/summary.
const INSTRUCTION_MARKERS = [
  'wymagania:',
  'zwróć wyłącznie',
  'zwroc wylacznie',
  'podaj tytuł',
  'podaj tytul',
  'streść poniższą',
  'stresc ponizsza',
  'fraza rzeczownikowa',
  'nie powtarzaj',
]

const looksLikeInstructionEcho = (text: string): boolean => {
  const lower = text.toLowerCase()
  return INSTRUCTION_MARKERS.some((marker) => lower.includes(marker))
}

const stripModelArtifacts = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .replace(/^(tytuł|streszczenie)\s*[:\-]\s*/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(FILLER_OPENER, '')
    .trim()

const stripBannedOpener = (text: string): string => {
  const pattern = new RegExp(
    `^(${BANNED_PREFIXES.join('|')})\\b[\\s:,\\-–—]*(dotyczy|opisuje|mówi o|zawiera|przedstawia)?[\\s:,\\-–—]*`,
    'i',
  )
  const next = text.replace(pattern, '').trim()
  return next.length > 0 ? next[0].toUpperCase() + next.slice(1) : text
}

const firstWords = (text: string, count: number): string =>
  text.split(/\s+/).filter(Boolean).slice(0, count).join(' ')

const cleanTitle = (raw: string): string => {
  const stripped = stripModelArtifacts(raw)
  if (looksLikeInstructionEcho(stripped)) return ''
  const firstLine = stripped.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const withoutBanned = stripBannedOpener(firstLine)
    .replace(/^["'„”»«\s]+|["'„”»«\s]+$/g, '')
    .replace(/[.,;:!?\s]+$/g, '')
    .trim()
  return firstWords(withoutBanned, 8)
}

// Fallback only when the model returns nothing usable. Prefer the summary (clean,
// topic-first) and strip any conversational opener so we never fall back to the
// note's chatty intro (e.g. "Dobra, to taka notatka na szybko").
const fallbackTitle = (source: string): string => {
  const firstSentence = stripModelArtifacts(source).split(/[.!?\n]/)[0] ?? source
  return firstWords(firstSentence.trim(), 6)
}

const cleanSummary = (raw: string): string => {
  const stripped = stripModelArtifacts(raw)
  if (looksLikeInstructionEcho(stripped)) return ''
  return stripBannedOpener(stripped)
}

// Classification, not generation: keep only outputs that exactly match a known
// category (case-insensitive), mapped back to canonical casing. Anything else
// (including "brak") is dropped, so the result is always a subset of the set.
const CATEGORY_BY_LOWER = new Map<string, string>(
  NOTE_CATEGORIES.map((c) => [c.toLowerCase(), c]),
)

const parseTags = (raw: string): string[] => {
  const cleaned = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
  const found = cleaned
    .replace(/\n/g, ',')
    .split(',')
    .map((part) => CATEGORY_BY_LOWER.get(part.trim().toLowerCase().replace(/["'`.#]/g, '').trim()))
    .filter((category): category is string => category !== undefined)
  return Array.from(new Set(found)).slice(0, 2)
}

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()

const stems = (text: string): string[] =>
  normalize(text)
    .split(' ')
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 4))

// Token-overlap similarity: high value means the summary reuses almost the same
// words as the note (a near-verbatim copy, even if punctuation/diacritics differ).
const jaccard = (a: string, b: string): number => {
  const setA = new Set(stems(a))
  const setB = new Set(stems(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  setA.forEach((stem) => {
    if (setB.has(stem)) intersection += 1
  })
  return intersection / (setA.size + setB.size - intersection)
}

const wordCountOf = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length

// A copy is a summary that failed to compress: it reuses almost the same words
// AND stays nearly as long as the note. A faithful but genuinely short summary
// shares vocabulary too, so length is what separates a summary from a copy.
const isCopy = (summary: string, content: string): boolean => {
  const o = normalize(summary)
  const c = normalize(content)
  if (o.length === 0) return true
  if (c.includes(o)) return true
  // Already-dense notes (e.g. a terse meeting recap) can't be compressed much, so
  // a faithful summary stays similar in length and vocabulary. Only flag output
  // that is BOTH almost as long AND almost the same words — a genuine non-summary.
  const lengthRatio = wordCountOf(summary) / Math.max(1, wordCountOf(content))
  return lengthRatio >= 0.85 && jaccard(summary, content) >= 0.8
}

// Catches hallucinations: a summary that shares almost no vocabulary with the
// transcript (e.g. a small model copying a few-shot example) is not grounded.
const isUngrounded = (summary: string, content: string): boolean => {
  const summaryStems = stems(summary)
  if (summaryStems.length === 0) return true
  const contentStems = new Set(stems(content))
  const shared = summaryStems.filter((stem) => contentStems.has(stem)).length
  return shared / summaryStems.length < 0.3
}

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
  const tags = parseTags(tagsResult.text)

  return { title, summary, tags }
}
