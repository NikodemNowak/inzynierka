import { evaluateBenchmarkAudioQuality } from './benchmarkAudioQuality'
import { ENGLISH_AUDIO_FIXTURE_DATA } from './benchmarkAudioFixturesData'

const reference =
  "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was one thousand two hundred dollars. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning. The workshop materials, the supplier's reply, and the updated schedule are the topics for that meeting."

test.each([
  ['', '', { substitutions: 0, deletions: 0, insertions: 0 }],
  ['', 'a b', { substitutions: 0, deletions: 0, insertions: 2 }],
  ['a b', '', { substitutions: 0, deletions: 2, insertions: 0 }],
  ['a b', 'b a', { substitutions: 2, deletions: 0, insertions: 0 }],
  ['a b c', 'b c a', { substitutions: 0, deletions: 1, insertions: 1 }],
  ['a a b', 'a b b', { substitutions: 1, deletions: 0, insertions: 0 }],
  ['a b a b', 'a b', { substitutions: 0, deletions: 2, insertions: 0 }],
])('preserves edit counts and substitution-first ties for %j / %j', (expected, actual, edits) => {
  expect(evaluateBenchmarkAudioQuality(expected, actual)).toMatchObject(edits)
})

test('preserves a changed owner after a long unchanged prefix and suffix', () => {
  const padding = 'ordinary background '.repeat(600)
  const result = evaluateBenchmarkAudioQuality(
    `${padding}Alice will prepare the outline.${padding}`,
    `${padding}Daniel will prepare the outline.${padding}`,
  )
  expect(result).toMatchObject({ substitutions: 1, deletions: 0, insertions: 0 })
  expect(result.wordErrorRate).toBe(1 / result.normalizedReferenceWords)
})

test('replays the physical final-utterance-only result as a lexical completeness failure', () => {
  const actual =
    'The workshop materials, the suppliers reply, and the updated schedule are the topics for that meeting'
  expect(evaluateBenchmarkAudioQuality(reference, actual)).toEqual({
    method: 'synthetic-reference-word-error-v1',
    rawReferenceWords: 124,
    rawTranscriptWords: 16,
    normalizedReferenceWords: 124,
    normalizedTranscriptWords: 16,
    substitutions: 0,
    deletions: 108,
    insertions: 0,
    wordErrorRate: 108 / 124,
    wordRatio: 16 / 124,
    maximumWordErrorRate: 0.15,
    minimumWordRatio: 0.8,
    reviewRequired: true,
  })
})

test('tolerates punctuation and case while never treating a passing score as semantic proof', () => {
  const result = evaluateBenchmarkAudioQuality(
    reference,
    reference.toUpperCase().replace(/[.,:]/g, ''),
  )
  expect(result).toMatchObject({
    wordErrorRate: 0,
    wordRatio: 1,
    reviewRequired: false,
    method: 'synthetic-reference-word-error-v1',
  })
})

test.each(['1200', '1,200', 'twelve hundred', 'one thousand two hundred'])(
  'canonicalizes only the declared 1200 spoken form: %s',
  (form) => {
    const result = evaluateBenchmarkAudioQuality(
      reference,
      reference.replace('one thousand two hundred', form),
    )
    expect(result).toMatchObject({
      wordErrorRate: 0,
      wordRatio: 1,
      reviewRequired: false,
    })
  },
)

test.each([
  '1750',
  '1,750',
  'seventeen fifty',
  'one thousand seven hundred and fifty',
  'one thousand seven hundred fifty',
])('canonicalizes only the declared 1750 spoken form: %s', (form) => {
  const result = evaluateBenchmarkAudioQuality(
    reference,
    reference.replace('one thousand seven hundred fifty', form),
  )
  expect(result).toMatchObject({
    wordErrorRate: 0,
    wordRatio: 1,
    reviewRequired: false,
  })
})

test.each(['October 12', 'October 12th', 'October the twelfth'])(
  'canonicalizes the declared October date form: %s',
  (form) => {
    const result = evaluateBenchmarkAudioQuality(
      reference,
      reference.replace('October twelfth', form),
    )
    expect(result).toMatchObject({
      wordErrorRate: 0,
      wordRatio: 1,
      reviewRequired: false,
    })
  },
)

test.each([
  '10 AM',
  '10 a.m.',
  'ten AM',
  '10:00 AM',
  'ten oclock in the morning',
  "ten o'clock in the morning",
])('canonicalizes the declared morning time form: %s', (form) => {
  const result = evaluateBenchmarkAudioQuality(
    reference,
    reference.replace('ten in the morning', form),
  )
  expect(result).toMatchObject({
    wordErrorRate: 0,
    wordRatio: 1,
    reviewRequired: false,
  })
})

