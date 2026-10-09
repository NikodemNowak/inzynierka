import * as SQLite from 'expo-sqlite'
import { getDatabase } from './database'

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))

test('adds the Polish language default when migrating an existing notes table', async () => {
  const db = {
    execAsync: jest.fn(),
    getAllAsync: jest.fn(async () => [{ name: 'id' }]),
  }
  jest
    .mocked(SQLite.openDatabaseAsync)
    .mockResolvedValue(db as unknown as SQLite.SQLiteDatabase)
  await getDatabase()
  expect(db.execAsync).toHaveBeenCalledWith(
    "ALTER TABLE notes ADD COLUMN language TEXT NOT NULL DEFAULT 'pl';",
  )
})
