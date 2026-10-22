# Floor — API & data contract (v1)

Backend (`apps/api`) implements this; frontend (`apps/web`) consumes it. Both sides may add fields, never remove or rename without updating this file. All money is integer cents. All timestamps ISO 8601 UTC. Base path `/api/v1`. JSON only. Errors: `{ "error": { "code": string, "message": string } }` with 4xx/5xx.

Auth (v1): single-tenant dev mode. Every request carries `X-Account-Id` (default `acc_demo`). The API seeds `acc_demo` on first run in mock mode.

## Core types (shared with `@floor/core`)

```ts
type Cents = number;          // integer
type Pct = number;            // 0.136 = 13.6%

interface FeeConfig {
  finalValueFeePct: Pct;      // 0.136 default (most US categories, 2026)
  perOrderFeeCents: Cents;    // 40 (30 when order total <= $10)
  promotedPct: Pct;           // 0 unless seller runs promoted listings
  storeDiscountPct: Pct;      // reduction applied to finalValueFeePct (0 | 0.009)
  topRatedDiscountPct: Pct;   // 0 | 0.10 (10% off variable part)
  belowStandardSurchargePct: Pct; // 0 | 0.06
}

interface MarginInput {
  salePriceCents: Cents;       // item price buyer pays
  buyerShippingCents: Cents;   // shipping buyer pays (0 for free shipping)
  supplierCostCents: Cents;
  supplierShippingCents: Cents;
  toolFeeCents: Cents;         // Floor's per-order overage, usually 0
  fees: FeeConfig;
}

interface MarginResult {
  ebayFeesCents: Cents;
  netProfitCents: Cents;
  netMarginPct: Pct;          // netProfitCents / (salePriceCents + buyerShippingCents)
}

interface PricingRule {
  floorPct: Pct;              // default 0.10
  targetPct: Pct;             // default 0.20
  roundTo: 'none' | '0.99' | '0.95';
}

type LadderDecision =
  | { action: 'fulfil'; reason: 'within_tolerance' | 'small_loss' }
  | { action: 'hold';   reason: 'below_floor'; deadline: string }
  | { action: 'cancel'; reason: 'no_decision' | 'out_of_stock' };

interface ComplianceResult { ok: true } | { ok: false; code: 'SUPPLIER_NOT_ALLOWED' | 'VERO_MATCH' | 'RESTRICTED_CATEGORY' | 'NO_IMAGES' | 'HANDLING_TIME_EXCEEDED'; detail: string }
```

## Entities (Prisma models; REST shapes mirror these)

- **Account** `{ id, name, ebayConnected: bool, ebayUsername?: string, pricingRule, fees: FeeConfig, dailySpendCapCents, smallLossToleranceCents (default 500), handlingTimeDays (default 3), createdAt }`
- **SupplierConnection** `{ id, accountId, supplier: 'mock' | 'cjdropshipping' | 'spocket', status: 'connected' | 'error' | 'not_configured', label, createdAt }`
- **Product** (supplier catalog item, cached) `{ id, supplier, supplierSku, title, description, images: string[], costCents, shippingCents, stock, warehouseCountry, brand?, categoryHint?, updatedAt }`
- **Listing** `{ id, accountId, productId, ebayItemId?, title, priceCents, buyerShippingCents, quantity, status: 'draft' | 'active' | 'paused' | 'ended' | 'blocked', pauseReason?, projectedMarginPct, lastSyncAt, createdAt }`
- **Order** `{ id, accountId, listingId, ebayOrderId, buyerName, shipTo: Address, salePriceCents, buyerShippingCents, status: OrderStatus, supplierOrderId?, supplierCostCents?, supplierShippingCents?, trackingNumber?, carrier?, ladderDecision?, holdDeadline?, payoutExpectedAt?, paidOutAt?, netProfitCents?, createdAt, updatedAt }`
  - `OrderStatus = 'paid' | 'checking' | 'held' | 'queued' | 'ordered' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'`
- **LedgerEntry** `{ id, accountId, orderId?, kind: 'sale' | 'ebay_fee' | 'supplier_cost' | 'supplier_shipping' | 'refund' | 'payout', amountCents (signed), at }`
- **Event** (audit) `{ id, accountId, orderId?, listingId?, type, payload: json, at }`
- **BlockedBrand** `{ id, pattern, source: 'seed' | 'vero_notice', at }`
- **Message** `{ id, accountId, orderId, direction: 'in' | 'out', kind: 'order_confirmed' | 'shipped' | 'delivered' | 'wismo' | 'cancel' | 'return' | 'other', body, suggestedReply?, at }`

## Endpoints

