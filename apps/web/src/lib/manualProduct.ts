import type { ManualProductInput, ManualProductPatch, Product } from '@/api/types';
import { MAX_MONEY_CENTS, MAX_STOCK, parseCents } from './money';

/** Everything the product form holds, as the text people typed. Converted to the contract's shape by `toInput`. */
export interface ProductDraft {
  title: string;
  description: string;
  /** One URL per line. */
  images: string;
  cost: string;
  shipping: string;
  stock: string;
  handlingDays: string;
  warehouseCountry: string;
  supplierUrl: string;
  brand: string;
  categoryHint: string;
}

export type DraftField = keyof ProductDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

export const emptyDraft: ProductDraft = {
  title: '', description: '', images: '', cost: '', shipping: '', stock: '', handlingDays: '', warehouseCountry: 'CN', supplierUrl: '', brand: '', categoryHint: '',
};

/** Order the fields appear in the form, so focus can jump to the first one that is wrong. */
export const fieldOrder: DraftField[] = ['title', 'description', 'images', 'cost', 'shipping', 'stock', 'handlingDays', 'warehouseCountry', 'supplierUrl', 'brand', 'categoryHint'];

export const parseImageLines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

export function isHttpsUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

const wholeNumber = (text: string): number | null => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/** Mirrors the ranges in CONTRACT.md → Manual supplier. The API stays the authority; this saves a round trip. */
export function validateDraft(d: ProductDraft): DraftErrors {
  const e: DraftErrors = {};
  const title = d.title.trim();
  if (title.length < 3 || title.length > 80) e.title = 'Use 3 to 80 characters.';
  if (!d.description.trim()) e.description = 'Add a description. It becomes the body of your eBay listing.';

  const images = parseImageLines(d.images);
  if (images.length < 1) e.images = 'Add at least one image URL.';
  else if (images.length > 12) e.images = `Use at most 12 images (you have ${images.length}).`;
  else {
    const bad = images.findIndex((u) => !isHttpsUrl(u));
    if (bad >= 0) e.images = `Image ${bad + 1} must be a full https:// link.`;
  }

  const cost = parseCents(d.cost);
  if (cost === null) e.cost = 'Enter a dollar amount, like 12.50.';
  else if (cost <= 0) e.cost = 'Cost must be more than $0.00.';
  else if (cost > MAX_MONEY_CENTS) e.cost = 'Cost can be at most $1,000,000.00.';

  const ship = parseCents(d.shipping);
  if (ship === null) e.shipping = 'Enter a dollar amount. Use 0 if shipping is free.';
  else if (ship > MAX_MONEY_CENTS) e.shipping = 'Shipping can be at most $1,000,000.00.';

  const stock = wholeNumber(d.stock);
  if (stock === null) e.stock = 'Enter a whole number, 0 or more.';
  else if (stock > MAX_STOCK) e.stock = 'Stock can be at most 1,000,000.';

  const days = wholeNumber(d.handlingDays);
  if (days === null || days < 1 || days > 60) e.handlingDays = 'Enter a whole number of days from 1 to 60.';

  if (!/^[A-Za-z]{2}$/.test(d.warehouseCountry.trim())) e.warehouseCountry = 'Use a 2-letter country code, like CN or US.';

  if (d.supplierUrl.trim() && !isHttpsUrl(d.supplierUrl.trim())) e.supplierUrl = 'Must be a full https:// link, or leave it blank.';
  return e;
}

/** Only call after `validateDraft` returned no errors. */
export function toInput(d: ProductDraft): ManualProductInput {
  const input: ManualProductInput = {
    title: d.title.trim(),
    description: d.description.trim(),
    images: parseImageLines(d.images),
    costCents: parseCents(d.cost) ?? 0,
    shippingCents: parseCents(d.shipping) ?? 0,
    stock: wholeNumber(d.stock) ?? 0,
    handlingDays: wholeNumber(d.handlingDays) ?? 0,
    warehouseCountry: d.warehouseCountry.trim().toUpperCase(),
  };
  if (d.supplierUrl.trim()) input.supplierUrl = d.supplierUrl.trim();
  if (d.brand.trim()) input.brand = d.brand.trim();
  if (d.categoryHint.trim()) input.categoryHint = d.categoryHint.trim();
  return input;
}

const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export function draftFromProduct(p: Product): ProductDraft {
  return {
    title: p.title, description: p.description, images: p.images.join('\n'), cost: dollars(p.costCents), shipping: dollars(p.shippingCents), stock: String(p.stock),
    handlingDays: String(p.handlingDays), warehouseCountry: p.warehouseCountry, supplierUrl: p.supplierUrl ?? '', brand: p.brand ?? '', categoryHint: p.categoryHint ?? '',
  };
}

/**
 * The fields that changed, for PATCH. Sending only changes matters: cost, shipping and stock trigger a listing sweep on the server.
 * An optional field the seller emptied is sent as `null`, which the API treats as "clear it".
 */
export function diffInput(original: Product, next: ManualProductInput): ManualProductPatch {
  const out: ManualProductPatch = {};
  if (original.title !== next.title) out.title = next.title;
  if (original.description !== next.description) out.description = next.description;
  if (JSON.stringify(original.images) !== JSON.stringify(next.images)) out.images = next.images;
  if (original.costCents !== next.costCents) out.costCents = next.costCents;
  if (original.shippingCents !== next.shippingCents) out.shippingCents = next.shippingCents;
  if (original.stock !== next.stock) out.stock = next.stock;
  if (original.handlingDays !== next.handlingDays) out.handlingDays = next.handlingDays;
  if (original.warehouseCountry !== next.warehouseCountry) out.warehouseCountry = next.warehouseCountry;
  if ((original.supplierUrl ?? '') !== (next.supplierUrl ?? '')) out.supplierUrl = next.supplierUrl ?? null;
  if ((original.brand ?? '') !== (next.brand ?? '')) out.brand = next.brand ?? null;
  if ((original.categoryHint ?? '') !== (next.categoryHint ?? '')) out.categoryHint = next.categoryHint ?? null;
  return out;
}