test.each([
  [
    'We must not buy new hardware.',
    'We must buy new hardware.',
    { deletions: 1, substitutions: 0, insertions: 0 },
  ],
  [
    'Alice will send the schedule.',
    'Emma will send the schedule.',
    { deletions: 0, substitutions: 1, insertions: 0 },
  ],
  [
    'The final budget is 1750 dollars.',
    'The final budget is 1200 dollars.',
    { deletions: 1, substitutions: 1, insertions: 0 },
  ],
  [
    'Send the report by Friday.',
    'Send the report by Monday.',
    { deletions: 0, substitutions: 1, insertions: 0 },
  ],
])(
  'never canonicalizes a changed owner, polarity, amount or deadline: %s',
  (expected, actual, edits) => {
    const result = evaluateBenchmarkAudioQuality(expected, actual)
    expect(result).toMatchObject(edits)
    expect(result.wordErrorRate).toBeGreaterThan(0)
    expect(result.reviewRequired).toBe(true)
  },
)

test('counts repeated extra speech as insertions even when all reference words are present', () => {
  const result = evaluateBenchmarkAudioQuality(
    'Alice will send the report.',
    'Alice will send the report. Alice will send the report.',
  )
  expect(result).toMatchObject({
    substitutions: 0,
    deletions: 0,
    insertions: 5,
    wordErrorRate: 1,
    wordRatio: 2,
    reviewRequired: true,
  })
})

test.each(['', '   '])('cannot accept an absent reference: %p', (expected) => {
  expect(
    evaluateBenchmarkAudioQuality(expected, 'Actual speech.'),
  ).toMatchObject({
    normalizedReferenceWords: 0,
    wordErrorRate: null,
    wordRatio: null,
    reviewRequired: true,
  })
})

const riversideId = 'en-audio-3min-v1'
const riverside = ENGLISH_AUDIO_FIXTURE_DATA[riversideId].referenceTranscript
const actualRiversideAsr = "These are the planning notes for the Riverside community podcast. The project is a series of short conversations about local places every day experiences and the people who live in the neighborhood my will prepare the first episode outline by Thursday. The opening episode is about the Riverside Park and the old railway Bridge. We discussed the atmosphere of the program in the balance between interviews and background information. The examples from last year were useful because they showed the difference between a clear story and a collection of unrelated facts. Daniel will contact the guest speaker by Tuesday. The speaker is a local historian who has already taken part in several community events. The contact details were checked during the previous meeting. Our discussion included the history of the bridge, the walking roots near the river and the names of the older streets. Those topics were examples of possible conversation subjects rather than a final running. Order the program is intended for residence with different levels of historical knowledge. A short explanation of each place is more useful than a long list of dates. The original production budget was $900. This amount appeared in the early draft of the project plan the old draft also contained a description of a larger camera set up, but that description is background information from an earlier discussion. There were different opinions about the visual style. Some people preferred photographs, while others described a simple map. Neither option was confirmed during this meeting. The emphasis of the discussion was clear sound in a conversation that listeners can follow easily. Nora will send the updated guest list to Maya before Wednesday the list contains the speaker names and the topics associated with each person. We talked about the opening music and the examples of sound recorded near the river. These examples were. Already available in the archive the discussion did not establish another deadline or assign another person. The earlier equipment comparison was also completed and it's results were included in the background documents. Correction the final approved production budget is $1450. This final amount replaces the earlier budget of $900. The north studio reservation was canceled so we must use the south studio for the recording. We will use the microphones that we already have and we must not buy any new cameras. The next editorial review is on November 8 at two in the afternoon the episode outline the speaker reply and the updated guest list are the topics for that review"

test('flags the exact physical 420-word Maya-to-my loss despite 3.8 percent word error', () => {
  const result = evaluateBenchmarkAudioQuality(riverside, actualRiversideAsr, riversideId)
  expect(result).toMatchObject({
    rawReferenceWords: 421, rawTranscriptWords: 420,
    wordErrorRate: 16 / 421, reviewRequired: true,
    criticalFacts: { method: 'riverside-critical-phrases-v1', required: 8, preserved: 7, missing: ['maya_outline_thursday'] },
  })
  expect(evaluateBenchmarkAudioQuality(riverside, actualRiversideAsr).reviewRequired).toBe(false)
})

test.each(['en-audio-3min-v1', 'en-audio-10min-v1', 'en-audio-30min-v1'] as const)(
  'finds every complete critical phrase in canonical registered %s reference', (id) => {
    const source = ENGLISH_AUDIO_FIXTURE_DATA[id].referenceTranscript
    expect(evaluateBenchmarkAudioQuality(source, source, id)).toMatchObject({
      reviewRequired: false,
      criticalFacts: { method: 'riverside-critical-phrases-v1', required: 8, preserved: 8, missing: [] },
    })
  },
)

