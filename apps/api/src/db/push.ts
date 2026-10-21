import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { bindMigrationAwareSqlAdapterFactory } from '@prisma/driver-adapter-utils';
import { SchemaEngine } from '@prisma/schema-engine-wasm';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/api root (works from src/ and from dist/). */
export const API_ROOT = path.resolve(here, '..', '..');
export const SCHEMA_PATH = path.join(API_ROOT, 'prisma', 'schema.prisma');

export function resolveDatabaseUrl(explicit?: string): string {
  const raw = explicit ?? process.env.DATABASE_URL ?? 'file:./dev.db';
  if (!raw.startsWith('file:')) return raw;
  const p = raw.slice('file:'.length);
  if (p === ':memory:' || path.isAbsolute(p)) return raw;
  // Resolve relative to apps/api like the Prisma CLI does (relative to prisma.config.ts).
  return `file:${path.resolve(API_ROOT, p)}`;
}

export function sqliteFilePath(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  const p = url.slice('file:'.length).split('?')[0] ?? '';
  return p === ':memory:' ? null : p;
}

export interface PushResult {
  executedSteps: number;
  warnings: string[];
  unexecutable: string[];
}

/** Apply prisma/schema.prisma to the SQLite database at `url` (create tables, add columns). */
export async function pushSchema(url: string, force = true): Promise<PushResult> {
  const file = sqliteFilePath(url);
  if (file) mkdirSync(path.dirname(file), { recursive: true });
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const factory = bindMigrationAwareSqlAdapterFactory(new PrismaBetterSqlite3({ url }));
  const engine = await SchemaEngine.new({ datamodels: [[SCHEMA_PATH, schema]] }, () => undefined, factory);
  try {
    const out = await engine.schemaPush({
      force,
      schema: { files: [{ path: SCHEMA_PATH, content: schema }] },
      filters: { externalTables: [], externalEnums: [] },
    });
    return { executedSteps: out.executedSteps, warnings: out.warnings, unexecutable: out.unexecutable };
  } finally {
    engine.free();
  }
}

/** Delete the SQLite file (and WAL/journal siblings) so the next push starts clean. */
export async function resetDatabase(url: string): Promise<void> {
  const file = sqliteFilePath(url);
  if (!file) return;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const p = `${file}${suffix}`;
    if (existsSync(p)) rmSync(p, { force: true });
  }
}
