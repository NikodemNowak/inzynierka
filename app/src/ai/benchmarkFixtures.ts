import type { Language } from '../i18n/language'
import { File, Paths } from 'expo-file-system'
import { Asset } from 'expo-asset'
import type { BenchmarkAudioFixture } from './benchmarkTypes'
import { GenerationCancelledError } from './llm'
import { ENGLISH_AUDIO_FIXTURE_DATA } from './benchmarkAudioFixturesData'

export type BenchmarkAudioFixtureId = keyof typeof ENGLISH_AUDIO_FIXTURE_DATA
export const BENCHMARK_AUDIO_FIXTURES = [
  { id: 'en-audio-3min-v1', ...ENGLISH_AUDIO_FIXTURE_DATA['en-audio-3min-v1'] },
  { id: 'en-audio-10min-v1', ...ENGLISH_AUDIO_FIXTURE_DATA['en-audio-10min-v1'] },
  { id: 'en-audio-30min-v1', ...ENGLISH_AUDIO_FIXTURE_DATA['en-audio-30min-v1'] },
] as const

const audioModule = (id: BenchmarkAudioFixtureId): number => {
  switch (id) {
    case 'en-audio-3min-v1': return require('../../assets/benchmarks/english-3min.wav')
    case 'en-audio-10min-v1': return require('../../assets/benchmarks/english-10min.wav')
    case 'en-audio-30min-v1': return require('../../assets/benchmarks/english-30min.wav')
  }
}
const ensureFixtureActive = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new GenerationCancelledError()
}
const localAudioFile = (uri: string | null): boolean => {
  if (!uri?.startsWith('file://')) return false
  const file = new File(uri)
  return file.exists && file.size > 0
}

// A bundle URI or existing local cache is required before invoking Expo's
// resolver. Remote-only assets are rejected, including in development.
export const prepareEnglishBenchmarkAudioFixture = async (
  id: BenchmarkAudioFixtureId, signal?: AbortSignal,
): Promise<BenchmarkAudioFixture> => {
  ensureFixtureActive(signal)
  const descriptor = ENGLISH_AUDIO_FIXTURE_DATA[id]
  if (!descriptor) throw new Error('Unknown bundled audio fixture')
  const asset = Asset.fromModule(audioModule(id))
  ensureFixtureActive(signal)
  let uri = asset.localUri
  if (!localAudioFile(uri)) {
    if (!asset.uri.startsWith('file://')) throw new Error('Bundled benchmark audio is not available offline as a local file')
    if (!localAudioFile(asset.uri)) throw new Error('Bundled benchmark audio file is missing or empty')
    // A removed cache must not cause downloadAsync to return its stale URI.
    asset.downloaded = false
    await asset.downloadAsync()
    ensureFixtureActive(signal)
    uri = asset.localUri
  }
  if (!localAudioFile(uri)) throw new Error('Prepared benchmark audio file is missing or empty')
  ensureFixtureActive(signal)
  return { uri: uri!, locale: 'en-US', referenceTranscript: descriptor.referenceTranscript,
    provenance: 'synthetic-audio', expectedDurationMs: descriptor.durationMs,
    audioSha256: descriptor.sha256, bundled: true }
}

export const ENGLISH_AUDIO_REFERENCE =
  "These are the final notes for the October workshop. Alice will prepare the workshop materials by Friday. Bob will contact the supplier by Tuesday. Emma will send the updated schedule to Alice before Wednesday. The original budget was one thousand two hundred dollars. Correction: the final approved budget is one thousand seven hundred fifty dollars. This final amount replaces the earlier budget. The red room reservation was cancelled, so we must use the green room for the workshop. We will use the equipment that we already have, and we must not buy any new hardware. The next planning meeting is on October twelfth at ten in the morning. The workshop materials, the supplier's reply, and the updated schedule are the topics for that meeting."

export const makeEnglishBenchmarkAudioFixture = (): BenchmarkAudioFixture => ({
  uri: new File(Paths.document, 'TestAudio', 'benchmark-en-smoke-v6.wav').uri,
  locale: 'en-US',
  referenceTranscript: ENGLISH_AUDIO_REFERENCE,
  provenance: 'synthetic-audio',
})

export type BenchmarkFixtureId =
  | 'smoke'
  | '5-min-text'
  | '15-min-text'
  | '30-min-text'
