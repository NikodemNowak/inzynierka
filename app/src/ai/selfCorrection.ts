// Backup to the model pass in spokenCorrections.ts: an explicit spoken cue
// ("do dermatologa, znaczy nie, do okulisty") resolved without a model call. The
// model's own check rejects some of these in unpunctuated text; this one acts only
// when the words after the cue name the same kind of thing as words just before it.
import type { Language } from '../i18n/language'

const CUE_PL = /(?<![\p{L}\d])(?:nie,?\s+czekaj|czekaj,?\s+nie|znaczy,?\s+nie|nie,?\s+sorry|sorry,?\s+nie|nie,?\s+przepraszam|przepraszam,?\s+nie|nie,?\s+pomyliłe[mś]\s+się|nie,?\s+wróć|nie,?\s+źle|nie(?:,?\s+nie)?)(?![\p{L}\d])[,:;]?\s*/giu
const WINDOW = 8
const VAGUE = new Set(['i', 'a', 'że', 'to', 'tak', 'no', 'bo', 'ale', 'jak', 'czy', 'się', 'nie', 'jest', 'mam', 'on', 'ona', 'oni', 'ja'])
const PREPOSITION_FORMS: Record<string, string> = { we: 'w', ze: 'z', ku: 'k', od: 'od', ode: 'od' }
const WEEKDAY = /^(?:poniedział\p{L}*|wtor\p{L}*|środ\p{L}*|czwart(?:ek|ku)|piąt(?:ek|ku)|sobot\p{L}*|niedziel\p{L}*)$/u
const ORDINAL = /^(?:pierwsz|drugi|trzeci|czwart|piąt|szóst|siódm|ósm|dziewiąt|dziesiąt|jedenast|dwunast|trzynast|czternast|piętnast|szesnast|siedemnast|osiemnast|dziewiętnast|dwudziest|trzydziest)\p{L}*$/u
const CARDINAL = /^(?:\d[\d:.,]*|jed(?:en|na|no)|dwa|dwie|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|\p{L}+naście|\p{L}+dzieści|\p{L}+dziesiąt|sto|dwieście|trzysta|czterysta|\p{L}+set|tysiąc\p{L}*|pół)$/u
type Kind = 'weekday' | 'ordinal' | 'cardinal' | null
const kindOf = (word: string): Kind => {
  if (WEEKDAY.test(word)) return 'weekday'
  if (ORDINAL.test(word)) return 'ordinal'
  if (CARDINAL.test(word)) return 'cardinal'
  return null
}
const normal = (word: string): string => {
  const lower = word.toLocaleLowerCase('pl')
  return PREPOSITION_FORMS[lower] ?? lower
}
type Word = { text: string; start: number }
const wordsOf = (text: string): Word[] => [...text.matchAll(/[\p{L}\d][\p{L}\d:.,'-]*[\p{L}\d]|[\p{L}\d]/gu)].map((m) => ({ text: m[0], start: m.index }))
const replacedStart = (before: string, first: string): number => {
  const sentence = Math.max(-1, ...[...before.matchAll(/[.!?\n](?=\s|$)/gu)].map((mark) => mark.index))
  const window = wordsOf(before.slice(sentence + 1)).slice(-WINDOW).map((word) => ({ ...word, start: word.start + sentence + 1 }))
  const target = normal(first)
  const same = window.filter((word) => normal(word.text) === target)
  if (same.length) return same[same.length - 1].start
  const kind = kindOf(target)
  if (!kind) return -1
  const similar = window.filter((word) => kindOf(normal(word.text)) === kind)
  return similar.length ? similar[similar.length - 1].start : -1
}
const PREPOSITIONS = new Set(['w', 'z', 'k', 'o', 'od', 'do', 'na', 'za', 'po', 'przy', 'dla', 'u', 'bez', 'przed', 'pod', 'nad', 'około', 'koło'])
const valueLength = (words: readonly string[], from: number): number => {
  let end = from
  while (end < words.length && kindOf(words[end]) !== null) end += 1
  return end - from
}
const keepNoun = (oldWords: readonly Word[], replacement: string): string => {
  const old = oldWords.map((word) => normal(word.text))
  const next = wordsOf(replacement)
  const nextWords = next.map((word) => normal(word.text))
  const oldAt = PREPOSITIONS.has(old[0] ?? '') ? 1 : 0
  const nextAt = PREPOSITIONS.has(nextWords[0] ?? '') ? 1 : 0
  const oldValue = valueLength(old, oldAt)
  const nextValue = valueLength(nextWords, nextAt)
  if (!oldValue || !nextValue) return replacement
  const noun = old[oldAt + oldValue]
  if (!noun || noun.length < 3 || PREPOSITIONS.has(noun) || VAGUE.has(noun)) return replacement
  const last = next[nextAt + nextValue - 1]
  const cut = last.start + last.text.length
  const following = nextWords[nextAt + nextValue]
  const closed = /^\s*[.,;:!?]/u.test(replacement.slice(cut))
  if (following && !closed && !PREPOSITIONS.has(following) && !VAGUE.has(following)) return replacement
  return `${replacement.slice(0, cut)} ${oldWords[oldAt + oldValue].text}${replacement.slice(cut)}`
}
const bareCue = (cue: string): boolean => /^nie(?:[,\s]+nie)?[,:;\s]*$/iu.test(cue)
const isNumber = (word: string | undefined): boolean => {
  const kind = word ? kindOf(normal(word)) : null
  return kind === 'cardinal' || kind === 'ordinal'
}
const numbersAround = (before: string, after: string): boolean => {
  const last = wordsOf(before).pop()?.text
  const next = wordsOf(after).slice(0, 2).map((word) => word.text)
  return isNumber(last) && (isNumber(next[0]) || (PREPOSITIONS.has(normal(next[0] ?? '')) && isNumber(next[1])))
}
const numberLength = (words: readonly string[]): number => {
  const end = words.findIndex((word) => kindOf(word) !== 'cardinal')
  return end === -1 ? words.length : end
}
export const resolveSelfCorrections = (text: string, language: Language): string => {
  if (language !== 'pl') return text
  let result = text
  let from = 0
  for (let round = 0; round < 20; round += 1) {
    CUE_PL.lastIndex = from
    const cue = CUE_PL.exec(result)
    if (!cue) break
    const before = result.slice(0, cue.index)
    const after = result.slice(cue.index + cue[0].length)
    const first = wordsOf(after)[0]?.text ?? ''
    const found = first && !VAGUE.has(first.toLocaleLowerCase('pl')) && (!bareCue(cue[0]) || numbersAround(before, after)) ? replacedStart(before, first) : -1
    const old = found < 0 ? [] : wordsOf(before.slice(found)).map((word) => normal(word.text))
    const next = wordsOf(after).map((word) => normal(word.text))
    const compared = Math.max(Math.min(2, old.length), numberLength(old), numberLength(next))
    const restated = old.length > 0 && old.slice(0, compared).every((word, index) => word === next[index])
    const start = restated ? -1 : found
    if (start < 0) {
      from = cue.index + cue[0].length
      continue
    }
    const head = before.slice(0, start)
    const replacement = /^\s*$|[.!?]\s*$/u.test(head) && /^\p{Lu}/u.test(before.slice(start)) ? after.charAt(0).toLocaleUpperCase('pl') + after.slice(1) : after
    result = head + keepNoun(wordsOf(before.slice(start)), replacement)
    from = start
  }
  return result
}
