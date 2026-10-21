# Floor — engineering conventions

Floor is an autonomous eBay dropshipping platform: it lists supplier products on eBay, keeps price and stock in sync, buys from the supplier only after the buyer has paid, pushes tracking, and never fulfils an order below the seller's margin floor. The PRD lives in the Claude project doc "PRD: For 'Floor' An Autonomous eBay Dropshipping Platform"; `docs/CONTRACT.md` in this repo is the API and data contract every app builds against.

## Layout (pnpm workspace)

- `packages/core` — pure TypeScript, no I/O. Margin engine, pricing rule, post-sale ladder, compliance gate, fee tables, connector interfaces, and in-memory mock connectors. 100% unit-tested with vitest.
- `apps/api` — Fastify + TypeScript + Prisma (SQLite in dev via `DATABASE_URL=file:./dev.db`; schema must stay Postgres-compatible). Order pipeline, sync jobs, ledger, REST API per CONTRACT.md. Integration tests with vitest against a temp SQLite file.
- `apps/web` — React 18 + Vite + TypeScript + Tailwind + TanStack Query + react-router. Talks only to the REST API in CONTRACT.md. Component tests with vitest + testing-library where logic warrants.

## Rules

- Money is integer **cents** everywhere (`number`, never float dollars). Percentages are decimals (`0.136`, not `13.6`).
- Every eBay order id maps to at most one supplier order, ever. Order processing is idempotent; duplicate webhooks are no-ops.
- No write to eBay or a supplier happens without passing `complianceGate` and `marginEngine` from `@floor/core`.
- Supplier connectors are an allowlist (`SUPPLIER_ALLOWLIST` in core). No generic URL import. Amazon/Walmart/Temu/AliExpress-retail are never connectors.
- Real eBay / CJdropshipping / Spocket adapters are stubs that read credentials from env and throw a clear `NotConfiguredError` when missing; the mock connectors must make the whole product usable end-to-end with zero credentials (`FLOOR_MODE=mock`, the default).
- Strict TypeScript (`"strict": true`, `noUncheckedIndexedAccess: true`). No `any` without a comment saying why.
- `pnpm -r test`, `pnpm -r typecheck`, and `pnpm -r build` must pass before a commit.
- Keep files under ~300 lines; split by concern.
- Commit messages: imperative, scoped: `core: add post-sale ladder`, `api: order pipeline idempotency`, `web: float meter`.
