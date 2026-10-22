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
- `POST /account/ebay/connect` → in mock mode marks connected with `ebayUsername: "demo_seller"`; in real mode returns `{ authorizeUrl }`
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
