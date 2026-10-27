export interface DiffSegment { readonly text: string; readonly added: boolean }

const normalize = (word: string): string =>
  word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Polish inflects heavily: "wyniki" and "wyników" share a five-letter stem.
const stem = (word: string): string => (word.length > 5 ? word.slice(0, 5) : word)

// Words of `next` that `current` never uses, grouped into runs for highlighting.
export const addedWords = (current: string, next: string): DiffSegment[] => {
  const known = new Set(current.split(/\s+/u).map(normalize).filter(Boolean).map(stem))
  const parts = next.split(/(\s+)/u).filter(Boolean)
  // Short words ("i", "z", "w") say nothing new on their own: they join a highlight
  // only when the words on both sides are new.
  const flags = parts.map((part): boolean | null => {
    const word = normalize(part)
    return word.length > 2 ? !known.has(stem(word)) : null
  })
  const near = (from: number, step: number): boolean => {
    for (let index = from + step; index >= 0 && index < flags.length; index += step) {
      const flag = flags[index]
      if (flag !== null) return flag
    }
    return false
  }
  const segments: DiffSegment[] = []
  for (const [index, part] of parts.entries()) {
    const flag = flags[index]
    const added = flag ?? (near(index, -1) && near(index, 1))
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
