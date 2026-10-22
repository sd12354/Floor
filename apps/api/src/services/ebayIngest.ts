import type { NormalisedEbayOrder } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Account, Order } from '../generated/prisma/client.js';
import { writeEvent } from './audit.js';
import { intakeOrder, processOrder } from './orderPipeline.js';

export interface IngestResult {
  order: Order;
  created: boolean;
}

/**
 * Feed one normalised eBay order into the existing pipeline. Idempotent on ebayOrderId (intakeOrder); a duplicate
 * is returned untouched and never reprocessed. Returns null when no Floor listing matches the item.
 * The pipeline itself still runs the compliance gate and margin engine before any supplier write.
 */
export async function ingestEbayOrder(
  db: Db,
  connectors: Connectors,
  account: Account,
  o: NormalisedEbayOrder,
  ref: { listingId?: string | undefined } = {},
): Promise<IngestResult | null> {
  const listing = ref.listingId
    ? await db.listing.findFirst({ where: { id: ref.listingId, accountId: account.id } })
    : await db.listing.findFirst({ where: { ebayItemId: o.ebayItemId, accountId: account.id } });
  if (!listing) return null;
  const { order, created } = await intakeOrder(db, account, {
    ebayOrderId: o.ebayOrderId,
    listingId: listing.id,
    buyerName: o.buyerName,
    shipTo: o.shipTo,
    salePriceCents: o.salePriceCents,
    buyerShippingCents: o.buyerShippingCents,
    createdAt: new Date(o.createdAt),
  });
  if (!created) return { order, created };
  return { order: await processOrder(db, connectors, account, order.id), created };
}

export interface PollSummary {
  fetched: number;
  created: number;
  duplicates: number;
  unmatched: number;
  skipped: number;
  failed: number;
}

const OVERLAP_MS = 10 * 60_000;

/**
 * Real mode: ask eBay for orders since the cursor, ingest each, advance the cursor. The window overlaps the
 * previous poll on purpose; duplicates are no-ops. The cursor only moves when the whole poll succeeded for eBay's side;
 * a single order failing in the pipeline is recorded and retried next poll (the order row exists, drainQueue also re-runs it).
 */
export async function pollEbayOrders(db: Db, connectors: Connectors, account: Account, now = new Date()): Promise<PollSummary | null> {
  if (connectors.mode !== 'real' || !connectors.ebay.listNewOrders) return null;
  const cred = await db.ebayCredential.findUnique({ where: { accountId: account.id } });
  if (!cred) return null;
  const { orders, skipped } = await connectors.ebay.listNewOrders(new Date(cred.ordersSyncedAt.getTime() - OVERLAP_MS));
  const summary: PollSummary = { fetched: orders.length + skipped.length, created: 0, duplicates: 0, unmatched: 0, skipped: skipped.length, failed: 0 };
  if (skipped.length > 0) {
    // Record each unsupported order once, not on every poll (JSON-path filters differ between SQLite and Postgres, so dedupe in JS).
    const prior = await db.event.findMany({ where: { accountId: account.id, type: 'ebay.order_skipped' }, orderBy: { at: 'desc' }, take: 1000 });
    const seen = new Set(prior.map((e) => (e.payload as { ebayOrderId?: string } | null)?.ebayOrderId));
    for (const s of skipped) {
      if (!seen.has(s.ebayOrderId)) await writeEvent(db, { accountId: account.id, type: 'ebay.order_skipped', payload: { ebayOrderId: s.ebayOrderId, reason: s.reason } });
    }
  }
  for (const o of orders) {
    try {
      const r = await ingestEbayOrder(db, connectors, account, o);
      if (!r) summary.unmatched += 1;
      else if (r.created) summary.created += 1;
      else summary.duplicates += 1;
    } catch (err) {
      summary.failed += 1;
      await writeEvent(db, { accountId: account.id, type: 'ebay.order_failed', payload: { ebayOrderId: o.ebayOrderId, error: err instanceof Error ? err.message : 'unknown' } });
    }
  }
  if (summary.failed === 0) await db.ebayCredential.update({ where: { accountId: account.id }, data: { ordersSyncedAt: now } });
  return summary;
}
