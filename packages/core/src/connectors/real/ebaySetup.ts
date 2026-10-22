import type { EbayHttp } from './ebayHttp.js';
import { EbayApiError, EbayReauthRequiredError } from './ebayTypes.js';

export const SETUP_NAMES = {
  fulfillment: 'Floor - free shipping, ships in 3 days',
  payment: 'Floor - immediate payment',
  return: 'Floor - 30 day returns',
  locationKey: 'floor-default',
} as const;

export interface EbaySetupLocation {
  addressLine1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  /** US only: the policies and category tree below are created for EBAY_US. */
  country: string;
}

export interface EbaySetupInput {
  location: EbaySetupLocation;
  /** Free text describing what will be sold; returns the top few eBay category suggestions. */
  categoryQuery?: string | undefined;
  /** Override the shipping service on the fulfillment policy (eBay validates the pair; the sandbox accepts fewer codes). */
  shippingCarrierCode?: string | undefined;
  shippingServiceCode?: string | undefined;
}

export interface CategorySuggestion {
  categoryId: string;
  name: string;
}

export interface EbaySetupResult {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
  categorySuggestions: CategorySuggestion[];
  /** Which pieces already existed and were reused rather than created. */
  reused: { fulfillmentPolicy: boolean; paymentPolicy: boolean; returnPolicy: boolean; location: boolean };
  /** Plain-words things the seller should know (opt-in delay, sandbox limits...). */
  notes: string[];
}

const MARKETPLACE = 'EBAY_US';
const ACCOUNT = '/sell/account/v1';
const CATEGORY_TYPES = [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }];
const PROGRAM = 'SELLING_POLICY_MANAGEMENT';
const MAX_SUGGESTIONS = 5;

type Kind = 'fulfillment' | 'payment' | 'return';
const KINDS: Record<Kind, { list: string; key: string; idField: string; collection: string }> = {
  fulfillment: { list: `${ACCOUNT}/fulfillment_policy`, key: 'fulfillmentPolicies', idField: 'fulfillmentPolicyId', collection: 'fulfillment' },
  payment: { list: `${ACCOUNT}/payment_policy`, key: 'paymentPolicies', idField: 'paymentPolicyId', collection: 'payment' },
  return: { list: `${ACCOUNT}/return_policy`, key: 'returnPolicies', idField: 'returnPolicyId', collection: 'return' },
};

interface PolicyRow {
  name?: string;
  [k: string]: unknown;
}

/** eBay answers a missing scope with 403; tell the seller to reconnect rather than showing a raw API error. */
function scopeHint(err: unknown): never {
  if (err instanceof EbayApiError && err.status === 403) {
    throw new EbayReauthRequiredError('eBay denied access (403): the connected token is missing a permission this setup needs. Reconnect eBay from Settings and approve every permission, then run setup again.');
  }
  throw err;
}

/**
 * One-time seller setup: opt in to business policies, find-or-create the three Floor policies and the inventory
 * location, and suggest categories. Idempotent: existing resources named "Floor ..." (or the fixed location key)
 * are reused, never duplicated. Writes nothing outside eBay.
 */
export async function runEbaySetup(http: EbayHttp, env: 'sandbox' | 'production', input: EbaySetupInput): Promise<EbaySetupResult> {
  const notes: string[] = [];
  try {
    const optedInNow = await ensureOptedIn(http);
    if (optedInNow) notes.push('We just opted your eBay account in to business policies. eBay can take up to 24 hours to finish that; if a policy step fails, try again later.');

    const fulfillment = await findOrCreate(http, 'fulfillment', SETUP_NAMES.fulfillment, {
      name: SETUP_NAMES.fulfillment,
      description: 'Created by Floor: free domestic shipping, handling time 3 business days or less.',
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      handlingTime: { value: 3, unit: 'DAY' },
      shippingOptions: [
        {
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [{ sortOrder: 1, shippingCarrierCode: input.shippingCarrierCode ?? 'USPS', shippingServiceCode: input.shippingServiceCode ?? 'USPSPriority', freeShipping: true }],
        },
      ],
    });
    const payment = await findOrCreate(http, 'payment', SETUP_NAMES.payment, {
      name: SETUP_NAMES.payment,
      description: 'Created by Floor: payment is taken at checkout.',
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      immediatePay: true,
    });
    const ret = await findOrCreate(http, 'return', SETUP_NAMES.return, {
      name: SETUP_NAMES.return,
      description: 'Created by Floor: 30 day returns, buyer pays return shipping.',
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: 'DAY' },
      refundMethod: 'MONEY_BACK',
      returnShippingCostPayer: 'BUYER',
    });
    const location = await ensureLocation(http, input.location);

    let categorySuggestions: CategorySuggestion[] = [];
    const q = input.categoryQuery?.trim();
    if (q) {
      categorySuggestions = await suggestCategories(http, q);
      if (env === 'sandbox') notes.push('eBay does not support category suggestions in the sandbox: the names below are placeholder text. Use the production keyset, or pick a leaf category id yourself.');
      else if (categorySuggestions.length === 0) notes.push('eBay returned no category suggestions for that text. Try a more specific product description.');
    }
    return {
      fulfillmentPolicyId: fulfillment.id,
      paymentPolicyId: payment.id,
      returnPolicyId: ret.id,
      merchantLocationKey: SETUP_NAMES.locationKey,
      categorySuggestions,
      reused: { fulfillmentPolicy: fulfillment.reused, paymentPolicy: payment.reused, returnPolicy: ret.reused, location: location.reused },
      notes,
    };
  } catch (err) {
    return scopeHint(err);
  }
}

