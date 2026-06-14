import * as SQLite from 'expo-sqlite'

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

export const getDatabase = (): Promise<SQLite.SQLiteDatabase> => {
  if (!dbPromise) dbPromise = initDatabase()
  return dbPromise
}

const initDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  const db = await SQLite.openDatabaseAsync('notatki.db')
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      audioUri TEXT,
      durationMs INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      noteId TEXT NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );
  `)
  await addColumnIfMissing(db, 'notes', 'summary', 'TEXT')
  await addColumnIfMissing(db, 'notes', 'audioUri', 'TEXT')
  await addColumnIfMissing(db, 'notes', 'durationMs', 'INTEGER')
  await addColumnIfMissing(db, 'notes', 'tags', 'TEXT')
  return db
}

const addColumnIfMissing = async (
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> => {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)
  if (columns.some((c) => c.name === column)) return
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}
