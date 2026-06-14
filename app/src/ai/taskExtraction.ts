import { generate } from './llm'
import { ensureModelReady } from './noteProcessing'

const TASKS_SYSTEM =
  'Wypisujesz konkretne zadania do zrobienia z polskich notatek. Odpowiadasz wyłącznie po polsku.'

const tasksPrompt = (content: string): string =>
  `/no_think
Wypisz zadania do zrobienia wynikające z poniższej notatki.
Zasady:
- Każde zadanie w osobnej linii, zaczynając od "- ".
- Krótka, konkretna czynność (czasownik + co), np. "- Przygotować aneks do umowy".
- Tylko realne zadania obecne w notatce. Jeśli nie ma żadnych, nie pisz nic.
- Bez numeracji, bez nagłówków, bez powtarzania notatki ani tych instrukcji.

Notatka:
"""
${content}
"""`

// The model returns a loose list; pull out one task per line, drop bullets,
// numbering and any leaked instruction/heading lines. Small models over-produce,
// so cap the count.
const parseTasks = (raw: string): string[] => {
  const cleaned = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
  return cleaned
    .split('\n')
    .map((line) => line.trim().replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(
      (line) =>
        line.length > 1 &&
        !/^(zasady|notatka|zadania|wypisz)\b/i.test(line) &&
        !line.includes('"""'),
    )
    .slice(0, 8)
}

export const extractTasks = async (
  content: string,
  onStatus: (status: string) => void,
): Promise<string[]> => {
  await ensureModelReady((progress) =>
    onStatus(
      progress.phase === 'downloading'
        ? `Pobieranie modelu: ${(progress.percent ?? 0).toFixed(0)}%`
        : `Ładowanie modelu: ${(progress.percent ?? 0).toFixed(0)}%`,
    ),
  )
  onStatus('Szukanie zadań…')
  const result = await generate(tasksPrompt(content), () => undefined, {
    system: TASKS_SYSTEM,
    nPredict: 200,
  })
  return parseTasks(result.text)
}
