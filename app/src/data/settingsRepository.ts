import { getDatabase } from '../db/database'

// Key-value store for the handful of user preferences that have to survive a
// restart. Deliberately a table in the existing database rather than a separate
// storage dependency: the app already owns a SQLite file.
export const getSetting = async (key: string): Promise<string | null> => {
  const db = await getDatabase()
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  )
  return row?.value ?? null
}

export const setSetting = async (key: string, value: string): Promise<void> => {
  const db = await getDatabase()
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  )
}
