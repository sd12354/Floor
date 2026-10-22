# Floor

Your eBay store, never below the floor.

Floor lists supplier products on eBay, keeps price and stock in sync around the clock, buys from the supplier only after the buyer has paid, pushes tracking, and refuses to fulfil any order below your margin floor. No inventory, no prepaid credits, no money at risk before a sale.

## Quick start (mock mode, no credentials)

```bash
pnpm install                        # also builds @floor/core and generates the Prisma client
pnpm --filter @floor/api db:setup   # creates SQLite dev DB and seeds the demo account
                                    # (after pulling schema changes, run db:generate and db:push instead)
pnpm dev                            # API on :4000, web on :5173
```

Open http://localhost:5173. The first time, create your seller account (email and a password of 8+ characters); after that, sign in with it. Floor has one seller account and signup closes once it exists. Then connect the (mock) eBay account and mock supplier, approve a few products from Discovery, publish, then use **Simulate sale** on a listing to watch an order run through the pipeline: margin re-check → supplier order → tracking → payout. Add a supplier price drift (try 60%) to the simulation: if the order's margin falls below your floor, Floor holds it for your decision instead of fulfilling. Floor never fulfils below your margin floor on its own; you can still approve a held order by hand.

Notes for restricted networks: `prisma generate` is run through `apps/api/scripts/prisma-generate.mjs`, which points
`PRISMA_SCHEMA_ENGINE_BINARY` at a local no-op so nothing is downloaded from binaries.prisma.sh; schema push uses the
wasm engine (`@prisma/schema-engine-wasm`). Only the npm registry is needed. If `pnpm install` is run with
`--ignore-scripts`, run `pnpm --filter @floor/core build && pnpm --filter @floor/api db:generate` by hand.

## Layout

- `packages/core` — margin engine, pricing rule, post-sale ladder, compliance gate, connector interfaces, mock connectors. Pure, fully unit-tested.
- `apps/api` — Fastify + Prisma. Order pipeline, sync, ledger, REST API (`docs/CONTRACT.md`).
- `apps/web` — React dashboard.

## Real mode (eBay sandbox first)

Mock mode is the default and needs nothing. Real mode (`FLOOR_MODE=real`) uses the real eBay Sell API adapter; start in the eBay **sandbox** (`EBAY_ENV=sandbox`, the default) and only switch to `production` once the flow works end to end.

1. Create an eBay developer account and a **sandbox keyset** at developer.ebay.com; create a sandbox seller test user (Sandbox > Create a test user). Create a **RuName** for the keyset whose *accepted URL* is `http://127.0.0.1:4000/api/v1/account/ebay/callback` (use your tunnel URL if the browser is on another machine).
2. In the sandbox seller account, opt in to business policies and create a fulfillment (shipping), payment and return policy, plus an inventory location (`createInventoryLocation`). Note the three policy ids, the location key, and a leaf category id.
3. You can skip the policy ids, location key and category for now: after step 4 Floor can create them for you (see "Set up my eBay account" below). Create `apps/api/.env` (never commit it):

```bash
FLOOR_MODE=real
EBAY_ENV=sandbox
EBAY_CLIENT_ID=...            # sandbox App ID
EBAY_CLIENT_SECRET=...        # sandbox Cert ID
EBAY_RU_NAME=...              # the RuName from step 1
EBAY_FULFILLMENT_POLICY_ID=... EBAY_PAYMENT_POLICY_ID=... EBAY_RETURN_POLICY_ID=...
EBAY_MERCHANT_LOCATION_KEY=...
EBAY_DEFAULT_CATEGORY_ID=...
FLOOR_SECRET_KEY=...           # paste the output of: openssl rand -base64 32 (keep it; losing it means reconnecting eBay)
WEB_ORIGIN=http://localhost:5173
# EBAY_USER_TOKEN=...         # optional static sandbox token instead of the connect flow
```

4. `pnpm --filter @floor/api db:setup` (after pulling schema changes, `db:generate` then `db:push`), `pnpm dev`, sign up, then **Connect eBay** in onboarding/Settings. You sign in on eBay's sandbox consent page and land back on Floor connected.
5. Add a supplier (the manual supplier works in real mode), list a product, publish, and buy it with a sandbox buyer account. The scheduler imports the paid order within `EBAY_ORDER_POLL_MS` (60 s) and runs it through the same pipeline as mock orders.

**Set up my eBay account (one time).** After connecting eBay, open Settings and use the card **Set up eBay listing basics**: enter your US ship-from address (and, optionally, what you will sell so eBay can suggest a category) and press **Set up my eBay account**. Floor opts your account in to business policies, creates free-shipping / 30-day-return / immediate-payment policies and an inventory location named `floor-default` (or reuses ones named "Floor ..." that already exist, so pressing it again is safe), and shows five `EBAY_...` lines. Copy them into `apps/api/.env` and restart Floor; Floor never writes that file for you. In the sandbox, category suggestions are placeholders (eBay does not support them there) and the shipping service code may need an override; production accepts the defaults. Mock mode shows demo values.

Not automated in real mode: buyer messages (a logged no-op), orders with several line items or quantity > 1 (skipped and logged), and buyer shipping/handling time (taken from your eBay fulfillment policy; keep it free shipping to match Floor's price math). CJdropshipping and Spocket adapters are still stubs. Details and known gaps: `docs/CONTRACT.md` -> "Real eBay adapter".

## Commands

`pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm lint`