### Account & setup
- `GET  /account` → Account (+ `supplierConnections[]`)
- `PATCH /account` body: partial `{ name, pricingRule, fees, dailySpendCapCents, smallLossToleranceCents, handlingTimeDays }`
- `POST /account/ebay/connect` → in mock mode marks connected with `ebayUsername: "demo_seller"`; in real mode returns `{ authorizeUrl }` (the URL carries a random single-use `state`; `501 NOT_CONFIGURED` if `FLOOR_SECRET_KEY` is missing or not 32 bytes)
- `GET  /account/ebay/callback?code=&state=` (public, real mode only; see v1.4)
- `POST /account/ebay/setup` body `{ location: { addressLine1, city, stateOrProvince, postalCode, country: 'US' }, categoryQuery? }` → listing basics ids (see v1.5)
- `POST /suppliers` body `{ supplier, credentials?: {} }` → SupplierConnection (mock needs none)
- `DELETE /suppliers/:id`

### Discovery
- `GET /discovery?supplier=&q=&minMarginPct=&page=&pageSize=` → `{ items: (Product & { projectedPriceCents, projectedMarginPct, compliance: ComplianceResult })[], total }`
- `GET /discovery/:productId` → same item shape with full description

### Listings
- `GET  /listings?status=&q=&page=&pageSize=` → `{ items: (Listing & { product: Product })[], total }`
- `POST /listings` body `{ productIds: string[] }` → creates drafts with AI-ish title + derived price; returns `{ created: Listing[], blocked: { productId, compliance }[] }`
- `PATCH /listings/:id` body `{ title?, priceCents?, status?: 'active' | 'paused' }` — price below floor → 422 `PRICE_BELOW_FLOOR`
- `POST /listings/publish` body `{ ids: string[] }` → activates (mock: assigns ebayItemId)
- `POST /listings/sync` → runs one price/stock sweep now; returns `{ repriced, paused, resumed }`

### Orders
- `GET  /orders?status=&page=&pageSize=` → `{ items: (Order & { listing: { title } })[], total }`
- `GET  /orders/:id` → Order + `events[]` + `messages[]` + `ledger[]`
- `POST /orders/:id/decision` body `{ action: 'fulfil' | 'cancel' }` — only when `status === 'held'`
- `POST /orders/simulate` (mock mode only) body `{ listingId, buyerName?, priceDriftPct? }` → creates a paid eBay order and runs the pipeline; `priceDriftPct` bumps supplier cost first so the ladder can be exercised
- `POST /webhooks/ebay` — real-mode order notifications (idempotent on `ebayOrderId`)

### Dashboard
- `GET /dashboard` → `{ float: { outstandingCents, byOrder: { orderId, amountCents, payoutExpectedAt }[] }, today: { orders, revenueCents, profitCents, supplierSpendCents, spendCapCents }, health: { lateShipmentPct, defectPct, casesOpen, thresholds: { lateShipmentPct: 0.03, defectPct: 0.005 } }, listings: { active, paused, draft, blocked }, recentEvents: Event[] }`
- `GET /ledger?from=&to=` → `{ entries: LedgerEntry[], totals: { revenueCents, feesCents, costCents, profitCents } }`
- `GET /ledger/export.csv`

### Messages
- `GET  /messages?orderId=&unansweredOnly=` → Message[]
- `POST /messages/:id/reply` body `{ body }`

### Auth (v1.2)
Floor is single-seller. Every `/api/v1` route needs `Authorization: Bearer <session token>` except the three public routes below; `/health` is also open.
- `GET /auth/status` (public) → `{ hasUsers: boolean }`. The web app shows "Create your account" when false, "Sign in" when true.
- `POST /auth/signup` (public) body `{ email, password }` (password 8 to 128 chars) → `201 { token, expiresAt, user: { id, email } }`. Works only while no user exists; afterwards `403 SIGNUP_CLOSED`.
- `POST /auth/login` (public) body `{ email, password }` → `{ token, expiresAt, user }`. Email is trimmed and lower-cased. Wrong email or password → `401 INVALID_CREDENTIALS` (same message for both). 5 failures per email in 15 minutes → `429 TOO_MANY_ATTEMPTS`.
- `GET /auth/me` → `{ user }`. `POST /auth/logout` → 204, invalidates that token.
- Missing, unknown or expired token → `401 UNAUTHENTICATED`.
- Passwords are stored as scrypt hashes. The session token is 32 random bytes; only its SHA-256 is stored. Sessions last 30 days.
- The API listens on `127.0.0.1` by default (`HOST` overrides) and CORS allows only `CORS_ORIGINS`, so a fresh install cannot be claimed from another machine or website before the owner signs up. A tunnel to `127.0.0.1:4000` is the way to reach it from a phone.
- A user row has a unique `slot = 'owner'`, so two racing signups cannot both succeed.
- `POST /webhooks/ebay` requires EITHER a session token OR the shared secret header `X-Floor-Webhook-Secret` (v1.4).

