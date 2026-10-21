# Floor

Your eBay store, never below the floor.

Floor lists supplier products on eBay, keeps price and stock in sync around the clock, buys from the supplier only after the buyer has paid, pushes tracking, and refuses to fulfil any order below your margin floor. No inventory, no prepaid credits, no money at risk before a sale.

## Quick start (mock mode, no credentials)

```bash
pnpm install                        # also builds @floor/core and generates the Prisma client
pnpm --filter @floor/api db:setup   # creates SQLite dev DB and seeds the demo account
pnpm dev                            # API on :4000, web on :5173
```

Open http://localhost:5173. Connect the (mock) eBay account and mock supplier, approve a few products from Discovery, publish, then use **Simulate sale** on a listing to watch an order run through the pipeline: margin re-check → supplier order → tracking → payout. Add a supplier price drift of 60% to the simulation to see the post-sale ladder hold the order for your decision.

Notes for restricted networks: `prisma generate` is run through `apps/api/scripts/prisma-generate.mjs`, which points
`PRISMA_SCHEMA_ENGINE_BINARY` at a local no-op so nothing is downloaded from binaries.prisma.sh; schema push uses the
wasm engine (`@prisma/schema-engine-wasm`). Only the npm registry is needed. If `pnpm install` is run with
`--ignore-scripts`, run `pnpm --filter @floor/core build && pnpm --filter @floor/api db:generate` by hand.

## Layout

- `packages/core` — margin engine, pricing rule, post-sale ladder, compliance gate, connector interfaces, mock connectors. Pure, fully unit-tested.
- `apps/api` — Fastify + Prisma. Order pipeline, sync, ledger, REST API (`docs/CONTRACT.md`).
- `apps/web` — React dashboard.

## Real mode

Set `FLOOR_MODE=real` and the eBay / supplier credentials in `apps/api/.env` (see `docs/CONTRACT.md` → Env). The eBay and supplier adapters in `packages/core/src/connectors/real/` are scaffolds with the API calls mapped out; they need a registered eBay developer app and supplier API keys to go live.

## Commands

`pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm lint`