/** True if this call opted the account in; false if it already was (including the 409 "already exists" race). */
async function ensureOptedIn(http: EbayHttp): Promise<boolean> {
  const r = await http.request<{ programs?: { programType?: string }[] }>({ method: 'GET', path: `${ACCOUNT}/program/get_opted_in_programs` });
  if ((r.json?.programs ?? []).some((p) => p.programType === PROGRAM)) return false;
  try {
    await http.request({ method: 'POST', path: `${ACCOUNT}/program/opt_in`, body: { programType: PROGRAM } });
    return true;
  } catch (err) {
    if (err instanceof EbayApiError && (err.status === 409 || err.errorIds.includes(25803))) return false;
    throw err;
  }
}

async function listPolicies(http: EbayHttp, kind: Kind): Promise<PolicyRow[]> {
  const k = KINDS[kind];
  const r = await http.request<Record<string, PolicyRow[] | undefined>>({ method: 'GET', path: k.list, query: { marketplace_id: MARKETPLACE }, allow: [204, 404] });
  return r.json?.[k.key] ?? [];
}

function pick(rows: PolicyRow[], kind: Kind, name: string): string | null {
  const idField = KINDS[kind].idField;
  const row = rows.find((p) => p.name === name) ?? rows.find((p) => typeof p.name === 'string' && p.name.startsWith('Floor'));
  const id = row?.[idField];
  return typeof id === 'string' ? id : null;
}

async function findOrCreate(http: EbayHttp, kind: Kind, name: string, body: Record<string, unknown>): Promise<{ id: string; reused: boolean }> {
  const existing = pick(await listPolicies(http, kind), kind, name);
  if (existing) return { id: existing, reused: true };
  try {
    const r = await http.request<Record<string, unknown>>({ method: 'POST', path: KINDS[kind].list, body });
    const id = r.json?.[KINDS[kind].idField];
    if (typeof id !== 'string') throw new EbayApiError(502, `eBay created the ${kind} policy but returned no id`);
    return { id, reused: false };
  } catch (err) {
    // "Policy already exists" (a duplicate name, or a race with another run): look it up again and reuse it.
    if (err instanceof EbayApiError && (err.status === 400 || err.status === 409)) {
      const again = pick(await listPolicies(http, kind), kind, name);
      if (again) return { id: again, reused: true };
    }
    throw err;
  }
}

async function ensureLocation(http: EbayHttp, a: EbaySetupLocation): Promise<{ reused: boolean }> {
  const path = `/sell/inventory/v1/location/${SETUP_NAMES.locationKey}`;
  const have = await http.request({ method: 'GET', path, allow: [404] });
  if (have.status !== 404) return { reused: true };
  try {
    await http.request({
      method: 'POST',
      path,
      body: {
        name: 'Floor default location',
        merchantLocationStatus: 'ENABLED',
        locationTypes: ['WAREHOUSE'],
        location: { address: { addressLine1: a.addressLine1, city: a.city, stateOrProvince: a.stateOrProvince, postalCode: a.postalCode, country: a.country } },
      },
    });
    return { reused: false };
  } catch (err) {
    if (err instanceof EbayApiError && (err.status === 409 || err.status === 400)) {
      const again = await http.request({ method: 'GET', path, allow: [404] });
      if (again.status !== 404) return { reused: true };
    }
    throw err;
  }
}

async function suggestCategories(http: EbayHttp, q: string): Promise<CategorySuggestion[]> {
  const tree = await http.request<{ categoryTreeId?: string }>({ method: 'GET', path: '/commerce/taxonomy/v1/get_default_category_tree_id', query: { marketplace_id: MARKETPLACE } });
  const treeId = tree.json?.categoryTreeId;
  if (!treeId) throw new EbayApiError(502, 'eBay returned no default category tree id');
  const r = await http.request<{ categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[] }>({
    method: 'GET',
    path: `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions`,
    query: { q },
    allow: [204],
  });
  return (r.json?.categorySuggestions ?? []).flatMap((s) => (s.category?.categoryId ? [{ categoryId: s.category.categoryId, name: s.category.categoryName ?? s.category.categoryId }] : [])).slice(0, MAX_SUGGESTIONS);
}
