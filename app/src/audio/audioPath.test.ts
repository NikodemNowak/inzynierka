import { resolveRecordingUri, toStoredRecordingPath } from './audioPath'

const currentDirectory =
  'file:///var/mobile/Containers/Data/Application/NEW/Documents/'

describe('recording paths', () => {
  it('resolves a recording saved before the iOS data container moved', () => {
    const saved =
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/recordings/voice.wav'

    expect(resolveRecordingUri(saved, currentDirectory)).toBe(
      `${currentDirectory}recordings/voice.wav`,
    )
  })

  it('stores app recordings relative to Documents', () => {
    expect(
      toStoredRecordingPath(`${currentDirectory}recordings/voice.wav`, currentDirectory),
    ).toBe('recordings/voice.wav')
    expect(resolveRecordingUri('recordings/voice.wav', currentDirectory)).toBe(
      `${currentDirectory}recordings/voice.wav`,
    )
  })

  it('preserves unrelated imported file URIs', () => {
    const external = 'file:///private/var/mobile/Downloads/voice.wav'
    expect(resolveRecordingUri(external, currentDirectory)).toBe(external)
    expect(toStoredRecordingPath(external, currentDirectory)).toBe(external)
  })
})
