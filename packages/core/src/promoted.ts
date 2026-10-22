import type { Pct } from './types.js';

/**
 * eBay Promoted Listings Standard ("general" strategy, cost per sale) ad-rate bounds.
 * eBay's seller help pages state 2% to 100% on the US/AU/DE sites; the Marketing API reference text says 1.0 to 100.0.
 * We take the stricter minimum so a rate Floor accepts is one eBay accepts on either reading.
 * Max is capped at 100%; the margin engine pauses anything that cannot clear the floor long before that.
 */
export const MIN_AD_RATE_PCT: Pct = 0.02;
export const MAX_AD_RATE_PCT: Pct = 1;
/** Rate Floor uses when the seller switches promoted ads on without choosing one. */
export const DEFAULT_AD_RATE_PCT: Pct = MIN_AD_RATE_PCT;

/** eBay takes the ad rate as a percent string with one decimal ("2.5"), so Floor rates are multiples of 0.001. */
export function normalizeAdRate(ratePct: Pct): Pct {
  if (!Number.isFinite(ratePct)) throw new RangeError(`Ad rate must be a number, got ${ratePct}`);
  const rounded = Math.round(ratePct * 1000) / 1000;
  if (rounded < MIN_AD_RATE_PCT || rounded > MAX_AD_RATE_PCT) {
    throw new RangeError(`Ad rate must be between ${MIN_AD_RATE_PCT * 100}% and ${MAX_AD_RATE_PCT * 100}%, got ${ratePct * 100}%`);
  }
  return rounded;
}

/** The Marketing API `bidPercentage` string for a Floor rate: 0.025 -> "2.5". */
export function bidPercentageString(ratePct: Pct): string {
  return (Math.round(ratePct * 1000) / 10).toFixed(1);
}
