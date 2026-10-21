# @floor/api

Fastify 5 + Prisma 7 (SQLite via `better-sqlite3` driver adapter) + `@floor/core`.

```bash
pnpm --filter @floor/api db:setup   # push schema (wasm engine, no binary download) + seed acc_demo
pnpm --filter @floor/api dev        # http://localhost:4000/api/v1
pnpm --filter @floor/api test       # vitest, temp SQLite per file
pnpm --filter @floor/api db:reset   # wipe dev.db and re-seed
```

Notes
- `prisma generate` runs through `scripts/prisma-generate.mjs`, which points `PRISMA_SCHEMA_ENGINE_BINARY` at a no-op so the CLI
  does not download the native schema engine. `db push` is done by `scripts/db.ts` using `@prisma/schema-engine-wasm`.
- The generated client lives in `src/generated/prisma` (git-ignored) and is compiled into `dist/` by `tsc`.
- Mock mode (`FLOOR_MODE=mock`, default) needs no credentials. Tracking arrives `MOCK_TRACKING_DELAY_MS` after `ordered`.
