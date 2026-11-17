import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { resolveDatabaseUrl, sqliteFilePath } from './paths.js';

export type Db = PrismaClient;

/**
 * WAL lets the scheduler read while a request writes. busy_timeout waits out a short lock
 * instead of failing the request. Applied before Prisma opens the file.
 */
function tuneSqliteFile(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const raw = new Database(file);
  try {
    raw.pragma('journal_mode = WAL');
    raw.pragma('busy_timeout = 5000');
    raw.pragma('synchronous = NORMAL');
    raw.pragma('foreign_keys = ON');
  } finally {
    raw.close();
  }
}

/** Create a Prisma client over better-sqlite3 (engine-free, Prisma 7 driver adapter). */
export function createDb(databaseUrl?: string): Db {
  const url = resolveDatabaseUrl(databaseUrl);
  const file = sqliteFilePath(url);
  // journal_mode persists on the file. busy_timeout does not, so prepareDb sets it on the live connection.
  if (file) tuneSqliteFile(file);
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

/** Per-connection SQLite settings. WAL was already set on the file. */
export async function prepareDb(db: Db): Promise<void> {
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await db.$queryRawUnsafe('PRAGMA foreign_keys = ON');
}

export { resolveDatabaseUrl };
