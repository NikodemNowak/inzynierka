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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY NOT NULL,
      phase TEXT NOT NULL,
      model TEXT NOT NULL,
      inputChars INTEGER NOT NULL,
      ttftMs INTEGER NOT NULL,
      tokensPerSecond REAL NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_operations (
      id TEXT PRIMARY KEY NOT NULL,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      inputChars INTEGER NOT NULL,
      queueMs INTEGER NOT NULL,
      modelLoadMs INTEGER,
      totalMs INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `)
  await addColumnIfMissing(db, 'notes', 'summary', 'TEXT')
  await addColumnIfMissing(db, 'notes', 'audioUri', 'TEXT')
  await addColumnIfMissing(db, 'notes', 'durationMs', 'INTEGER')
  await addColumnIfMissing(db, 'notes', 'tags', 'TEXT')
  await addColumnIfMissing(db, 'metrics', 'wallMs', 'INTEGER')
  await addColumnIfMissing(db, 'metrics', 'promptMs', 'INTEGER')
  await addColumnIfMissing(db, 'metrics', 'predictedMs', 'INTEGER')
  await addColumnIfMissing(db, 'metrics', 'promptTokens', 'INTEGER')
  await addColumnIfMissing(db, 'metrics', 'predictedTokens', 'INTEGER')
  return db
}

const addColumnIfMissing = async (
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> => {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  )
  if (columns.some((c) => c.name === column)) return
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}
