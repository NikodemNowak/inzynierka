import { recordGeneration } from './generationMetrics'
import { generate } from './llm'
import { parseTags } from './noteOutput'

const TAGS_SYSTEM = 'Dobierasz kategorię tematyczną do treści notatki.'

const categoriesPrompt = (content: string): string =>
  `/no_think
Wybierz jedną kategorię najlepiej pasującą do głównego tematu tekstu:
Nauka — studia, edukacja, praca dyplomowa, badania.
Praca — obowiązki w pracy zawodowej, firma, klienci.
Finanse — pieniądze, rachunki, budżet.
Dom — obowiązki domowe, remont, mieszkanie.
Zdrowie — zdrowie, leczenie, samopoczucie.
Zakupy — lista zakupów, kupowanie produktów.
Podróże — wyjazdy, noclegi, trasy.
Pomysły — pomysły do rozwinięcia.
Jeśli żadna nie pasuje, wybierz brak. Podaj wyłącznie jedną nazwę, bez wyjaśnienia.

Tekst:
"""
${content}
"""`

// The shared model context must already be ready. Classification can run on its
// own, independently from title and summary generation.
export const classifyNoteCategories = async (
  content: string,
): Promise<string[]> => {
  const result = await generate(categoriesPrompt(content), () => undefined, {
    system: TAGS_SYSTEM,
    nPredict: 40,
  })
  recordGeneration('tags', content.length, result)
  // A primary category avoids speculative secondary labels. Some small models
  // repeat its definition after a dash; accept only the leading category name.
  const category = result.text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .trim()
    .split(/[\n:—–]/, 1)[0]
  return parseTags(category).slice(0, 1)
}