## Manual supplier (v1.3)

For wholesalers with no usable API (Alibaba, a CJ account without API access, any manufacturer). The seller types the catalog in and places each order by hand after the buyer has paid; Floor still gates margin, compliance and the daily cap, and still pushes tracking to eBay.

**Supplier kind.** `'manual'` is added to `SupplierKind` / `SUPPLIER_ALLOWLIST`. It is allowed in BOTH `mock` and `real` mode (it replaces the "only mock in mock mode" and "no mock in real mode" checks for this kind only). `POST /suppliers { supplier: 'manual' }` connects it (no credentials); label `Manual supplier (Alibaba, CJ, any wholesaler)`. There is no generic URL import and Floor never fetches the supplier link; it is stored and shown to the seller only.

**Manual products** are ordinary `Product` rows with `supplier: 'manual'`, so Discovery, listing creation, pricing, the compliance gate and `Product.handlingDays` all work unchanged. `handlingDays` is the seller's lead time (supplier processing plus transit to the buyer), so the existing `HANDLING_TIME_EXCEEDED` gate already blocks publishing when it exceeds the account `handlingTimeDays`. `supplierSku` is generated (`man_` + nanoid) and `warehouseCountry` is entered (default `CN`).
- Extra Product fields (all products; null/absent for others): `supplierUrl?: string` (https link to the supplier listing).
- `GET /manual-products` → `{ items: Product[], total }` (supplier === 'manual', newest first).
- `POST /manual-products` body `{ title (3..80 chars), description (min 1), images: string[] (1..12 https URLs), costCents (>0), shippingCents (>=0), stock (int >=0), handlingDays (int 1..60), warehouseCountry (2-letter, default 'CN'), supplierUrl? (https), brand?, categoryHint? }` → 201 Product. Requires a connected manual supplier, else `422 SUPPLIER_NOT_CONNECTED`.
- `PATCH /manual-products/:id` body: any subset of the same fields (not supplierSku). Changing `costCents`, `shippingCents` or `stock` runs the normal listing sweep for its listings (reprice or pause; same rules as `POST /listings/sync`, scoped to this product). Stock 0 pauses active listings (`pauseReason: 'out_of_stock'`).
- `DELETE /manual-products/:id` → 204; `422 PRODUCT_IN_USE` if any non-draft listing or any order references it; draft listings are deleted with it.
- The supplier sweep never overwrites manual products (there is no remote source of truth); `connectors.manualSupplier` reads the Product row.

**Order flow for manual products.** After the compliance gate and the ladder return `fulfil` and the daily spend cap allows it, the pipeline does NOT call a supplier. The order moves to the new status `awaiting_supplier` and nothing is written to the ledger yet. (A `queued` order drains into `awaiting_supplier` the same way; an approved `held` order does too.)
- `OrderStatus` gains `'awaiting_supplier'`. `GET /orders?status=awaiting_supplier` and the `/dashboard` counts include it; the spend cap counts the product's `costCents + shippingCents` once the order enters `awaiting_supplier`.
- `GET /orders/:id` adds, for manual orders only: `supplier: { kind: 'manual', url?: string, title: string, supplierSku: string }` and `maxSupplierCostCents` = the most the seller can pay for item + supplier shipping combined while net margin stays >= the account `pricingRule.floorPct` (computed with `maxSupplierCostForFloor` in core; never negative).
- `POST /orders/:id/supplier-quote` body `{ costCents, shippingCents }` → `{ netProfitCents, netMarginPct, ebayFeesCents, maxSupplierCostCents, meetsFloor: boolean }`. No state change. Only for `awaiting_supplier`.
- `POST /orders/:id/supplier-order` body `{ supplierOrderId (1..100 chars), costCents (>0), shippingCents (>=0), confirmBelowFloor?: boolean }`. Only when `status === 'awaiting_supplier'` (else `422 ORDER_NOT_AWAITING_SUPPLIER`). Recomputes margin with the numbers the seller actually paid. If `netMarginPct < floorPct` and `confirmBelowFloor !== true` → `422 BELOW_FLOOR` with `details: { maxSupplierCostCents, netMarginPct, netProfitCents }` and nothing changes. Otherwise the order becomes `ordered`, `supplierOrderId`, `supplierCostCents`, `supplierShippingCents`, `ebayFeesCents` and `netProfitCents` are stored, ledger entries `supplier_cost` and `supplier_shipping` are written (the `sale` and `ebay_fee` entries are written at the same time, as for automatic orders), and an `order.supplier_ordered` event records `{ confirmBelowFloor }`. Idempotent: a second call with the same `supplierOrderId` on an already-`ordered` order returns it unchanged; a different id → `409 SUPPLIER_ORDER_EXISTS`. (The one-supplier-order-per-eBay-order rule still holds.)
- `POST /orders/:id/tracking` body `{ trackingNumber (1..60), carrier (1..40) }`. Only when `status === 'ordered'` and the order's product is manual (else `422 TRACKING_NOT_MANUAL`). Sets tracking, moves the order to `shipped`, pushes tracking to eBay through the eBay connector exactly like automatic tracking (including the `shipped` buyer message and `order.shipped` event), and sets `payoutExpectedAt` as for automatic orders. Delivery is not detected automatically; `POST /orders/:id/delivered` (no body) moves `shipped` to `delivered` for manual orders only.
- `POST /orders/:id/decision` now also accepts `{ action: 'cancel' }` when `status === 'awaiting_supplier'` (cancels the eBay order via the connector as for held cancels; no ledger entries). `fulfil` is still only for `held`.
- Auto-cancel: the scheduler never cancels `awaiting_supplier` orders; instead `GET /dashboard` adds `awaitingSupplier: { count, oldestAt? }` so the UI can flag orders that are getting late.
- Events: `order.awaiting_supplier`, `order.supplier_ordered`, `order.delivered_manual`.

