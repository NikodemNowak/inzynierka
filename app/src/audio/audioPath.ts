const relativeRecordingPath = (uri: string, documentDirectory: string): string | null => {
  const currentPrefix = `${documentDirectory}recordings/`
  const currentName = uri.startsWith(currentPrefix) ? uri.slice(currentPrefix.length) : null
  const oldContainerName = uri.match(
    /^file:\/\/\/(?:private\/)?var\/mobile\/Containers\/Data\/Application\/[^/]+\/Documents\/recordings\/([^/]+)$/,
  )?.[1]
  const name = currentName ?? oldContainerName
  return name && /^[A-Za-z0-9._-]+$/.test(name) ? `recordings/${name}` : null
}

export const resolveRecordingUri = (uri: string, documentDirectory: string): string => {
  const relative = /^recordings\/[A-Za-z0-9._-]+$/.test(uri)
    ? uri
    : relativeRecordingPath(uri, documentDirectory)
  return relative ? `${documentDirectory}${relative}` : uri
}

export const toStoredRecordingPath = (uri: string, documentDirectory: string): string =>
  relativeRecordingPath(uri, documentDirectory) ?? uri
