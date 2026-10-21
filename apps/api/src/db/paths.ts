import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
