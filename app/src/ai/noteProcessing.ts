import { generate, isModelLoaded, loadModel } from './llm'
import { downloadModel, getModelPath, isModelDownloaded } from './modelDownload'

export type ProcessingPhase = 'downloading' | 'loading' | 'title' | 'summary'

export interface ProcessingProgress {
  phase: ProcessingPhase
  percent?: number
}

export interface NoteProcessingResult {
  title: string
  summary: string
}

const TITLE_SYSTEM = `Zadanie: nadajesz krótki tytuł notatce głosowej.
Cel: czytelnik po samym tytule wie, czego dotyczy CAŁA notatka.
Zasady:
- Dokładnie 3-5 słów. Fraza rzeczownikowa, nie zdanie i nie pytanie.
- Opisz GŁÓWNY temat notatki (zwykle z pierwszego zdania), nie poboczny wątek.
- Po polsku, własnymi słowami. Bez kropki, bez cudzysłowów, bez słów "Notatka"/"Nagranie".
- Zwróć wyłącznie tytuł, nic więcej.`

const SUMMARY_SYSTEM = `Zadanie: tworzysz KRÓTKIE streszczenie notatki głosowej dla zapracowanego profesjonalisty.
Cel: czytelnik ma zrozumieć sedno bez czytania całej notatki, więc streszczenie musi oszczędzać czas.
Zasady:
- Maksymalnie 3 krótkie zdania i nie więcej niż ~45 słów. Streszczenie ma być WYRAŹNIE krótsze niż notatka.
- Zawrzyj tylko NAJWAŻNIEJSZE ustalenia i wnioski. Pomiń szczegóły drugorzędne.
- Pisz własnymi słowami, w 3. osobie. Nie przepisuj zdań z notatki.
- Zachowaj kluczowe konkrety (osoby, daty, kwoty) tylko jeśli są istotne. Nie dodawaj nic spoza notatki.
- Nie zaczynaj od "Notatka"/"Streszczenie"/"Nagranie". Zwróć samo streszczenie po polsku.`

const titlePrompt = (content: string): string =>
  `/no_think
Tekst: Jutro o dziesiątej spotkanie z klientem w sprawie umowy najmu biura, trzeba przygotować aneks i sprawdzić termin płatności.
Tytuł: Spotkanie w sprawie najmu biura

Tekst: Dzisiaj zebranie zespołu o wdrożeniu systemu CRM; ustalono migrację w czerwcu, podział zadań, obawy o integrację i wzrost budżetu.
Tytuł: Wdrożenie systemu CRM

Tekst: Pacjent zgłasza bóle głowy od tygodnia, nasilenie wieczorem, zalecam morfologię i kontrolę ciśnienia.
Tytuł: Konsultacja: bóle głowy

Tekst: ${content}
Tytuł:`

const summaryPrompt = (content: string): string =>
  `/no_think
Notatka: Dzisiaj na zebraniu omówiliśmy budżet na przyszły rok, ustaliliśmy że dział marketingu dostanie większe środki, Kowalski przygotuje prezentację na piątek, trzeba też odnowić umowę z dostawcą internetu i zamówić nowe laptopy dla zespołu.
Streszczenie: Na zebraniu budżetowym zwiększono środki dla marketingu i rozdzielono zadania: prezentacja Kowalskiego na piątek, odnowienie umowy z dostawcą internetu oraz zakup laptopów.

Notatka: Pacjent zgłasza bóle głowy od tygodnia, nasilenie wieczorem, zalecam morfologię i kontrolę ciśnienia.
Streszczenie: Tygodniowe, wieczorne bóle głowy u pacjenta; zlecono morfologię i kontrolę ciśnienia.

Notatka: ${content}
Streszczenie:`

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

const stripModelArtifacts = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .replace(/^(tytuł|streszczenie)\s*[:\-]\s*/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
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
  const firstLine = stripModelArtifacts(raw).split('\n')[0] ?? ''
  const withoutBanned = stripBannedOpener(firstLine).replace(/[.!?]+$/g, '').trim()
  return firstWords(withoutBanned, 8)
}

// Fallback when the model hallucinates a title unrelated to the note
// (e.g. a tiny model copying a few-shot example): take the opening of the note.
const fallbackTitle = (content: string): string => {
  const firstSentence = content.split(/[.!?]/)[0] ?? content
  return firstWords(firstSentence.trim(), 6)
}

const cleanSummary = (raw: string): string => stripBannedOpener(stripModelArtifacts(raw))

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
  const lengthRatio = wordCountOf(summary) / Math.max(1, wordCountOf(content))
  return lengthRatio >= 0.7 && jaccard(summary, content) >= 0.6
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

const ensureModelReady = async (
  onProgress: (progress: ProcessingProgress) => void,
): Promise<void> => {
  if (!(await isModelDownloaded())) {
    onProgress({ phase: 'downloading', percent: 0 })
    await downloadModel((percent) => onProgress({ phase: 'downloading', percent }))
  }
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
      nPredict: 160,
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

  // Generate the title from the summary when available: the summary front-loads
  // the main topic, so the title reliably captures it instead of a side detail.
  const titleSource = summary.length > 0 ? summary : content
  onProgress({ phase: 'title' })
  const titleResult = await generate(titlePrompt(titleSource), () => undefined, {
    system: TITLE_SYSTEM,
    nPredict: 24,
  })
  const generatedTitle = cleanTitle(titleResult.text)
  const title =
    generatedTitle.length > 0 && !isUngrounded(generatedTitle, content)
      ? generatedTitle
      : fallbackTitle(titleSource)

  return { title, summary }
}