**Core.** `maxSupplierCostForFloor({ salePriceCents, buyerShippingCents, toolFeeCents, fees, floorPct }): Cents` (largest combined supplier cost+shipping with `meetsFloor`; exact, found by arithmetic or bounded search, never over by a cent). `ManualSupplierConnector` implements `SupplierConnector`: `getProduct` and `getStockAndPrice` read from an injected lookup, `placeOrder` throws `ManualSupplierError('MANUAL_ORDER')` (never called by the pipeline), `getTracking` returns null, `listCatalog` returns the manual products.

**Backend clarifications (v1.3 implementation).** (1) Product gains a non-exposed `createdAt` so `GET /manual-products` can order newest first; `PATCH` also accepts `null` to clear `supplierUrl`, `brand`, `categoryHint`, and runs the scoped sweep when cost, shipping, stock, lead time, brand, category, images or title change. (2) `supplier-quote` accepts `costCents >= 0`; `POST /orders/:id/delivered` answers `422 DELIVERY_NOT_MANUAL` for non-manual orders and `422 ORDER_NOT_SHIPPED` for other states (already `delivered` is a no-op). (3) `POST /orders/:id/tracking` sets `payoutExpectedAt` (+3 days, +30 for new sellers) and `delivered` recalculates it; `supplier-order` also sends the `order_confirmed` buyer message. (4) The cap counts `awaiting_supplier` orders' reserved cost+shipping (any age) on top of today's ledger spend, and `/dashboard` `today.supplierSpendCents` reports that same figure; `awaitingSupplier.oldestAt` is the oldest such order's `createdAt` (when the buyer paid). (5) Mock mode never auto-delivers manual orders. (6) Entering `awaiting_supplier` takes one unit of `Product.stock` (a lost race cancels the order `out_of_stock`); cancelling an `awaiting_supplier` order returns it; `POST /orders/:id/decision` cancel that loses a race answers `409 ORDER_CHANGED`. (7) Limits: every `*Cents` field <= 100000000, `stock` <= 1000000; larger values are `400 VALIDATION`. (8) A repeat `supplier-order` with the same id answers 200 for `ordered`, `shipped` and `delivered` orders.

**Web.** Suppliers card on onboarding and Settings gets "Manual supplier". New page `/products` ("Your products", nav item) lists manual products with add/edit/remove and a form for every field above (cost and shipping in dollars, stock, lead time in days, link). Orders gets a **To order** tab (`awaiting_supplier`). Order detail shows an "Order from your supplier" panel: supplier link, ship-to with copy buttons, "Pay at most $X" (`maxSupplierCostCents`), a live margin check as the seller types what they will pay (`supplier-quote`), then a form to record the supplier order id and actual costs (`supplier-order`); after that an "Add tracking" form; after shipped a "Mark delivered" button. Mock handlers mirror all of the above.

## Pipeline semantics (backend must implement exactly)

