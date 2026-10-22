import type { Cents, FeeConfig, MarginInput, MarginResult, Pct, PricingRule } from '@/api/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Integer cents → "$12.34". Negative values keep the sign: "-$3.00". */
export function formatCents(cents: Cents | undefined | null, opts: { signed?: boolean; whole?: boolean } = {}): string {
  if (cents === undefined || cents === null || Number.isNaN(cents)) return '—';
  const fmt = opts.whole ? usdWhole : usd;
  const abs = fmt.format(Math.abs(cents) / 100);
  if (cents < 0) return `-${abs}`;
  return opts.signed && cents > 0 ? `+${abs}` : abs;
}

/** Contract upper bounds (CONTRACT.md → Manual supplier): money in cents, stock in units. */
export const MAX_MONEY_CENTS = 100_000_000;
export const MAX_STOCK = 1_000_000;

/**
 * What a person typed into a dollar box → integer cents, or null if it is not a whole number of cents.
 * Parses the digits as text, never through a float, so "19.99" is exactly 1999. Accepts a leading "$" and spaces;
 * commas only as proper thousands groups ("1,250.50" yes; "12,50", ",5" and "1,25,0" no).
 */
export function parseCents(text: string): Cents | null {
  const t = text.trim().replace(/^\$/, '').trim();
  const m = /^(\d{1,9}|\d{1,3}(?:,\d{3})+)(?:\.(\d{0,2}))?$/.exec(t);
  if (!m || (m[1] ?? '').length > 13) return null;
  return Number((m[1] ?? '').replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 0.136 → "13.6%". */
export function formatPct(pct: Pct | undefined | null, digits = 1): string {
  if (pct === undefined || pct === null || Number.isNaN(pct)) return '—';
  return `${(pct * 100).toFixed(digits)}%`;
}

export type MarginState = 'good' | 'thin' | 'below';

/** ≥ target → good (green); floor..target → thin (amber); < floor → below (red). */
export function marginState(pct: Pct, rule: Pick<PricingRule, 'floorPct' | 'targetPct'>): MarginState {
  if (pct >= rule.targetPct) return 'good';
  if (pct >= rule.floorPct) return 'thin';
  return 'below';
}

export const marginLabel: Record<MarginState, string> = {
  good: 'On target',
  thin: 'Above floor',
  below: 'Below floor',
};

export const marginColorClass: Record<MarginState, string> = {
  good: 'text-green',
  thin: 'text-amber',
  below: 'text-floor',
};

export const marginBgClass: Record<MarginState, string> = {
  good: 'bg-green',
  thin: 'bg-amber',
  below: 'bg-floor',
};

/** Round half up to integer cents (matches @floor/core roundHalfUp; Math.round differs on negatives). */
const roundHalfUp = (v: number) => (v < 0 ? -1 : 1) * Math.floor(Math.abs(v) + 0.5);

/** Effective variable fee rate: (FVF - store) x (1 - top rated) + below standard + promoted, as in @floor/core. */
export function effectiveVariablePct(f: FeeConfig): Pct {
  return Math.max(0, f.finalValueFeePct - f.storeDiscountPct) * (1 - f.topRatedDiscountPct) + f.belowStandardSurchargePct + f.promotedPct;
}

const perOrderFee = (gross: Cents, f: FeeConfig) => (gross <= 1000 ? Math.min(f.perOrderFeeCents, 30) : f.perOrderFeeCents);

/** Mirrors @floor/core's margin engine so live previews agree with the API to the cent. */
export function computeMargin(input: MarginInput): MarginResult {
  const gross = input.salePriceCents + input.buyerShippingCents;
  const ebayFeesCents = roundHalfUp(gross * effectiveVariablePct(input.fees)) + perOrderFee(gross, input.fees);
  const netProfitCents =
    gross - ebayFeesCents - input.supplierCostCents - input.supplierShippingCents - input.toolFeeCents;
  const netMarginPct = gross > 0 ? netProfitCents / gross : 0;
  return { ebayFeesCents, netProfitCents, netMarginPct };
}

export function applyRounding(cents: Cents, roundTo: PricingRule['roundTo']): Cents {
  if (roundTo === 'none') return cents;
  const ending = roundTo === '0.99' ? 99 : 95;
  const dollars = Math.floor(cents / 100);
  const candidate = dollars * 100 + ending;
  return candidate >= cents ? candidate : candidate + 100;
}

/**
 * Smallest sale price (free shipping) that nets at least `targetPct`, then rounded up per rule.
 * Solves the continuous price, then walks to the exact integer cent so the fee step ($0.30 at or
 * below $10) and fee rounding are honoured. Returns 0 when the target is unreachable.
 */
export function priceForTarget(
  supplierCostCents: Cents,
  supplierShippingCents: Cents,
  fees: FeeConfig,
  rule: PricingRule,
): Cents {
  const denom = 1 - effectiveVariablePct(fees) - rule.targetPct;
  if (denom <= 0) return 0;
  const cost = supplierCostCents + supplierShippingCents;
  const at = (p: Cents) => computeMargin({ salePriceCents: p, buyerShippingCents: 0, supplierCostCents, supplierShippingCents, toolFeeCents: 0, fees }).netMarginPct;
  let price = Math.max(1, Math.ceil((cost + fees.perOrderFeeCents) / denom) - 2);
  let guard = 0;
  while (at(price) < rule.targetPct && guard++ < 1000) price += 1;
  while (price > 1 && at(price - 1) >= rule.targetPct && guard++ < 2000) price -= 1;
  return applyRounding(price, rule.roundTo);
}

export function formatDate(iso: string | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
}

export function formatDateTime(iso: string | undefined): string {
  return formatDate(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