test.each([
  (source: string) => source.toUpperCase().replace(/[.,:]/gu, ''),
  (source: string) => source.replace(/1450 dollars/gu, '$1450').replace(/900 dollars/gu, '$900').replace('November 8', 'November eighth').replace('at 2 in the afternoon', 'at two in the afternoon'),
  (source: string) => source.replace(/1450/gu, 'one thousand four hundred fifty').replace(/900/gu, 'nine hundred').replace('November 8', 'November the eighth'),
])('recognizes only declared number, case and punctuation equivalents for full linked phrases %#', (change) => {
  expect(evaluateBenchmarkAudioQuality(riverside, change(riverside), riversideId)).toMatchObject({
    reviewRequired: false, criticalFacts: { preserved: 8, missing: [] },
  })
})

test.each([
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'my will prepare the first episode outline by Thursday.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'Maya will not prepare the first episode outline by Thursday.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'Maya will prepare the first episode outline by Friday.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'Nora will prepare the first episode outline by Thursday. Maya appears elsewhere.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'Nora said Maya will prepare the first episode outline by Thursday.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', '"Maya will prepare the first episode outline by Thursday."'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', "'Maya will prepare the first episode outline by Thursday.'"],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', '‘Maya will prepare the first episode outline by Thursday.’'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'If approved Maya will prepare the first episode outline by Thursday.'],
  ['maya_outline_thursday', 'Maya will prepare the first episode outline by Thursday.', 'Maya will prepare the first episode outline by Thursday?'],
  ['daniel_speaker_tuesday', 'Daniel will contact the guest speaker by Tuesday.', 'Daniel will contact the guest speaker by Thursday.'],
  ['nora_guestlist_maya_wednesday', 'Nora will send the updated guest list to Maya before Wednesday.', 'Nora will send the updated guest list to Daniel before Wednesday.'],
  ['studio_replacement', 'The north studio reservation was canceled so we must use the south studio for the recording.', 'The north studio reservation was canceled so we must not use the south studio for the recording.'],
  ['studio_replacement', 'The north studio reservation was canceled so we must use the south studio for the recording.', 'The south studio reservation was canceled so we must use the north studio for the recording.'],
  ['final_budget_replacement', 'final approved production budget is 1450 dollars', 'final approved production budget is 1400 dollars'],
  ['final_budget_replacement', 'replaces the earlier budget of 900 dollars', 'replaces the earlier budget of 950 dollars'],
  ['final_budget_replacement', 'replaces the earlier budget of 900 dollars', 'does not replace the earlier budget of 900 dollars'],
  ['final_budget_replacement', '1450 dollars', '1450 euros'],
  ['final_budget_replacement', '1450 dollars', '€1450'],
  ['final_budget_replacement', '1450 dollars', '£1450'],
  ['final_budget_replacement', 'replaces the earlier budget of 900 dollars', 'replaces the earlier budget of 900 euros'],
  ['final_budget_replacement', 'replaces the earlier budget of 900 dollars', 'replaces the earlier budget of €900'],
  ['existing_microphones_no_cameras', 'we must not buy any new cameras', 'we must buy any new cameras'],
  ['existing_microphones_no_cameras', 'microphones that we already have', 'microphones that we do not already have'],
  ['editorial_review_date_time', 'November 8', 'November 9'],
  ['editorial_review_date_time', 'at 2 in the afternoon', 'at 3 in the afternoon'],
  ['editorial_review_date_time', 'at 2 in the afternoon', 'at 2 in the morning'],
])('flags a changed complete signature %s: %s', (id, original, replacement) => {
  const result = evaluateBenchmarkAudioQuality(riverside, riverside.replace(original, replacement), riversideId)
  expect(result.wordErrorRate).toBeLessThan(0.15)
  expect(result).toMatchObject({ reviewRequired: true, criticalFacts: { required: 8, preserved: 7, missing: [id] } })
})

test.each([undefined, 'custom-audio', 'en-audio-smoke-v6'])(
  'keeps old two-argument and unregistered diagnostics without critical facts: %p', (id) => {
    expect(evaluateBenchmarkAudioQuality(riverside, actualRiversideAsr, id)).not.toHaveProperty('criticalFacts')
    expect(evaluateBenchmarkAudioQuality(riverside, actualRiversideAsr, id).reviewRequired).toBe(false)
  },
)

test('does not impose registered critical facts on a custom reference without all eight signatures', () => {
  const reference = riverside.replace('Maya will prepare the first episode outline by Thursday.', 'The first outline was discussed without an assignment.')
  const result = evaluateBenchmarkAudioQuality(reference, reference, riversideId)
  expect(result).not.toHaveProperty('criticalFacts')
  expect(result.reviewRequired).toBe(false)
})
