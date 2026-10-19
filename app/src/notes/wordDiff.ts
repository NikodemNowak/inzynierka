export interface DiffSegment { readonly text: string; readonly added: boolean }

const normalize = (word: string): string =>
  word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Polish inflects heavily: "wyniki" and "wyników" share a five-letter stem.
const stem = (word: string): string => (word.length > 5 ? word.slice(0, 5) : word)

// Words of `next` that `current` never uses, grouped into runs for highlighting.
export const addedWords = (current: string, next: string): DiffSegment[] => {
  const known = new Set(current.split(/\s+/u).map(normalize).filter(Boolean).map(stem))
  const segments: DiffSegment[] = []
  for (const part of next.split(/(\s+)/u)) {
    if (!part) continue
    const word = normalize(part)
    const added = word ? !known.has(stem(word)) : segments.at(-1)?.added ?? false
    const last = segments.at(-1)
    if (last && last.added === added) segments[segments.length - 1] = { text: last.text + part, added }
    else segments.push({ text: part, added })
  }
  // Trailing spaces stay outside the highlight.
  const split = segments.flatMap((segment) => {
    const match = segment.added ? /^(.*?)(\s+)$/su.exec(segment.text) : null
    return match ? [{ text: match[1], added: true }, { text: match[2], added: false }] : [segment]
  })
  return split.reduce<DiffSegment[]>((merged, segment) => {
    const last = merged.at(-1)
    if (last && last.added === segment.added) merged[merged.length - 1] = { text: last.text + segment.text, added: last.added }
    else merged.push(segment)
    return merged
  }, [])
}
