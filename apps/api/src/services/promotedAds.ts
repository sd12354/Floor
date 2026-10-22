import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Account, Listing } from '../generated/prisma/client.js';
import { writeEvent } from './audit.js';

type AdAccount = Pick<Account, 'id' | 'promotedAdsEnabled' | 'promotedAdRatePct'>;
type AdListing = Pick<Listing, 'id' | 'status' | 'ebayItemId' | 'promotedAdId' | 'promotedRatePct'>;

const sameRate = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/** The rate a listing should be promoted at right now, or null. Only live listings (already past the gate and above the floor) get an ad. */
export function desiredAdRate(account: AdAccount, listing: Pick<Listing, 'status' | 'ebayItemId'>): number | null {
  return account.promotedAdsEnabled && listing.status === 'active' && listing.ebayItemId ? account.promotedAdRatePct : null;
}

export function needsAdWork(account: AdAccount, listing: AdListing): boolean {
  return !sameRate(desiredAdRate(account, listing), listing.promotedRatePct);
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Bring one listing's eBay ad in line with the account settings: create or re-rate the ad, or remove it.
 * NEVER throws and never blocks the listing: a failure writes `listing.promote_failed` (or `listing.unpromote_failed`)
 * and leaves the stored ad state as it was, so the next sync sweep tries again. Returns whether the ad is now as wanted.
 * `listing` must carry the listing's CURRENT status (callers pass the freshly updated row).
 */
export async function reconcileAd(db: Db, connectors: Connectors, account: AdAccount, listing: AdListing): Promise<boolean> {
  const want = desiredAdRate(account, listing);
  if (sameRate(want, listing.promotedRatePct)) return true;
  const ebay = connectors.ebay;
  if (!listing.ebayItemId) return true;
  try {
    if (want !== null) {
      if (!ebay.promoteListing) return true;
      const ad = await ebay.promoteListing(listing.ebayItemId, want);
      await db.listing.update({ where: { id: listing.id }, data: { promotedAdId: ad.adId, promotedRatePct: ad.ratePct } });
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.promoted', payload: { ebayItemId: listing.ebayItemId, adId: ad.adId, ratePct: ad.ratePct, previousRatePct: listing.promotedRatePct } });
    } else {
      if (!ebay.unpromoteListing) return true;
      await ebay.unpromoteListing(listing.ebayItemId);
      await db.listing.update({ where: { id: listing.id }, data: { promotedAdId: null, promotedRatePct: null } });
      await writeEvent(db, { accountId: account.id, listingId: listing.id, type: 'listing.unpromoted', payload: { ebayItemId: listing.ebayItemId, previousRatePct: listing.promotedRatePct } });
    }
    return true;
  } catch (err) {
    const type = want !== null ? 'listing.promote_failed' : 'listing.unpromote_failed';
    await writeEvent(db, { accountId: account.id, listingId: listing.id, type, payload: { ebayItemId: listing.ebayItemId, ratePct: want, message: messageOf(err), willRetry: true } }).catch(() => undefined);
    return false;
  }
}

/** Live listings whose ad is not as the settings say (waiting for a retry). */
export async function countAdsPending(db: Db, account: AdAccount): Promise<number> {
  const rows = await db.listing.findMany({ where: { accountId: account.id, ebayItemId: { not: null }, status: { in: ['active', 'paused', 'blocked'] } }, select: { id: true, status: true, ebayItemId: true, promotedAdId: true, promotedRatePct: true } });
  return rows.filter((l) => needsAdWork(account, l)).length;
}
