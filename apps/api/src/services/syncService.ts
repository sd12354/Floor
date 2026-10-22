import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Account } from '../generated/prisma/client.js';
import { writeEvent } from './audit.js';
import { refreshProducts } from './catalog.js';
import { accountPricing, gateProduct, loadBlockedBrands, marginAt, projectPrice } from './pricingService.js';

export interface SyncResult {
  repriced: number;
  paused: number;
  resumed: number;
  checked: number;
  blocked: number;
}

export interface SyncScope {
  /** Only sweep the listings of this product. */
  productId?: string;
  /** The caller already wrote a new cost/shipping to the product row (manual products), so treat the cost as moved. */
  costMoved?: boolean;
}

/** Largest automatic price move (relative to the current price) the sweep will make on a live listing. */
export const MAX_REPRICE_STEP_PCT = 0.25;

/**
 * One price/stock sweep for an account (or, with `scope.productId`, for the listings of one product):
 *  - refresh cost/stock for every active/paused listing's product
 *  - recompute floor + target; when the supplier cost moved, reprice to the new target as long as the
 *    move is within MAX_REPRICE_STEP_PCT (bigger jumps need a human: the listing is paused instead)
 *  - re-run the compliance gate (a brand added to the blocklist since publish blocks the listing)
 *  - pause when stock is 0 or the price is below the floor; resume when fixed (manual pauses untouched)
 *  - every transition writes an Event
 */
export async function runSync(db: Db, connectors: Connectors, account: Account, scope: SyncScope = {}): Promise<SyncResult> {
  const pricing = accountPricing(account);
  const listings = await db.listing.findMany({ where: { accountId: account.id, status: { in: ['active', 'paused'] }, ...(scope.productId ? { productId: scope.productId } : {}) }, include: { product: true } });
  const result: SyncResult = { repriced: 0, paused: 0, resumed: 0, checked: listings.length, blocked: 0 };
  if (listings.length === 0) return result;

  const fresh = await refreshProducts(db, connectors, listings.map((l) => l.product));
  const blockedBrands = await loadBlockedBrands(db);
  const now = new Date();

  for (const listing of listings) {
    const product = fresh.get(listing.productId) ?? listing.product;
    const compliance = gateProduct(product, pricing, blockedBrands, listing.title);
    if (!compliance.ok) {
      await db.listing.update({ where: { id: listing.id }, data: { status: 'blocked', pauseReason: compliance.code, lastSyncAt: now } });
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.blocked', payload: { compliance } });
      if (listing.ebayItemId) await connectors.ebay.updateListing(listing.ebayItemId, { quantity: 0 });
      result.blocked += 1;
      continue;
    }
    const proj = projectPrice(product, pricing, listing.buyerShippingCents);
    const costChanged = scope.costMoved === true || product.costCents !== listing.product.costCents || product.shippingCents !== listing.product.shippingCents;
    const manuallyPaused = listing.status === 'paused' && listing.pauseReason === 'manual';

    let priceCents = listing.priceCents;
    const stepOk = Math.abs(proj.priceCents - listing.priceCents) <= Math.round(listing.priceCents * MAX_REPRICE_STEP_PCT);
    const needsReprice = costChanged || listing.priceCents < proj.floorPriceCents;
    if (needsReprice && proj.priceCents !== listing.priceCents && stepOk) {
      priceCents = proj.priceCents;
      result.repriced += 1;
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.repriced', payload: { from: listing.priceCents, to: priceCents, costCents: product.costCents } });
    }

    const belowFloor = priceCents < proj.floorPriceCents;
    const outOfStock = product.stock <= 0;
    let status = listing.status;
    let pauseReason = listing.pauseReason;

    if (listing.status === 'active' && (belowFloor || outOfStock)) {
      status = 'paused';
      pauseReason = outOfStock ? 'out_of_stock' : 'below_floor';
      result.paused += 1;
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.paused', payload: { reason: pauseReason, priceCents, targetPriceCents: proj.priceCents, floorPriceCents: proj.floorPriceCents, stock: product.stock } });
    } else if (listing.status === 'paused' && !manuallyPaused && !belowFloor && !outOfStock) {
      status = 'active';
      pauseReason = null;
      result.resumed += 1;
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.resumed', payload: { priceCents, floorPriceCents: proj.floorPriceCents, stock: product.stock } });
    }

    await db.listing.update({
      where: { id: listing.id },
      data: {
        priceCents,
        floorPriceCents: proj.floorPriceCents,
        projectedMarginPct: marginAt(priceCents, product, pricing, listing.buyerShippingCents),
        status,
        pauseReason,
        lastSyncAt: now,
      },
    });
    if (listing.ebayItemId) {
      const quantity = status === 'active' ? Math.max(1, Math.min(listing.quantity, product.stock)) : 0;
      await connectors.ebay.updateListing(listing.ebayItemId, { priceCents, quantity });
    }
  }
  await writeEvent(db, { accountId: account.id, type: 'sync.completed', payload: { ...result, ...(scope.productId ? { productId: scope.productId } : {}) } });
  return result;
}