1. `paid` → `checking`: re-fetch supplier price/stock; compute margin with account fees.
2. Compliance gate re-run (supplier still allowed, listing not blocked).
3. Ladder: `netMarginPct >= pricingRule.floorPct` → fulfil (`within_tolerance`); anything below the floor, including a small profit or break-even, → `held`. There is no small-loss exception: `small_loss` is no longer produced (kept in the type for old orders) and `smallLossToleranceCents` is deprecated and ignored. Held with `holdDeadline = createdAt + handlingTimeDays*24h - 12h`. A scheduler cancels held orders past deadline (`no_decision`). Stock 0 with no backup → `cancelled` (`out_of_stock`).
4. Daily spend cap: if today's supplier spend + this cost > cap → `queued`; a scheduler drains the queue after midnight or when cap is raised.
5. `ordered`: supplier `placeOrder` called exactly once; store `supplierOrderId`, actual cost; ledger entries written; outbound `order_confirmed` message.
6. `shipped`: tracking from supplier → eBay `createShippingFulfillment` (mock: no-op) → `shipped` message.
7. `delivered` → `payoutExpectedAt` (mock: +3 days; new-seller accounts +30 days) → `payout` ledger entry when due.

## Mock mode behaviour

- Mock supplier: ~60 seeded products across 6 categories, US and CN warehouses, realistic cost/shipping; a `drift()` call randomly moves price ±15% and stock on ~10% of SKUs so sync has work to do. Includes 3 VeRO-trap products (brand in blocklist) and 2 with no images, so the compliance gate is visibly doing something.
- Mock eBay: listings get `ebayItemId = "mock-" + nanoid`; `simulate` creates orders; tracking appears ~30 s after `ordered` in a background job (configurable `MOCK_TRACKING_DELAY_MS`).

## Env

```
FLOOR_MODE=mock|real
DATABASE_URL=file:./dev.db
PORT=4000
EBAY_CLIENT_ID= EBAY_CLIENT_SECRET= EBAY_RU_NAME= EBAY_ENV=sandbox|production
EBAY_USER_TOKEN=                  # optional static sandbox token; used only when no OAuth tokens are stored
EBAY_FULFILLMENT_POLICY_ID= EBAY_PAYMENT_POLICY_ID= EBAY_RETURN_POLICY_ID=   # business policies (Account API / My eBay)
EBAY_MERCHANT_LOCATION_KEY=       # inventory location (createInventoryLocation)
EBAY_DEFAULT_CATEGORY_ID=         # leaf category id used for every listing
FLOOR_SECRET_KEY=                 # 32 random bytes, base64 or 64 hex (openssl rand -base64 32); encrypts eBay tokens
FLOOR_WEBHOOK_SECRET=             # optional; lets POST /webhooks/ebay be called with X-Floor-Webhook-Secret
WEB_ORIGIN=http://localhost:5173  # where the OAuth callback sends the browser (defaults to the first CORS origin)
EBAY_ORDER_POLL_MS=60000          # real mode: how often new eBay orders are imported
CJ_API_KEY= SPOCKET_API_KEY=
MOCK_TRACKING_DELAY_MS=30000
```

## Additive fields & endpoints (v1.1, backend-implemented)

Everything above still holds. The backend adds the following; the frontend may rely on them.

### Fields
- **Account**: `mode: 'mock' | 'real'` (from `FLOOR_MODE`), `newSeller: bool` (default false; PATCHable; switches payout delay to +30 days).
- **Product**: `handlingDays: number` (supplier handling time, used by the compliance gate).
- **Listing**: `floorPriceCents` (minimum price satisfying the account floor, from core `priceFloor`; recomputed on every sync), `description`.
- **Order**: `ebayFeesCents` (computed at `checking`, finalised at `ordered`), `deliveredAt?`.
- **Message**: `answered: boolean` (outbound messages are always `true`; inbound flips to `true` once a reply exists). `unansweredOnly` is applied server-side.
- **Dashboard**: `float.byOrder[].listingTitle`, `float.byOrder[].status`; `listings.ended`.
- **Ledger** totals: `payoutCents`.
- List endpoints (`/discovery`, `/listings`, `/orders`) also echo `page` and `pageSize`. `pageSize` is clamped to 200.
- Error responses may carry `error.details` (zod issues for `VALIDATION`, `{ floorPriceCents }` for `PRICE_BELOW_FLOOR`).

### Endpoint shapes
- `GET /orders/:id` → Order + `listing: { title }` + `events[]` + `messages[]` + `ledger[]`.
- `POST /listings/publish` → `{ published: Listing[], blocked: { id, compliance }[] }`.
- `POST /listings` → `201`. `POST /orders/simulate` → `201` with the order (+ `listing: { title }`), already run through the pipeline (`ordered`, `held`, `queued` or `cancelled`). Optional `salePriceCents` override.
- `POST /webhooks/ebay` body `{ ebayOrderId, listingId? | ebayItemId?, buyerName, shipTo, salePriceCents, buyerShippingCents?, createdAt? }` → `201 { duplicate: false, order }` or `200 { duplicate: true, order }` on replay.
- `POST /messages/inbound` body `{ orderId, body }` → `201` Message (classified `wismo | cancel | return | other`, with `suggestedReply`). Mock mode: lets the UI simulate a buyer message.
- `DELETE /suppliers/:id` → `204`.
- `GET /health` (no prefix) → `{ ok, mode }`.

