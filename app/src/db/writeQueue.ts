// Exclusive Expo transactions use a separate connection. Every app writer must
// share this queue so a metric cannot invalidate a checkpoint's WAL read snapshot.
// Queue the whole transaction; do not queue individual writes inside it.
let pendingWrites: Promise<void> = Promise.resolve()

export const withDatabaseWrite = <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const write = pendingWrites.then(operation)
  // Preserve the caller's error, while allowing later writes to proceed.
  pendingWrites = write.then(
    () => undefined,
    () => undefined,
  )
  return write
}
