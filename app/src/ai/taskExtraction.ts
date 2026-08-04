import { generate } from './llm'
import { ensureModelReady } from './noteProcessing'
import { parseTasks } from './noteOutput'
import { recordGeneration } from './generationMetrics'

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

export const extractTasks = async (
  content: string,
  onStatus: (status: string) => void,
): Promise<string[]> => {
  await ensureModelReady((progress) =>
    onStatus(`Ładowanie modelu: ${(progress.percent ?? 0).toFixed(0)}%`),
  )
  onStatus('Szukanie zadań…')
  const result = await generate(tasksPrompt(content), () => undefined, {
    system: TASKS_SYSTEM,
    nPredict: 200,
  })
  recordGeneration('tasks', content.length, result)
  return parseTasks(result.text)
}
