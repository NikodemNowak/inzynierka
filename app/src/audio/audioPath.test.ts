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

describe('native capture paths across an iOS data-container update', () => {
  const capture = 'capture-mutpvt87-7if17eb1'
  const relative = `recordings/captures/${capture}/000000.wav`
  // Literal persisted URI and fresh container from the preserved phone proof.
  const actualSaved = `file:///var/mobile/Containers/Data/Application/59D63FD2-C384-4019-8065-AC79DDEA1E94/Documents/recordings/captures/${capture}//000000.wav`
  const actualCurrent = 'file:///private/var/mobile/Containers/Data/Application/2E5DF369-BEC6-4080-A7F1-C70201B812A8/Documents/'

  it('rebases the actual old capture segment without depending on its old absolute folder', () => {
    expect(resolveRecordingUri(actualSaved, actualCurrent)).toBe(actualCurrent + relative)
    expect(toStoredRecordingPath(actualSaved, actualCurrent)).toBe(relative)
  })

  it.each([
    relative,
    `recordings//captures//${capture}///000000.wav`,
    currentDirectory + relative,
    `${currentDirectory}recordings/captures/${capture}//000000.wav`,
    `file:///var/mobile/Containers/Data/Application/OLD/Documents/${relative}`,
    `file:///private/var/mobile/Containers/Data/Application/OLD/Documents/${relative}`,
  ])('resolves and stores the same owned capture identity: %s', (uri) => {
    const resolved = currentDirectory + relative
    expect(resolveRecordingUri(uri, currentDirectory)).toBe(resolved)
    expect(toStoredRecordingPath(uri, currentDirectory)).toBe(relative)
    expect(resolveRecordingUri(toStoredRecordingPath(uri, currentDirectory), currentDirectory)).toBe(resolved)
  })

  it.each(['full.wav', '000001.wav', '999999.wav'])('preserves the exact supported capture filename %s', (filename) => {
    const path = `recordings/captures/capture-other-42/${filename}`
    expect(resolveRecordingUri(path, currentDirectory)).toBe(currentDirectory + path)
    expect(toStoredRecordingPath(currentDirectory + path, currentDirectory)).toBe(path)
  })

  it.each(['voice..v2.wav', '.voice.wav', 'voice_2026-10-04.m4a'])('preserves legitimate flat filenames %s', (filename) => {
    const path = `recordings/${filename}`
    expect(resolveRecordingUri(path, currentDirectory)).toBe(currentDirectory + path)
    expect(toStoredRecordingPath(currentDirectory + path, currentDirectory)).toBe(path)
  })

  it.each([
    'recordings/.', 'recordings/..', 'recordings/../outside.wav',
    `recordings/captures/${capture}/../000000.wav`,
    `recordings/captures/${capture}/./000000.wav`,
    `recordings/captures/${capture}/%2f000000.wav`,
    `recordings/captures/${capture}/%5C000000.wav`,
    `recordings/captures/${capture}\\000000.wav`,
    `recordings/captures/${capture}/000000.wav\n`,
    `recordings/captures/${capture}/000000.wav?copy=1`,
    `recordings/captures/${capture}/000000.wav#part`,
    `recordings/captures/${capture}/1.wav`,
    `recordings/captures/${capture}/transcript.json`,
    'recordings/captures/not-a-capture/full.wav',
    'recordings/captures/capture-/full.wav',
    'recordings/other/nested.wav',
    'recordings/voice.wav/',
    `recordings/captures/${capture}/full.wav/`,
    'file:///private/var/mobile/Downloads/recordings/captures/capture-other/full.wav',
    'https://example.test/recordings/captures/capture-other/full.wav',
    'file:///var/mobile/Containers/Data/Application/../Documents/recordings/voice.wav',
    'file:///var/mobile/Containers/Data/Application/OLD%2fNEW/Documents/recordings/voice.wav',
  ])('does not rebase an unsafe or unrelated path: %s', (uri) => {
    expect(resolveRecordingUri(uri, currentDirectory)).toBe(uri)
    expect(toStoredRecordingPath(uri, currentDirectory)).toBe(uri)
  })
})
