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
# --- AliExpress supplier (optional; only needed to auto-buy from AliExpress) ---
# ALIEXPRESS_APP_KEY=...       # AliExpress Open Platform app key
# ALIEXPRESS_APP_SECRET=...    # app secret (the HMAC signing key)
# ALIEXPRESS_ACCESS_TOKEN=...  # a seller OAuth access token (obtained once via the AliExpress consent flow)
```

4. `pnpm --filter @floor/api db:setup` (after pulling schema changes, `db:generate` then `db:push`), `pnpm dev`, sign up, then **Connect eBay** in onboarding/Settings. You sign in on eBay's sandbox consent page and land back on Floor connected.
5. Add a supplier (the manual supplier works in real mode), list a product, publish, and buy it with a sandbox buyer account. The scheduler imports the paid order within `EBAY_ORDER_POLL_MS` (60 s) and runs it through the same pipeline as mock orders.

**Set up my eBay account (one time).** After connecting eBay, open Settings and use the card **Set up eBay listing basics**: enter your US ship-from address (and, optionally, what you will sell so eBay can suggest a category) and press **Set up my eBay account**. Floor opts your account in to business policies, creates free-shipping / 30-day-return / immediate-payment policies and an inventory location named `floor-default` (or reuses ones named "Floor ..." that already exist, so pressing it again is safe), and shows five `EBAY_...` lines. Copy them into `apps/api/.env` and restart Floor; Floor never writes that file for you. In the sandbox, category suggestions are placeholders (eBay does not support them there) and the shipping service code may need an override; production accepts the defaults. Mock mode shows demo values.

**Promoted ads (optional, off by default).** In Settings > Pricing and risk, switch on **Promote new listings** and pick an ad rate (starts at 2%, eBay's lowest). Floor then puts each live listing in one eBay Promoted Listings Standard campaign named "Floor - promoted listings"; eBay charges the rate as a share of the sale price, only on sales that come through an ad. Floor builds the rate into every price, margin floor and order check, re-prices your live listings when you save, and pauses any listing that could not clear your floor at the new rate. An ad that fails never blocks a listing (look for `listing.promote_failed` in the activity log); the next sync retries. **Reconnect eBay once** after updating: promotions need the new `sell.marketing` permission, which older connections do not have. Works in mock mode too (recorded in memory). eBay may require an eBay Store subscription or acceptance of the Promoted Listings terms before the production API accepts ads; the sandbox may not support the Marketing API at all.

**AliExpress supplier (real mode).** Floor has a real AliExpress dropshipping connector: once a buyer pays on eBay, Floor places and pays for the matching AliExpress order automatically and pushes its tracking back to eBay. It needs `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` and `ALIEXPRESS_ACCESS_TOKEN` (above). **You must apply for AliExpress Open Platform access** (an app with the dropshipping / "AliExpress DS" API scope) and **obtain the access token once yourself** — Floor does not run the AliExpress OAuth consent/refresh flow, so a static token is required and must be refreshed by you when it expires (a dead token surfaces as "reconnect AliExpress"). A product's `supplierSku` is `"<productId>"` or `"<productId>:<skuAttr>"`. Several API field names are implemented to the documented SDK shape but are **not verified against a live account** — see `docs/CONTRACT.md` -> "AliExpress supplier adapter" for the VERIFIED vs ASSUMED list before trusting it with real money.

Not automated in real mode: buyer messages (a logged no-op), orders with several line items or quantity > 1 (skipped and logged), and buyer shipping/handling time (taken from your eBay fulfillment policy; keep it free shipping to match Floor's price math). CJdropshipping and Spocket adapters are still stubs. Details and known gaps: `docs/CONTRACT.md` -> "Real eBay adapter".

## Production

Floor is one long-running process: the API, the scheduler, and the dashboard on the same origin, with SQLite on a volume. Do not put the API on a serverless host. The scheduler and the database need a process that stays up.

From the repository root (the directory that contains `compose.yaml`):

```bash
docker compose up --build
```

Open http://localhost:4000, create the seller account, and sign in. This image runs `NODE_ENV=production` in mock mode until you set `FLOOR_MODE=real`. On startup Floor creates the SQLite tables if they are missing and refuses a schema change that would drop data. The database file is the `floor-data` volume (`file:/data/floor.db`).

Before a public https deploy:

1. Copy `apps/api/.env.example` to `apps/api/.env` and fill it in. `WEB_ORIGIN` must be the https URL users type. Leave `FLOOR_ALLOW_HTTP` unset. Set `TRUST_PROXY=1` when a proxy terminates TLS.
2. Real mode needs `FLOOR_SECRET_KEY` (`openssl rand -base64 32`), the eBay app credentials, and — for `EBAY_ENV=production` — `EBAY_DELETION_TOKEN` and `EBAY_DELETION_ENDPOINT` (the public URL of `GET /api/v1/webhooks/ebay/account-deletion`). The process refuses to listen when any of those are missing.
3. Put the proxy in front of port 4000. Client routes (`/login`, `/orders/...`) are served by the API from the built dashboard.

`GET /health` returns `{ ok, mode, db }` and is the container health check. It returns 503 when SQLite cannot be queried.

A split deploy (dashboard on Vercel, API elsewhere) needs `VITE_API_BASE` set to the API origin plus `/api/v1` at **build** time, and `CORS_ORIGINS` on the API set to the dashboard origin. The supported setup is the single container above. `apps/web/vercel.json` only makes the dashboard's client routes resolve; it does not run the API. The image definition stays in `deploy/Dockerfile` so a Vercel project connected to this repo keeps building the dashboard instead of the container.

## Commands

`pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm lint`
