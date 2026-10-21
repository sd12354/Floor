import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { resolveDatabaseUrl } from './paths.js';

export type Db = PrismaClient;

/** Create a Prisma client over better-sqlite3 (engine-free, Prisma 7 driver adapter). */
export function createDb(databaseUrl?: string): Db {
  const url = resolveDatabaseUrl(databaseUrl);
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

export { resolveDatabaseUrl };