export interface BenchmarkFixture {
  id: BenchmarkFixtureId
  language: Language
  source: string
  provenance: 'synthetic-text'
  nominalMinutes: number | null
  wordCount: number
}
export const makeBenchmarkFixture = (
  id: BenchmarkFixtureId,
  language: Language,
): BenchmarkFixture => {
  const minutes =
    id === 'smoke'
      ? null
      : id === '5-min-text'
        ? 5
        : id === '15-min-text'
          ? 15
          : 30
  const opening =
    language === 'pl'
      ? 'Notatka ze spotkania zespołu biblioteki. Rozmawialiśmy o jesiennych warsztatach, rezerwacji sal i poprawie informacji dla czytelników. Zdecydowaliśmy, że Marta przygotuje listę materiałów do piątku, a Piotr zadzwoni do prowadzącego we wtorek. Budżet pierwszych warsztatów wynosi 1200 złotych. Nie zamówimy nowych laptopów, ponieważ obecny sprzęt wystarczy. Spotkanie podsumowujące odbędzie się 12 października o godzinie 10:00. Nie ustaliliśmy jeszcze liczby uczestników. Sprawdzę dostępność większej sali przed wysłaniem zaproszeń.'
      : 'Notes from the library team meeting. We discussed autumn workshops, room bookings and clearer information for readers. Marta will prepare the materials list by Friday, and Piotr will call the instructor on Tuesday. The budget for the first workshop is 1200 zloty. We will not buy new laptops because the current equipment is sufficient. The review meeting is on October 12 at 10:00. We have not decided the number of participants yet. I will check the larger room before sending invitations.'
  const ending =
    language === 'pl'
      ? 'Na zakończenie uzgodniliśmy, że trzeba wysłać poprawiony harmonogram do Anny przed środą. Rezerwacja sali czerwonej została anulowana, więc należy użyć sali zielonej. Kwota końcowa wynosi 1750 złotych i zastępuje wcześniejszy budżet 1200 złotych.'
      : 'Finally, we agreed to send the corrected schedule to Anna before Wednesday. The red room booking has been cancelled, so we must use the green room. The final amount is 1750 zloty, replacing the earlier 1200 zloty budget.'
  const fragments = [opening]
  const targetWords = minutes ? minutes * 130 : 0
  let words = opening.split(/\s+/).length + ending.split(/\s+/).length
  for (let project = 1; words < targetWords; project++) {
    const fragment =
      language === 'pl'
        ? `Kolejny punkt dotyczył warsztatu numer ${project}. Grupa spotka się w sali numer ${project + 20}; materiały zostaną dostarczone dzień wcześniej. Prowadzący prosił o papier, długopisy i tablicę. Uczestnicy mogą przynieść własne książki, ale nie jest to warunek udziału. Termin zgłoszenia uwag do programu to ${(project % 20) + 1} października. Marta sprawdzi liczbę zgłoszeń dla warsztatu ${project}, a Piotr potwierdzi dostępność projektora. Rozważaliśmy transmisję, jednak odłożyliśmy tę decyzję do kolejnego spotkania. Każda grupa otrzyma krótki formularz opinii. Po zajęciach koordynator zbierze odpowiedzi i zapisze uwagi dotyczące materiałów. Ten punkt zamykamy dopiero po potwierdzeniu sali; na razie rezerwacja jest wstępna.`
        : `The next item concerned workshop number ${project}. The group will meet in room ${project + 20}; materials will arrive the day before. The instructor requested paper, pens and a board. Participants may bring their own books, but this is optional. Feedback on the programme is due on October ${(project % 20) + 1}. Marta will check registrations for workshop ${project}, and Piotr will confirm projector availability. We discussed a broadcast but deferred the decision to the next meeting. Each group will receive a short feedback form. After the workshop the coordinator will collect responses and record comments about the materials. This item closes only after the room is confirmed; its booking is still provisional.`
    fragments.push(fragment)
    words += fragment.split(/\s+/).length
  }
  fragments.push(ending)
  const source = fragments.join('\n\n')
  return {
    id,
    language,
    source,
    provenance: 'synthetic-text',
    nominalMinutes: minutes,
    wordCount: source.split(/\s+/).length,
  }
}
