import type { ComplianceResult } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import { notFound, unprocessable } from '../errors.js';
import type { Account, Listing } from '../generated/prisma/client.js';
import { asImages } from '../serialize.js';
import { id, writeEvent } from './audit.js';
import { reconcileAd } from './promotedAds.js';
import { accountPricing, gateProduct, generateTitle, loadBlockedBrands, marginAt, projectPrice } from './pricingService.js';

export interface CreateResult {
  created: Listing[];
  blocked: { productId: string; compliance: ComplianceResult }[];
}

/** Create draft listings for products. Compliance gate + pricing engine run here (no eBay write yet). */
export async function createDrafts(db: Db, account: Account, productIds: string[]): Promise<CreateResult> {
  const pricing = accountPricing(account);
  const blockedBrands = await loadBlockedBrands(db);
  const created: Listing[] = [];
  const blocked: CreateResult['blocked'] = [];
  for (const productId of [...new Set(productIds)]) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('Product', productId);
    const title = generateTitle(product.title, product.categoryHint);
    const compliance = gateProduct(product, pricing, blockedBrands, title);
    if (!compliance.ok) {
      blocked.push({ productId, compliance });
      continue;
    }
    const proj = projectPrice(product, pricing);
    const listing = await db.listing.create({
      data: {
        id: id('lst'),
        accountId: account.id,
        productId,
        title,
        description: product.description,
        priceCents: proj.priceCents,
        floorPriceCents: proj.floorPriceCents,
        buyerShippingCents: proj.buyerShippingCents,
        quantity: Math.min(5, Math.max(1, product.stock)),
        status: 'draft',
        projectedMarginPct: proj.projectedMarginPct,
      },
    });
    await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.created', payload: { priceCents: proj.priceCents, projectedMarginPct: proj.projectedMarginPct } });
    created.push(listing);
  }
  return { created, blocked };
}

export interface PatchInput {
  title?: string;
  priceCents?: number;
  status?: 'active' | 'paused';
}

export async function patchListing(db: Db, connectors: Connectors, account: Account, listingId: string, patch: PatchInput): Promise<Listing> {
  const listing = await db.listing.findFirst({ where: { id: listingId, accountId: account.id }, include: { product: true } });
  if (!listing) throw notFound('Listing', listingId);
  const pricing = accountPricing(account);
  const data: Partial<Pick<Listing, 'title' | 'priceCents' | 'status' | 'pauseReason' | 'projectedMarginPct'>> = {};

  if (patch.priceCents !== undefined) {
    if (patch.priceCents < listing.floorPriceCents) {
      throw unprocessable('PRICE_BELOW_FLOOR', `Price ${patch.priceCents} is below the floor ${listing.floorPriceCents}`, { floorPriceCents: listing.floorPriceCents });
    }
    data.priceCents = patch.priceCents;
    data.projectedMarginPct = marginAt(patch.priceCents, listing.product, pricing, listing.buyerShippingCents);
  }
  if (patch.title !== undefined) {
    const title = patch.title.slice(0, 80);
    // A renamed listing is still an eBay write: it must pass the gate (e.g. no blocked brand in the new title).
    const compliance = gateProduct(listing.product, pricing, await loadBlockedBrands(db), title);
    if (!compliance.ok) throw unprocessable(compliance.code, compliance.detail, { compliance });
    data.title = title;
  }
  if (patch.status !== undefined) {
    if (listing.status === 'blocked' || listing.status === 'ended') {
      throw unprocessable('LISTING_NOT_EDITABLE', `Listing is ${listing.status}`);
    }
    if (patch.status === 'active' && listing.status === 'draft') {
      throw unprocessable('LISTING_NOT_PUBLISHED', 'Publish the listing first');
    }
    data.status = patch.status;
    data.pauseReason = patch.status === 'paused' ? 'manual' : null;
  }

  const updated = await db.listing.update({ where: { id: listingId }, data });
  if (updated.ebayItemId) {
    await connectors.ebay.updateListing(updated.ebayItemId, {
      title: updated.title,
      priceCents: updated.priceCents,
      quantity: updated.status === 'active' ? updated.quantity : 0,
    });
  }
  await writeEvent(db, { accountId: account.id, listingId, type: 'listing.updated', payload: { ...patch } });
  // Pausing takes the ad off, resuming puts it back.
  if (patch.status !== undefined) await reconcileAd(db, connectors, account, updated);
  return (await db.listing.findUnique({ where: { id: listingId } })) ?? updated;
}

export interface PublishResult {
  published: Listing[];
  blocked: { id: string; compliance: ComplianceResult }[];
}

/** Activate drafts: compliance gate re-run, eBay createListing (mock assigns ebayItemId). */
export async function publishListings(db: Db, connectors: Connectors, account: Account, ids: string[]): Promise<PublishResult> {
  const pricing = accountPricing(account);
  const blockedBrands = await loadBlockedBrands(db);
  const published: Listing[] = [];
  const blocked: PublishResult['blocked'] = [];
  for (const listingId of [...new Set(ids)]) {
    const listing = await db.listing.findFirst({ where: { id: listingId, accountId: account.id }, include: { product: true } });
    if (!listing) throw notFound('Listing', listingId);
    if (listing.status === 'active') {
      published.push(listing);
      continue;
    }
    const compliance = gateProduct(listing.product, pricing, blockedBrands, listing.title);
    if (!compliance.ok) {
      const b = await db.listing.update({ where: { id: listingId }, data: { status: 'blocked', pauseReason: compliance.code } });
      await writeEvent(db, { accountId: account.id, listingId, type: 'listing.blocked', payload: { compliance } });
      blocked.push({ id: b.id, compliance });
      continue;
    }
    if (listing.priceCents < listing.floorPriceCents) {
      throw unprocessable('PRICE_BELOW_FLOOR', `Listing ${listingId} is priced below its floor`);
    }
    let ebayItemId = listing.ebayItemId;
    if (!ebayItemId) {
      const ref = await connectors.ebay.createListing({
        sku: listing.product.supplierSku,
        title: listing.title,
        description: listing.description,
        images: asImages(listing.product.images),
        priceCents: listing.priceCents,
        buyerShippingCents: listing.buyerShippingCents,
        quantity: listing.quantity,
        handlingTimeDays: account.handlingTimeDays,
      });
      ebayItemId = ref.ebayItemId;
    } else {
      await connectors.ebay.setQuantity(ebayItemId, listing.quantity);
    }
    const active = await db.listing.update({ where: { id: listingId }, data: { status: 'active', ebayItemId, pauseReason: null, lastSyncAt: new Date() } });
    await writeEvent(db, { accountId: account.id, listingId, type: 'listing.published', payload: { ebayItemId } });
    // The listing is live; a failed ad never undoes that (reconcileAd logs listing.promote_failed and the sync retries).
    await reconcileAd(db, connectors, account, active);
    published.push((await db.listing.findUnique({ where: { id: listingId } })) ?? active);
  }
  return { published, blocked };
}
