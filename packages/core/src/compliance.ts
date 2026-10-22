import type { ComplianceResult, Supplier } from './types.js';

export const SUPPLIER_ALLOWLIST = ['mock', 'cjdropshipping', 'spocket', 'manual'] as const;
export type AllowedSupplier = (typeof SUPPLIER_ALLOWLIST)[number];

export function isAllowedSupplier(s: string): s is Supplier {
  return (SUPPLIER_ALLOWLIST as readonly string[]).includes(s);
}

/**
 * Seed blocklist of VeRO-heavy brands. Matched case-insensitively as whole words against
 * brand and title. Stored in the api's BlockedBrand table with source='seed'.
 */
export const SEED_BLOCKED_BRANDS: readonly string[] = [
  'Nike',
  'Adidas',
  'Apple',
  'Disney',
  'Lego',
  'Rolex',
  'Louis Vuitton',
  'Gucci',
  'Chanel',
  'Supreme',
  'Pokemon',
  'Nintendo',
  'Marvel',
  'Star Wars',
  'Harry Potter',
  'Ray-Ban',
  'Oakley',
  'Yeti',
  'Dyson',
  'Stanley',
  'Tiffany',
  'Hermes',
  'Prada',
  'Burberry',
  'Hello Kitty',
  'Funko',
  'Beats',
];

/** Category hints eBay restricts or that Floor refuses to dropship. */
export const RESTRICTED_CATEGORY_PATTERNS: readonly RegExp[] = [
  /\bmedical[\s-]?device/i,
  /\b(prescription|rx)\b/i,
  // "gun" alone is too broad (massage gun, glue gun, nail gun): require a firearm context word.
  /\b(weapons?|firearms?|handguns?|shotguns?|rifles?|pistols?|ammunition|ammo|silencers?|suppressors?|(?<!massage |glue |nail |heat |caulk |spray |staple |water |toy )gun\s+(parts?|magazines?|holsters?|barrels?|receivers?|kits?))\b/i,
  /\bknife\s+switchblade|\bswitchblade\b/i,
  /\brecalled?\b/i,
  /\b(tobacco|cigarette|cigar|vape|vaping|e-?liquid|nicotine)\b/i,
];

export interface ComplianceInput {
  supplier: string;
  brand?: string | null;
  title: string;
  categoryHint?: string | null;
  images: readonly string[];
  supplierHandlingDays: number;
  accountHandlingTimeDays: number;
  /** Blocked brand patterns (seed + VeRO notices). Plain strings, case-insensitive, whole-word. */
  blockedBrands: readonly string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a whole-word, case-insensitive matcher for a brand pattern (hyphens/spaces interchangeable). */
export function brandMatcher(pattern: string): RegExp {
  const flexible = escapeRegExp(pattern.trim()).replace(/[\s\\-]+/g, '[\\s-]*');
  return new RegExp(`(^|[^a-z0-9])${flexible}($|[^a-z0-9])`, 'i');
}

export function findBlockedBrand(text: string, blockedBrands: readonly string[]): string | null {
  for (const pattern of blockedBrands) {
    if (pattern.trim() === '') continue;
    if (brandMatcher(pattern).test(text)) return pattern;
  }
  return null;
}

export function findRestrictedCategory(text: string): string | null {
  for (const re of RESTRICTED_CATEGORY_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * Compliance gate. Every write to eBay or a supplier must pass this first.
 * Checks run in order: supplier allowlist, VeRO brand, restricted category, images, handling time.
 */
export function complianceGate(input: ComplianceInput): ComplianceResult {
  if (!isAllowedSupplier(input.supplier)) {
    return {
      ok: false,
      code: 'SUPPLIER_NOT_ALLOWED',
      detail: `Supplier "${input.supplier}" is not in the allowlist (${SUPPLIER_ALLOWLIST.join(', ')})`,
    };
  }

  const brandHit = findBlockedBrand(`${input.brand ?? ''} ${input.title}`, input.blockedBrands);
  if (brandHit) {
    return { ok: false, code: 'VERO_MATCH', detail: `Matches blocked brand "${brandHit}"` };
  }

  const categoryText = `${input.categoryHint ?? ''} ${input.title}`;
  const restricted = findRestrictedCategory(categoryText);
  if (restricted) {
    return { ok: false, code: 'RESTRICTED_CATEGORY', detail: `Restricted category term "${restricted}"` };
  }

  const images = input.images.filter((u) => typeof u === 'string' && u.trim() !== '');
  if (images.length === 0) {
    return { ok: false, code: 'NO_IMAGES', detail: 'Listing needs at least one image' };
  }

  if (input.supplierHandlingDays > input.accountHandlingTimeDays) {
    return {
      ok: false,
      code: 'HANDLING_TIME_EXCEEDED',
      detail: `Supplier handling ${input.supplierHandlingDays}d exceeds account handling time ${input.accountHandlingTimeDays}d`,
    };
  }

  return { ok: true };
}
