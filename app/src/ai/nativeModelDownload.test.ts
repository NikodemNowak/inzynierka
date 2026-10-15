import {
  downloadStateMatches,
  downloadStateProgress,
  type NativeDownloadState,
} from './nativeModelDownload'
const state: NativeDownloadState = {
  version: 1,
  id: 'download-test',
  url: 'https://example.test/model',
  filename: 'model.gguf',
  expectedBytes: 1000,
  expectedSha256: 'abc',
  state: 'running',
  writtenBytes: 1000,
  language: 'en',
}
test('does not report full success before native size/hash verification and promotion', () => {
  expect(downloadStateProgress(state)).toBe(99.9)
  expect(downloadStateProgress({ ...state, state: 'verifying' })).toBe(99.9)
  expect(downloadStateProgress({ ...state, state: 'complete' })).toBe(100)
})
test('does not attach a previous authorization to different source metadata', () => {
  const expected = {
    url: state.url,
    filename: state.filename,
    sizeBytes: 1000,
    sha256: 'abc',
  }
  expect(downloadStateMatches(state, expected)).toBe(true)
  expect(downloadStateMatches(state, { ...expected, sizeBytes: 999 })).toBe(
    false,
  )
  expect(
    downloadStateMatches(state, { ...expected, sha256: 'different' }),
  ).toBe(false)
  expect(
    downloadStateMatches(state, {
      ...expected,
      url: 'https://example.test/changed',
    }),
  ).toBe(false)
})