### Error codes used
`NOT_FOUND`, `VALIDATION` (400), `BAD_REQUEST`, `PRICE_BELOW_FLOOR` (422), `LISTING_NOT_PUBLISHED`, `LISTING_NOT_EDITABLE`, `LISTING_NOT_ACTIVE`, `ORDER_NOT_HELD`, `SUPPLIER_NOT_ALLOWED`, `SUPPLIER_NOT_AVAILABLE`, `MOCK_ONLY` (all 422), `NOT_CONFIGURED` (501, real connectors without credentials).

### Sync behaviour notes
- `POST /listings/sync` also returns `checked` and `blocked`. The sweep re-runs the compliance gate on every active/paused listing, so a brand added to the blocklist after publish moves the listing to `blocked` (pauseReason = compliance code, eBay quantity set to 0) on the next sync.
- An order cancelled after the supplier order was placed (e.g. seller cancel) becomes `refunded` (not `cancelled`) with a `refund` ledger entry; `cancelled` always means nothing was spent.
- A held order approved with `decision: fulfil` re-checks supplier stock (0 -> `cancelled` out_of_stock) and the spend cap (over -> `queued`; the approval survives the drain) before `placeOrder`.
- Listings are repriced to the new target when the supplier cost moves, as long as the move is within 25% of the current price. Larger jumps are not applied automatically: the listing is paused `below_floor` (its `floorPriceCents` shows the new floor) until the price recovers or the seller edits it.
- Pause reasons: `below_floor`, `out_of_stock`, `manual` (set via `PATCH status: 'paused'`; never auto-resumed), or a compliance code when `status === 'blocked'`.

### Extra env
```
MOCK_DELIVERY_DELAY_MS=60000   # mock: shipped -> delivered after this delay
SYNC_INTERVAL_MS=300000        # price/stock sweep interval
SCHEDULER_TICK_MS=10000        # queue drain / hold expiry / tracking poll interval
SCHEDULER_DISABLED=1           # disable in-process jobs (always disabled under NODE_ENV=test)
CORS_ORIGINS=http://localhost:5173
```

## Real eBay adapter (v1.4)

`RealEbay` (`packages/core/src/connectors/real/`) talks to the eBay Sell APIs. `EBAY_ENV=sandbox` (default) uses `*.sandbox.ebay.com`, `production` uses `*.ebay.com`; `FLOOR_MODE=mock` is unchanged and never touches any of this. All network access goes through an injected `fetch` (tests use a fake).

**OAuth.** `POST /account/ebay/connect` creates a random 32-byte `state` (stored only as a SHA-256, valid 10 minutes, single use, bound to the account) and returns eBay's consent URL (scopes: base, `sell.inventory`, `sell.fulfillment`, `sell.finances`, `sell.account`, `commerce.identity.readonly`). eBay redirects the browser to the RuName's accepted URL, which must be `<api origin>/api/v1/account/ebay/callback`.
- `GET /account/ebay/callback?code=&state=` is the only unauthenticated route besides auth. The `state` is the only thing it trusts: unknown, malformed, expired or replayed state is `400 INVALID_STATE` and nothing is stored or requested. With a valid state it exchanges the code (`grant_type=authorization_code`, `redirect_uri` = RuName, HTTP Basic `clientId:clientSecret`, form-encoded), stores the tokens, sets `ebayConnected` and `ebayUsername` (Identity API, best effort), and redirects (302) to `<WEB_ORIGIN>/settings?ebay=connected`. A denied consent (`error=`) or failed exchange redirects with `ebay=denied` / `ebay=failed`; the state is consumed either way.
- Tokens live in `EbayCredential`, AES-256-GCM encrypted (`v1:<base64 iv|tag|ciphertext>`) with `FLOOR_SECRET_KEY`. The key must decode to exactly 32 bytes. If it is unset, connecting returns `501 NOT_CONFIGURED` and nothing is ever stored. Rotating the key requires reconnecting eBay.
- Access tokens (2 h) are refreshed automatically with the refresh token (`grant_type=refresh_token`, scopes omitted so the original consent applies) a minute before expiry and once after any 401, then the request is retried once. A refresh that eBay refuses, or an expired refresh token (about 18 months), raises `EbayReauthRequiredError`: the seller must reconnect. `EBAY_USER_TOKEN` is a fallback used only when no tokens are stored; it cannot be refreshed.
- Floor is single-seller: the token store serves the one credential row.

