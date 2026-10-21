import {
  complianceGate,
  computeMargin,
  derivePrice,
  priceFloor,
  SEED_BLOCKED_BRANDS,
  SUPPLIER_BOILERPLATE,
  type ComplianceResult,
  type FeeConfig,
  type PricingRule,
} from '@floor/core';
import type { Db } from '../db/client.js';
import type { Account, Product } from '../generated/prisma/client.js';
import { asFees, asImages, asPricingRule } from '../serialize.js';

export interface AccountPricing {
  rule: PricingRule;
  fees: FeeConfig;
  handlingTimeDays: number;
  toolFeeCents: number;
}

export function accountPricing(account: Account): AccountPricing {
  return { rule: asPricingRule(account.pricingRule), fees: asFees(account.fees), handlingTimeDays: account.handlingTimeDays, toolFeeCents: 0 };
}

/** Load blocked brand patterns (seed + VeRO notices). Falls back to the core seed if the table is empty. */
export async function loadBlockedBrands(db: Db): Promise<string[]> {
  const rows = await db.blockedBrand.findMany({ select: { pattern: true } });
  return rows.length > 0 ? rows.map((r) => r.pattern) : [...SEED_BLOCKED_BRANDS];
}

export function gateProduct(product: Product, pricing: AccountPricing, blockedBrands: readonly string[], title = product.title): ComplianceResult {
  return complianceGate({
    supplier: product.supplier,
    brand: product.brand,
    title,
    categoryHint: product.categoryHint,
    images: asImages(product.images),
    supplierHandlingDays: product.handlingDays,
    accountHandlingTimeDays: pricing.handlingTimeDays,
    blockedBrands,
  });
}

export interface PriceProjection {
  priceCents: number;
  floorPriceCents: number;
  buyerShippingCents: number;
  projectedMarginPct: number;
}

/**
 * Derive list price for a product. Buyer shipping is 0 (free shipping) and the supplier's shipping
 * is folded into the price; eBay buyers convert better on free shipping.
 */
export function projectPrice(product: Product, pricing: AccountPricing, buyerShippingCents = 0): PriceProjection {
  const base = {
    supplierCostCents: product.costCents,
    supplierShippingCents: product.shippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
    buyerShippingCents,
  };
  const priceCents = derivePrice({ ...base, rule: pricing.rule });
  const floorPriceCents = priceFloor({ ...base, floorPct: pricing.rule.floorPct });
  return { priceCents, floorPriceCents, buyerShippingCents, projectedMarginPct: marginAt(priceCents, product, pricing, buyerShippingCents) };
}

export function marginAt(priceCents: number, product: Pick<Product, 'costCents' | 'shippingCents'>, pricing: AccountPricing, buyerShippingCents = 0): number {
  return computeMargin({
    salePriceCents: priceCents,
    buyerShippingCents,
    supplierCostCents: product.costCents,
    supplierShippingCents: product.shippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
  }).netMarginPct;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'with', 'for', 'of', 'to', 'in', 'on', 'from', 'our', 'item']);

/**
 * "AI-ish" title generator: strips supplier boilerplate, dedupes words, leads with the keywords
 * (first 4 content words), keeps the rest in order, truncates at 80 chars on a word boundary.
 */
export function generateTitle(rawTitle: string, categoryHint?: string | null): string {
  let t = rawTitle;
  for (const b of SUPPLIER_BOILERPLATE) t = t.replace(new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  t = t.replace(/[^\w\s&%.\-/"']/g, ' ').replace(/\s+/g, ' ').trim();
  const seen = new Set<string>();
  const words = t.split(' ').filter((w) => {
    const k = w.toLowerCase();
    if (w === '' || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const content = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const lead = content.slice(0, 4);
  const rest = words.filter((w) => !lead.includes(w));
  let title = [...lead, ...rest].join(' ');
  if (categoryHint && title.length + categoryHint.length + 3 <= 80 && !title.toLowerCase().includes(categoryHint.toLowerCase())) {
    title = `${title} - ${categoryHint}`;
  }
  if (title.length > 80) {
    title = title.slice(0, 80);
    const cut = title.lastIndexOf(' ');
    if (cut > 40) title = title.slice(0, cut);
  }
  return title.trim();
}
