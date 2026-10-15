import type { BenchmarkAudioCompleteness } from './benchmarkTypes'

const rawWordCount = (text: string): number =>
  text.trim().split(/\s+/u).filter(Boolean).length

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? []

// Numeric equivalences are limited to the published synthetic fixture oracle.
// Do not normalize owners, deadlines, room names, polarity or other amounts.
const normalizedWords = (text: string): string[] =>
  words(
    text
      .toLowerCase()
      .replace(/\b(?:1,?200|twelve hundred)\b/gu, 'one thousand two hundred')
      .replace(
        /\b(?:1,?750|seventeen fifty|one thousand seven hundred and fifty)\b/gu,
        'one thousand seven hundred fifty',
      )
      .replace(/\boctober (?:12(?:th)?|the twelfth)\b/gu, 'october twelfth')
      .replace(
        /\b(?:10(?::00)?|ten)\s+a\.?\s*m\.?(?!\p{L})/gu,
        'ten in the morning',
      )
      .replace(/\bten o['’]?clock in the morning\b/gu, 'ten in the morning'),
  )

interface Edits {
  substitutions: number
  deletions: number
  insertions: number
}

const editCount = (edits: Edits): number =>
  edits.substitutions + edits.deletions + edits.insertions

const fullWordEdits = (
  reference: readonly string[],
  transcript: readonly string[],
): Edits => {
  const width = transcript.length + 1
  // Reuse two numeric rows. A long fixture visits millions of cells; avoid
  // creating three edit objects and an array for each mismatch on the JS thread.
  let previousSubstitutions = new Uint32Array(width)
  let previousDeletions = new Uint32Array(width)
  let previousInsertions = new Uint32Array(width)
  let currentSubstitutions = new Uint32Array(width)
  let currentDeletions = new Uint32Array(width)
  let currentInsertions = new Uint32Array(width)
  for (let index = 0; index < width; index++) previousInsertions[index] = index
  for (
    let referenceIndex = 0;
    referenceIndex < reference.length;
    referenceIndex++
  ) {
    currentSubstitutions[0] = 0
    currentDeletions[0] = referenceIndex + 1
    currentInsertions[0] = 0
    const referenceWord = reference[referenceIndex]
    for (
      let transcriptIndex = 0;
      transcriptIndex < transcript.length;
      transcriptIndex++
    ) {
      const column = transcriptIndex + 1
      if (referenceWord === transcript[transcriptIndex]) {
        currentSubstitutions[column] = previousSubstitutions[transcriptIndex]
        currentDeletions[column] = previousDeletions[transcriptIndex]
        currentInsertions[column] = previousInsertions[transcriptIndex]
        continue
      }
      let substitutions = previousSubstitutions[transcriptIndex] + 1
      let deletions = previousDeletions[transcriptIndex]
      let insertions = previousInsertions[transcriptIndex]
      let bestCount = substitutions + deletions + insertions
      const deletionCount = previousSubstitutions[column] +
        previousDeletions[column] + previousInsertions[column] + 1
      const insertionCount = currentSubstitutions[transcriptIndex] +
        currentDeletions[transcriptIndex] + currentInsertions[transcriptIndex] + 1
      // Keep the historical substitution, deletion, insertion tie order.
      if (deletionCount < bestCount) {
        substitutions = previousSubstitutions[column]
        deletions = previousDeletions[column] + 1
        insertions = previousInsertions[column]
        bestCount = deletionCount
      }
      if (insertionCount < bestCount) {
        substitutions = currentSubstitutions[transcriptIndex]
        deletions = currentDeletions[transcriptIndex]
        insertions = currentInsertions[transcriptIndex] + 1
      }
      currentSubstitutions[column] = substitutions
      currentDeletions[column] = deletions
      currentInsertions[column] = insertions
    }
    const oldSubstitutions = previousSubstitutions
    const oldDeletions = previousDeletions
    const oldInsertions = previousInsertions
    previousSubstitutions = currentSubstitutions
    previousDeletions = currentDeletions
    previousInsertions = currentInsertions
    currentSubstitutions = oldSubstitutions
    currentDeletions = oldDeletions
    currentInsertions = oldInsertions
  }
  return {
    substitutions: previousSubstitutions[transcript.length],
    deletions: previousDeletions[transcript.length],
    insertions: previousInsertions[transcript.length],
  }
}

const bandedWordEdits = (
  reference: readonly string[],
  transcript: readonly string[],
  band: number,
): Edits | null => {
  const width = transcript.length + 1
  // Every valid edit distance is at most the longer input. Outside-band
  // predecessors must cost more, never the stale value from a reused row.
  const unreachable = Math.max(reference.length, transcript.length) + 1
  let previousSubstitutions = new Uint32Array(width).fill(unreachable)
  let previousDeletions = new Uint32Array(width)
  let previousInsertions = new Uint32Array(width)
  let currentSubstitutions = new Uint32Array(width).fill(unreachable)
  let currentDeletions = new Uint32Array(width)
  let currentInsertions = new Uint32Array(width)
  for (let column = 0; column <= Math.min(transcript.length, band); column++) {
    previousSubstitutions[column] = 0
    previousInsertions[column] = column
  }
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex++) {
    const row = referenceIndex + 1
    const firstColumn = Math.max(1, row - band)
    const lastColumn = Math.min(transcript.length, row + band)
    currentSubstitutions[0] = row <= band ? 0 : unreachable
    currentDeletions[0] = row <= band ? row : 0
    currentInsertions[0] = 0
    let rowMinimum = row <= band ? row : unreachable
    if (firstColumn > 1) {
      currentSubstitutions[firstColumn - 1] = unreachable
      currentDeletions[firstColumn - 1] = 0
      currentInsertions[firstColumn - 1] = 0
    }
    const referenceWord = reference[referenceIndex]
    for (let transcriptIndex = firstColumn - 1; transcriptIndex < lastColumn; transcriptIndex++) {
      const column = transcriptIndex + 1
      if (referenceWord === transcript[transcriptIndex]) {
        const substitutions = previousSubstitutions[transcriptIndex]
        const deletions = previousDeletions[transcriptIndex]
        const insertions = previousInsertions[transcriptIndex]
        currentSubstitutions[column] = substitutions
        currentDeletions[column] = deletions
        currentInsertions[column] = insertions
        const count = substitutions + deletions + insertions
        if (count < rowMinimum) rowMinimum = count
        continue
      }
      let substitutions = previousSubstitutions[transcriptIndex] + 1
      let deletions = previousDeletions[transcriptIndex]
      let insertions = previousInsertions[transcriptIndex]
      let bestCount = substitutions + deletions + insertions
      const deletionCount = previousSubstitutions[column] +
        previousDeletions[column] + previousInsertions[column] + 1
      const insertionCount = currentSubstitutions[transcriptIndex] +
        currentDeletions[transcriptIndex] + currentInsertions[transcriptIndex] + 1
      // Exactly the full matrix's substitution, deletion, insertion tie order.
      if (deletionCount < bestCount) {
        substitutions = previousSubstitutions[column]
        deletions = previousDeletions[column] + 1
        insertions = previousInsertions[column]
        bestCount = deletionCount
      }
      if (insertionCount < bestCount) {
        substitutions = currentSubstitutions[transcriptIndex]
        deletions = currentDeletions[transcriptIndex]
        insertions = currentInsertions[transcriptIndex] + 1
      }
      currentSubstitutions[column] = substitutions
      currentDeletions[column] = deletions
      currentInsertions[column] = insertions
      const count = substitutions + deletions + insertions
      if (count < rowMinimum) rowMinimum = count
    }
    // Every terminal path crosses this row, and edit costs never decrease
    // along a path. No distance <= band can exist if all row prefixes exceed it.
    if (rowMinimum > band) return null
    if (lastColumn < transcript.length) {
      currentSubstitutions[lastColumn + 1] = unreachable
      currentDeletions[lastColumn + 1] = 0
      currentInsertions[lastColumn + 1] = 0
    }
    const oldSubstitutions = previousSubstitutions
    const oldDeletions = previousDeletions
    const oldInsertions = previousInsertions
    previousSubstitutions = currentSubstitutions
    previousDeletions = currentDeletions
    previousInsertions = currentInsertions
    currentSubstitutions = oldSubstitutions
    currentDeletions = oldDeletions
    currentInsertions = oldInsertions
  }
  const edits = {
    substitutions: previousSubstitutions[transcript.length],
    deletions: previousDeletions[transcript.length],
    insertions: previousInsertions[transcript.length],
  }
  // A path with at most band edits cannot ever leave |row-column| <= band:
  // leaving requires at least band+1 insertions/deletions. Thus every optimum
  // path (including the historical tie choice) fits when this condition holds.
  return editCount(edits) <= band ? edits : null
}

const wordEdits = (
  reference: readonly string[],
  transcript: readonly string[],
): Edits => {
  let band = Math.max(16, Math.abs(reference.length - transcript.length))
  // Small inputs and high edit distances keep the unchanged full matrix.
  // Stop widening before retries spend more work than a full comparison.
  const maximumBand = Math.max(reference.length, transcript.length) / 8
  while (band < maximumBand) {
    const edits = bandedWordEdits(reference, transcript, band)
    if (edits) return edits
    band *= 2
  }
  return fullWordEdits(reference, transcript)
}

// These linked phrases are an explicitly registered synthetic-audio oracle.
// They never repair source text or approve general note/task semantics.
const RIVERSIDE_FIXTURE_IDS: ReadonlySet<string> = new Set([
  'en-audio-3min-v1', 'en-audio-10min-v1', 'en-audio-30min-v1',
])

const criticalPhraseText = (text: string): string => text.toLowerCase()
  .replace(/\b(?:1,?450|one thousand four hundred fifty)\b/gu, '1450')
  .replace(/\b(?:900|nine hundred)\b/gu, '900')
  .replace(/\bnovember (?:the )?(?:8(?:th)?|eighth)\b/gu, 'november 8')
  .replace(/\b(?:2|two) in the afternoon\b/gu, '2 in the afternoon')
  .replace(/\bcancelled\b/gu, 'canceled')
  .replace(/(\p{L})['’](?=\p{L})/gu, '$1')
  .replace(/\$/gu, ' ')
  .replace(/[^\p{L}\p{N}\p{Sc}.!?;"“”«»'‘’]+/gu, ' ')
  .replace(/\s+/gu, ' ').trim()

const RIVERSIDE_SIGNATURES: readonly { id: string; phrase: string }[] = [
  { id: 'riverside_context', phrase: 'riverside community podcast' },
  { id: 'maya_outline_thursday', phrase: 'maya will prepare the first episode outline by thursday' },
  { id: 'daniel_speaker_tuesday', phrase: 'daniel will contact the guest speaker by tuesday' },
  { id: 'nora_guestlist_maya_wednesday', phrase: 'nora will send the updated guest list to maya before wednesday' },
  { id: 'studio_replacement', phrase: 'the north studio reservation was canceled so we must use the south studio for the recording' },
  { id: 'final_budget_replacement', phrase: 'the final approved production budget is 1450(?: dollars)?[. ]+this final amount replaces the earlier budget of 900(?: dollars)?(?! ?\\p{Sc}| (?:euros?|pounds?|eur|gbp|pln))' },
  { id: 'existing_microphones_no_cameras', phrase: 'we will use the microphones that we already have and we must not buy any new cameras' },
  { id: 'editorial_review_date_time', phrase: 'the next editorial review is on november 8 at 2 in the afternoon' },
]

const hasCriticalPhrase = (text: string, phrase: string): boolean => {
  for (const match of text.matchAll(new RegExp(`\\b${phrase}\\b`, 'gu'))) {
    const end = match.index + match[0].length
    const preceding = text.slice(0, match.index)
    const prefix = preceding.slice(Math.max(preceding.lastIndexOf('.'), preceding.lastIndexOf('!'), preceding.lastIndexOf('?'), preceding.lastIndexOf(';')) + 1)
    const following = text.slice(end)
    const boundary = following.match(/[.!?;]/u)
    const suffix = following.slice(0, boundary?.index ?? following.length)
    if (boundary?.[0] === '?' || /["“”«»'‘’]/u.test(prefix + suffix) ||
      /\b(?:not|never|no|cant|cannot|not true(?: that)?|if(?: approved| possible)?|unless(?: approved| possible)?|whether|maybe|possibly|hypothetical|said(?: that)?|says(?: that)?|reported(?: that)?|asked(?: whether)?|denied(?: that)?)\s*$/u.test(prefix) ||
      /^\s*(?:not|never|no|or|unless|if)\b/u.test(suffix)) continue
    return true
  }
  return false
}

const criticalFacts = (
  reference: string, transcript: string, fixtureId?: string,
): BenchmarkAudioCompleteness['criticalFacts'] => {
  if (!fixtureId || !RIVERSIDE_FIXTURE_IDS.has(fixtureId)) return undefined
  const expected = criticalPhraseText(reference)
  if (!RIVERSIDE_SIGNATURES.every(({ phrase }) => hasCriticalPhrase(expected, phrase))) return undefined
  const actual = criticalPhraseText(transcript)
  const missing = RIVERSIDE_SIGNATURES.filter(({ phrase }) => !hasCriticalPhrase(actual, phrase)).map(({ id }) => id)
  return { method: 'riverside-critical-phrases-v1', required: 8, preserved: 8 - missing.length, missing }
}

// A prerequisite diagnostic for this synthetic fixture, never general STT or
// semantic acceptance. The oracle's WER ceiling is explicit in the saved row.
export const evaluateBenchmarkAudioQuality = (
  reference: string,
  transcript: string,
  fixtureId?: string,
): BenchmarkAudioCompleteness => {
  const referenceWords = normalizedWords(reference)
  const transcriptWords = normalizedWords(transcript)
  const edits = wordEdits(referenceWords, transcriptWords)
  const wordErrorRate = referenceWords.length
    ? editCount(edits) / referenceWords.length
    : null
  const wordRatio = referenceWords.length
    ? transcriptWords.length / referenceWords.length
    : null
  const facts = criticalFacts(reference, transcript, fixtureId)
  return {
    method: 'synthetic-reference-word-error-v1',
    rawReferenceWords: rawWordCount(reference),
    rawTranscriptWords: rawWordCount(transcript),
    normalizedReferenceWords: referenceWords.length,
    normalizedTranscriptWords: transcriptWords.length,
    ...edits,
    wordErrorRate,
    wordRatio,
    maximumWordErrorRate: 0.15,
    minimumWordRatio: 0.8,
    ...(facts ? { criticalFacts: facts } : {}),
    reviewRequired:
      !!facts?.missing.length ||
      wordErrorRate === null ||
      wordErrorRate > 0.15 ||
      wordRatio === null ||
      wordRatio < 0.8,
  }
}
