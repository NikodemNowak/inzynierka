const relativeRecordingPath = (uri: string, documentDirectory: string): string | null => {
  const currentPrefix = `${documentDirectory}recordings/`
  const relative = uri.startsWith('recordings/')
    ? uri
    : uri.startsWith(currentPrefix)
      ? `recordings/${uri.slice(currentPrefix.length)}`
      : uri.match(
          /^file:\/\/\/(?:private\/)?var\/mobile\/Containers\/Data\/Application\/[A-Za-z0-9-]+\/Documents\/(recordings\/[\s\S]*)$/,
        )?.[1]
  // Only canonicalize separators inside the known recordings subtree. Do not
  // decode URLs or resolve traversal, encoded separators, or unrelated files.
  if (!relative || relative.endsWith('/') || /[^A-Za-z0-9._/-]/.test(relative)) return null
  const parts = relative.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) return null
  const path = parts.join('/')
  const flat = /^recordings\/[A-Za-z0-9._-]+$/.test(path)
  const capture = /^recordings\/captures\/capture-[A-Za-z0-9-]+\/(?:full|[0-9]{6})\.wav$/.test(path)
  return flat || capture ? path : null
}

export const resolveRecordingUri = (uri: string, documentDirectory: string): string => {
  const relative = relativeRecordingPath(uri, documentDirectory)
  return relative ? `${documentDirectory}${relative}` : uri
}

export const toStoredRecordingPath = (uri: string, documentDirectory: string): string =>
  relativeRecordingPath(uri, documentDirectory) ?? uri