**Listing calls** (`sku` = the product's `supplierSku`; `ebayItemId` = the `listingId` returned by publish):
| Floor call | eBay |
|---|---|
| `createListing` | `PUT /sell/inventory/v1/inventory_item/{sku}` (`Content-Language: en-US`) -> `GET /offer?sku=` (reuse an existing offer, so a retry after a failed publish never duplicates) -> `POST /offer` -> `POST /offer/{offerId}/publish` -> `listingId` |
| `updateListing` | price and quantity: `POST /bulk_update_price_quantity`; title/description/images: `GET` then `PUT /inventory_item/{sku}`, and for a description also `GET` + `PUT /offer/{offerId}` |
| `setQuantity` | `POST /bulk_update_price_quantity` (0 keeps the listing live but out of stock) |
| `endListing` | `POST /offer/{offerId}/withdraw` |
| `createShippingFulfillment` | `GET /sell/fulfillment/v1/order/{orderId}` (for `lineItemId`s; a `FULFILLED` order is skipped so retries are safe) -> `POST .../shipping_fulfillment { lineItems, shippedDate, shippingCarrierCode, trackingNumber }` |
| `getPayoutSchedule` | `GET https://apiz.ebay.com/sell/finances/v1/seller_funds_summary`. Heuristic: funds on hold -> `{30, true}`, else `{3, false}` (eBay publishes no payout-delay field) |
| `listNewOrders(since)` | `GET /sell/fulfillment/v1/order?filter=creationdate:[since..],orderfulfillmentstatus:{NOT_STARTED\|IN_PROGRESS}&limit=200` (paged) |

`getOfferBySku(sku)` returns `{ offerId, sku, status, listingId? }` from `GET /offer?sku=` for the sku <-> offerId mapping. Because eBay's offer API is keyed by sku and Floor stores only the listing id, the connector resolves listing id -> sku through the database (`Listing -> Product.supplierSku`).

Required configuration for `createListing`: `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_DEFAULT_CATEGORY_ID`. Any that are missing are listed together in one `NOT_CONFIGURED` error (501) before any request is made. The seller must already be opted in to business policies and have created an inventory location.

**Things the adapter does NOT control.** Buyer shipping cost and handling time come from the fulfillment policy, not from Floor's `buyerShippingCents` / `handlingTimeDays`. Floor's margin math assumes the policy matches the account (free shipping, handling time <= `handlingTimeDays`); a mismatched policy silently changes real margin. Every listing uses the one default category.

**`sendBuyerMessage` is a documented no-op.** It logs and returns without throwing, so a failed notification never blocks the pipeline. Buyers get no automated messages in real mode; messages stay visible in Floor's own Messages screen. (Candidates for later: Trading API `AddMemberMessageAAQToPartner`, or the Commerce Message API `POST /commerce/message/v1/send_message`; neither could be verified as available to this app.)

**Order import.** In real mode the scheduler polls every `EBAY_ORDER_POLL_MS` (default 60 s), per account that has a credential. The cursor is `EbayCredential.ordersSyncedAt` (set to the connect time on first connect, so history is never imported), the window overlaps by 10 minutes, and the cursor only advances when the poll had no pipeline failures. Each order is mapped to the `POST /webhooks/ebay` body and goes through the same `intakeOrder` + `processOrder`, so it is idempotent on `ebayOrderId` (one supplier order per eBay order, duplicates are no-ops) and passes the compliance gate and margin engine like every other order. Mapping rules: `ebayOrderId` = REST `orderId`; item = `lineItems[0].legacyItemId` (matched to `Listing.ebayItemId`); sale price = `priceSubtotal` and buyer shipping = `deliveryCost`, each reduced by the absolute value of its discount line (never increased); amounts are parsed from decimal strings to integer cents without floats (more than two decimals round half up); only `PAID`, non-cancelled USD orders; **orders with more than one line item or quantity > 1 are skipped**, not guessed (recorded once as an `ebay.order_skipped` event with the reason). Orders for an item Floor has no listing for are ignored.

**Webhook.** `POST /webhooks/ebay` accepts a session bearer token OR `X-Floor-Webhook-Secret` equal to `FLOOR_WEBHOOK_SECRET` (constant-time compare; if no secret is configured the header never authenticates). Mock mode and existing session callers are unchanged.

**Known gaps.**
- TODO: `X-EBAY-SIGNATURE` verification is not implemented. The scheme itself is documented (base64 JSON header with `kid`/`alg`/`digest`/`signature`; public key from `GET /commerce/notification/v1/public_key/{kid}`; ECDSA over the raw body, SHA-1), but it signs eBay Notification API payloads (`metadata`/`notification` envelope), which is not this route's normalised body, and no sale/order topic was verified. Real order intake uses the poller above. Revisit if an order topic is adopted.
- Buyer messaging (above), multi-line and multi-quantity orders (above), and a Finances API sandbox host (`apiz.sandbox.ebay.com` is assumed by analogy; Finances may not be available in the sandbox).
- Carrier codes are passed to eBay as the supplier reports them; eBay expects its own `ShippingCarrierCodeType` values, so an unknown carrier may be rejected and the tracking push retried.
- eBay account-deletion notifications (a marketplace requirement for production keysets) are not handled.

## eBay listing basics setup (v1.5)

`POST /api/v1/account/ebay/setup` (session-authed) does the one-time eBay prerequisites for listing and returns the ids for the owner to paste into `apps/api/.env`. The Settings page has a card "Set up eBay listing basics" that calls it.

Body: `{ location: { addressLine1, city, stateOrProvince, postalCode, country: "US" }, categoryQuery?: string, shippingCarrierCode?: string, shippingServiceCode?: string }`. `country` must be `US` (everything is created for `EBAY_US`). The address is never invented or stored: it is sent to eBay as the ship-from location. The two optional shipping fields override the service on the fulfillment policy (default `USPS` / `USPSPriority`); eBay validates the pair and the sandbox accepts fewer codes than production.

Response `200`: `{ fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey, categorySuggestions: [{ categoryId, name }], envLines, reused: { fulfillmentPolicy, paymentPolicy, returnPolicy, location }, notes: string[] }`. `envLines` is five lines (`EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_MERCHANT_LOCATION_KEY`, and `EBAY_DEFAULT_CATEGORY_ID` set to the best suggestion, or a commented placeholder when there is none). **Floor does not write `.env` and stores none of these values**; it only returns them (an `ebay.setup` audit event records which pieces were reused and the location key). The five variables are read from the environment exactly as before.

Errors: `400 VALIDATION`; `409 EBAY_NOT_CONNECTED` (no stored OAuth tokens and no `EBAY_USER_TOKEN`); `409 EBAY_REAUTH_REQUIRED` (eBay refused a permission or the refresh token: reconnect eBay); `502 EBAY_API_ERROR` (eBay rejected a step; the message carries eBay's text). Mock mode needs no credentials and returns fixed demo ids (`6000000001`..`6000000003`, key `floor-default`, demo categories) with a note that nothing was created.

What it does against eBay (`RealEbay.setupListingBasics`, idempotent; names start with "Floor"):
1. `GET /sell/account/v1/program/get_opted_in_programs`; if `SELLING_POLICY_MANAGEMENT` is missing, `POST /program/opt_in {programType}`. An "already exists" answer (409 / error 25803) is fine. eBay says opt-in can take up to 24 hours; a note says so.
2. For each of fulfillment, payment and return: `GET /sell/account/v1/{fulfillment|payment|return}_policy?marketplace_id=EBAY_US`; reuse the policy with the exact Floor name, else any policy whose name starts with "Floor"; otherwise `POST` it. If the create fails with 400/409 (duplicate name or a racing run) it lists again and reuses.
   - Fulfillment `Floor - free shipping, ships in 3 days`: handling 3 `DAY`, one `DOMESTIC` `FLAT_RATE` service with `freeShipping: true`, `categoryTypes ALL_EXCLUDING_MOTORS_VEHICLES`.
   - Payment `Floor - immediate payment`: `immediatePay: true`, no payment methods listed (eBay managed payments).
   - Return `Floor - 30 day returns`: accepted, 30 `DAY`, `MONEY_BACK`, `returnShippingCostPayer: BUYER`.
3. Inventory location: `GET /sell/inventory/v1/location/floor-default`; if 404, `POST` it (`locationTypes: [WAREHOUSE]`, `merchantLocationStatus: ENABLED`, the supplied address). A create that races is reused.
4. With `categoryQuery`: `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US`, then `GET /commerce/taxonomy/v1/category_tree/{id}/get_category_suggestions?q=`; the first five `{ categoryId, categoryName }` are returned. eBay does not support suggestions in the sandbox (placeholder names), and a note says so.

Scopes: all calls use scopes already in `DEFAULT_SCOPES` (`sell.account`, `sell.inventory`, and the base `api_scope` for Taxonomy), so no reconnect is needed unless an older connection lacks one; in that case eBay answers 403 and the API returns `409 EBAY_REAUTH_REQUIRED` ("Reconnect eBay ...").

Web: after eBay redirects back with `?ebay=connected|denied|failed`, the app shows a toast once (also when the app then sends an unconnected account to onboarding) and removes the parameter.
