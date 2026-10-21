import type { ZodType } from 'zod';

/**
 * Tiny zod helper: parse or throw ZodError (mapped to 400 by the error plugin).
 * Kept as a function rather than a Fastify type provider to stay dependency-light.
 */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/** Query strings arrive as strings; coerce the common pagination params. */
export function pagination(q: { page?: unknown; pageSize?: unknown }, maxPageSize = 200): { page: number; pageSize: number; skip: number } {
  const page = Math.max(1, Math.floor(Number(q.page ?? 1)) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(q.pageSize ?? 20)) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
