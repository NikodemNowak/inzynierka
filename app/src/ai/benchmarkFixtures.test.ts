import { Asset } from 'expo-asset'
import {
  BENCHMARK_AUDIO_FIXTURES,
  makeEnglishBenchmarkAudioFixture,
  prepareEnglishBenchmarkAudioFixture,
} from './benchmarkFixtures'

const mockFiles = new Map<string, number>()
const mockAsset = {
  uri: 'file:///bundle/english.wav',
  localUri: null as string | null,
  downloadAsync: jest.fn(),
}
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn(() => mockAsset) } }))
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  File: class {
    readonly uri: string
    constructor(...parts: string[]) { this.uri = parts.join('/') }
    get exists() { return mockFiles.has(this.uri) }
    get size() { return mockFiles.get(this.uri) ?? 0 }
  },
}))
jest.mock('./llm', () => ({
  GenerationCancelledError: class extends Error { constructor() { super('Generation cancelled') } },
}))
jest.mock('../../assets/benchmarks/english-3min.wav', () => 301, { virtual: true })
jest.mock('../../assets/benchmarks/english-10min.wav', () => 1001, { virtual: true })
jest.mock('../../assets/benchmarks/english-30min.wav', () => 3001, { virtual: true })

beforeEach(() => {
  jest.clearAllMocks()
  mockFiles.clear()
  mockFiles.set('file:///bundle/english.wav', 100)
  mockFiles.set('file:///cache/english.wav', 100)
  mockAsset.uri = 'file:///bundle/english.wav'
  mockAsset.localUri = null
  mockAsset.downloadAsync.mockImplementation(async () => {
    mockAsset.localUri = 'file:///cache/english.wav'
    return mockAsset
  })
})

test('publishes typed synthetic audio descriptors in three, ten and thirty minute order', () => {
  expect(BENCHMARK_AUDIO_FIXTURES.map(({ id, nominalMinutes }) => [id, nominalMinutes])).toEqual([
    ['en-audio-3min-v1', 3], ['en-audio-10min-v1', 10], ['en-audio-30min-v1', 30],
  ])
  for (const fixture of BENCHMARK_AUDIO_FIXTURES) {
    expect(fixture.durationMs).toBeGreaterThan(0)
    expect(fixture.durationMs).toBeLessThanOrEqual(1800000)
    expect(fixture.filename).toBe(`english-${fixture.nominalMinutes}min.wav`)
    expect(fixture.sha256).toMatch(/^[a-f\d]{64}$/u)
    expect(fixture.referenceTranscript.trim()).not.toBe('')
  }
})

test.each([
  ['en-audio-3min-v1', 301], ['en-audio-10min-v1', 1001], ['en-audio-30min-v1', 3001],
] as const)('resolves only its statically required bundled module %s into a local fixture', async (id, moduleId) => {
  const fixture = await prepareEnglishBenchmarkAudioFixture(id)
  const descriptor = BENCHMARK_AUDIO_FIXTURES.find((entry) => entry.id === id)!
  expect(Asset.fromModule).toHaveBeenCalledWith(moduleId)
  expect(mockAsset.downloadAsync).toHaveBeenCalledTimes(1)
  expect(fixture).toEqual({ uri: 'file:///cache/english.wav', locale: 'en-US', provenance: 'synthetic-audio',
    referenceTranscript: descriptor.referenceTranscript, expectedDurationMs: descriptor.durationMs,
    audioSha256: descriptor.sha256, bundled: true })
})

test('uses an existing local cached file without a network or copy request', async () => {
  mockAsset.localUri = 'file:///cache/english.wav'
  mockAsset.uri = 'https://invalid.example/english.wav'
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).resolves.toMatchObject({ uri: mockAsset.localUri })
  expect(mockAsset.downloadAsync).not.toHaveBeenCalled()
})

test('rejects remote-only asset resolution without trying to download it', async () => {
  mockAsset.uri = 'https://invalid.example/english.wav'
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).rejects.toThrow(/local|offline|bundle/i)
  expect(mockAsset.downloadAsync).not.toHaveBeenCalled()
})

test.each(['missing', 'empty'] as const)('rejects a %s bundled file without inventing a URI or benchmark source', async (condition) => {
  if (condition === 'missing') mockFiles.delete(mockAsset.uri)
  else mockFiles.set(mockAsset.uri, 0)
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).rejects.toThrow(/missing|empty|file/i)
  expect(mockAsset.downloadAsync).not.toHaveBeenCalled()
})

test('copies from the local bundle again when the previous cache file was removed', async () => {
  mockAsset.localUri = 'file:///cache/removed.wav'
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).resolves.toMatchObject({ uri: 'file:///cache/english.wav' })
  expect(mockAsset.downloadAsync).toHaveBeenCalledTimes(1)
})

test('propagates local cache preparation failure', async () => {
  mockAsset.downloadAsync.mockRejectedValueOnce(new Error('Local copy failed'))
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).rejects.toThrow('Local copy failed')
})

test('propagates a missing module registry error instead of using another fixture', async () => {
  jest.mocked(Asset.fromModule).mockImplementationOnce(() => { throw new Error('Asset module is missing') })
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).rejects.toThrow('Asset module is missing')
  expect(mockAsset.downloadAsync).not.toHaveBeenCalled()
})

test('rechecks the copied URI and file instead of returning a missing asset', async () => {
  mockAsset.downloadAsync.mockImplementationOnce(async () => {
    mockAsset.localUri = 'file:///cache/missing.wav'
    return mockAsset
  })
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1')).rejects.toThrow(/file|missing/i)
})

test.each(['before', 'during'] as const)('rejects cancellation %s local asset preparation', async (stage) => {
  const controller = new AbortController()
  if (stage === 'before') controller.abort()
  else mockAsset.downloadAsync.mockImplementationOnce(async () => {
    controller.abort()
    mockAsset.localUri = 'file:///cache/english.wav'
    return mockAsset
  })
  await expect(prepareEnglishBenchmarkAudioFixture('en-audio-3min-v1', controller.signal)).rejects.toThrow(/cancel/i)
  if (stage === 'before') expect(Asset.fromModule).not.toHaveBeenCalled()
})

test('keeps the previous smoke fixture factory compatible', () => {
  expect(makeEnglishBenchmarkAudioFixture()).toMatchObject({ uri: 'file:///documents/TestAudio/benchmark-en-smoke-v6.wav',
    locale: 'en-US', provenance: 'synthetic-audio' })
})
