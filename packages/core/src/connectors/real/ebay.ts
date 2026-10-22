import { centsToDecimal } from '../../money.js';
import {
  NotConfiguredError,
  type EbayConnector,
  type EbayFulfillmentInput,
  type EbayListingInput,
  type EbayListingRef,
  type NewOrdersResult,
  type PayoutSchedule,
} from '../types.js';
import { EbayAuth } from './ebayAuth.js';
import { EbayHttp } from './ebayHttp.js';
import { mapEbayOrders, type EbayOrder, type EbayOrderPage } from './ebayOrders.js';
import { runEbaySetup, type EbaySetupInput, type EbaySetupResult } from './ebaySetup.js';
import { EbayApiError, DEFAULT_SCOPES, type EbayEnv, type EbayTokens, type RealEbayConfig } from './ebayTypes.js';

export { DEFAULT_SCOPES, EbayApiError, EbayReauthRequiredError } from './ebayTypes.js';
export type { EbayTokens, FetchLike, RealEbayConfig, TokenStore } from './ebayTypes.js';

const INV = '/sell/inventory/v1';
const FUL = '/sell/fulfillment/v1';
const LANG = { 'Content-Language': 'en-US' } as const;
const ORDER_PAGE = 200;
const MAX_ORDER_PAGES = 10;

interface OfferRow {
  offerId?: string;
  sku?: string;
  status?: string;
  listing?: { listingId?: string };
}
export interface EbayOfferRef {
  offerId: string;
  sku: string;
  status: string;
  listingId?: string;
}

/**
 * Real eBay Sell API adapter (Inventory, Fulfillment, Finances, Identity). Sandbox unless env is 'production'.
 * Every network call goes through the injected `fetch`. Policies/location/category come from config and are only
 * demanded (NotConfiguredError) by the calls that need them.
 */
export class RealEbay implements EbayConnector {
  readonly baseUrl: string;
  private readonly env: EbayEnv;
  private readonly auth: EbayAuth;
  private readonly http: EbayHttp;
  private readonly offerCache = new Map<string, EbayOfferRef>();
  private readonly skuCache = new Map<string, string>();

  constructor(private readonly config: RealEbayConfig) {
    this.env = config.env === 'production' ? 'production' : 'sandbox';
    this.baseUrl = this.env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
    this.auth = new EbayAuth(config, this.env);
    this.http = new EbayHttp(this.auth, this.env, config.fetch ?? ((url, init) => fetch(url, init)));
  }

  private get marketplaceId(): string {
    return this.config.marketplaceId ?? 'EBAY_US';
  }

  /** The consent URL the api returns from POST /account/ebay/connect. `state` is echoed back to the callback. */
  authorizeUrl(state?: string, scopes: readonly string[] = DEFAULT_SCOPES): string {
    return this.auth.authorizeUrl(state, scopes);
  }

  exchangeCode(code: string): Promise<EbayTokens> {
    return this.auth.exchangeCode(code);
  }

  /** Best-effort seller username via the Identity API (needs commerce.identity.readonly, part of DEFAULT_SCOPES). */
  async getUsername(): Promise<string | null> {
    const r = await this.http.request<{ username?: string }>({ method: 'GET', host: 'apiz', path: '/commerce/identity/v1/user/' });
    return r.json?.username ?? null;
  }

  /** One-time seller setup (business policies, inventory location, category suggestions). Idempotent; see ebaySetup.ts. */
  setupListingBasics(input: EbaySetupInput): Promise<EbaySetupResult> {
    return runEbaySetup(this.http, this.env, input);
  }

  private requireListingConfig(): { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string; merchantLocationKey: string; categoryId: string } {
    const c = this.config;
    const missing: string[] = [];
    if (!c.fulfillmentPolicyId) missing.push('EBAY_FULFILLMENT_POLICY_ID');
    if (!c.paymentPolicyId) missing.push('EBAY_PAYMENT_POLICY_ID');
    if (!c.returnPolicyId) missing.push('EBAY_RETURN_POLICY_ID');
    if (!c.merchantLocationKey) missing.push('EBAY_MERCHANT_LOCATION_KEY');
    if (!c.defaultCategoryId) missing.push('EBAY_DEFAULT_CATEGORY_ID');
    if (missing.length > 0) throw new NotConfiguredError('RealEbay', missing);
    return {
      fulfillmentPolicyId: c.fulfillmentPolicyId as string,
      paymentPolicyId: c.paymentPolicyId as string,
      returnPolicyId: c.returnPolicyId as string,
      merchantLocationKey: c.merchantLocationKey as string,
      categoryId: c.defaultCategoryId as string,
    };
  }

  /** GET /offer?sku= : the offers for a SKU (empty when eBay answers 404 "no offer"). Refreshes the offerId cache. */
  async getOffersBySku(sku: string): Promise<EbayOfferRef[]> {
    const r = await this.http.request<{ offers?: OfferRow[] }>({ method: 'GET', path: `${INV}/offer`, query: { sku, marketplace_id: this.marketplaceId }, allow: [404] });
    const offers: EbayOfferRef[] = [];
    for (const o of r.json?.offers ?? []) {
      if (!o.offerId) continue;
      const ref: EbayOfferRef = { offerId: o.offerId, sku: o.sku ?? sku, status: o.status ?? 'UNKNOWN', ...(o.listing?.listingId ? { listingId: o.listing.listingId } : {}) };
      offers.push(ref);
      if (ref.listingId) {
        this.offerCache.set(ref.listingId, ref);
        this.skuCache.set(ref.listingId, sku);
      }
    }
    return offers;
  }

  /** The sku <-> offerId mapping, retrievable by sku. Prefers the published offer. */
  async getOfferBySku(sku: string): Promise<EbayOfferRef | null> {
    const offers = await this.getOffersBySku(sku);
    return offers.find((o) => o.status === 'PUBLISHED') ?? offers[0] ?? null;
  }

  private async offerFor(ebayItemId: string): Promise<EbayOfferRef> {
    const cached = this.offerCache.get(ebayItemId);
    if (cached) return cached;
    const sku = this.skuCache.get(ebayItemId) ?? (await this.config.resolveSku?.(ebayItemId)) ?? null;
    if (!sku) throw new Error(`RealEbay: cannot map listing ${ebayItemId} to a SKU (no resolveSku configured or listing unknown)`);
    const offers = await this.getOffersBySku(sku);
    const hit = offers.find((o) => o.listingId === ebayItemId);
    if (!hit) throw new EbayApiError(404, `RealEbay: no offer for sku ${sku} publishes listing ${ebayItemId}`);
    return hit;
  }

  async createListing(input: EbayListingInput): Promise<EbayListingRef> {
    const cfg = this.requireListingConfig();
    // 1. inventory item (idempotent PUT: replaces the record for this SKU)
    await this.http.request({
      method: 'PUT',
      path: `${INV}/inventory_item/${encodeURIComponent(input.sku)}`,
      headers: LANG,
      body: {
        condition: 'NEW',
        product: { title: input.title, description: input.description, imageUrls: input.images },
        availability: { shipToLocationAvailability: { quantity: input.quantity } },
      },
    });
    // 2. offer: reuse an existing one for this SKU so a retry after a failed publish does not create a duplicate
    const existing = await this.getOfferBySku(input.sku);
    if (existing?.status === 'PUBLISHED' && existing.listingId) return { ebayItemId: existing.listingId };
    const offerBody = {
      sku: input.sku,
      marketplaceId: this.marketplaceId,
      format: 'FIXED_PRICE',
      availableQuantity: input.quantity,
      categoryId: cfg.categoryId,
      listingDescription: input.description,
      listingDuration: 'GTC',
      listingPolicies: { fulfillmentPolicyId: cfg.fulfillmentPolicyId, paymentPolicyId: cfg.paymentPolicyId, returnPolicyId: cfg.returnPolicyId },
      merchantLocationKey: cfg.merchantLocationKey,
      pricingSummary: { price: { value: centsToDecimal(input.priceCents), currency: 'USD' } },
    };
    let offerId = existing?.offerId;
    if (offerId) {
      await this.http.request({ method: 'PUT', path: `${INV}/offer/${offerId}`, headers: LANG, body: offerBody });
    } else {
      const created = await this.http.request<{ offerId?: string }>({ method: 'POST', path: `${INV}/offer`, headers: LANG, body: offerBody });
      offerId = created.json?.offerId;
      if (!offerId) throw new EbayApiError(502, 'eBay createOffer returned no offerId');
    }
    // 3. publish -> listingId (the ebayItemId Floor stores)
    const pub = await this.http.request<{ listingId?: string }>({ method: 'POST', path: `${INV}/offer/${offerId}/publish` });
    const listingId = pub.json?.listingId;
    if (!listingId) throw new EbayApiError(502, 'eBay publishOffer returned no listingId');
    const ref: EbayOfferRef = { offerId, sku: input.sku, status: 'PUBLISHED', listingId };
    this.offerCache.set(listingId, ref);
    this.skuCache.set(listingId, input.sku);
    return { ebayItemId: listingId };
  }

  /**
   * Price and quantity go through bulk_update_price_quantity. Title/description/images re-PUT the inventory item
   * (GET first: the PUT replaces the whole record). buyerShippingCents and handlingTimeDays are NOT patchable here:
   * eBay takes them from the fulfillment policy, so changing them means changing that policy on eBay.
   */
  async updateListing(ebayItemId: string, patch: Partial<EbayListingInput>): Promise<void> {
    const offer = await this.offerFor(ebayItemId);
    if (patch.title !== undefined || patch.description !== undefined || patch.images !== undefined) {
      const path = `${INV}/inventory_item/${encodeURIComponent(offer.sku)}`;
      const cur = (await this.http.request<Record<string, unknown> & { product?: Record<string, unknown> }>({ method: 'GET', path })).json ?? {};
      const product = { ...(cur.product ?? {}), ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.images !== undefined ? { imageUrls: patch.images } : {}) };
      await this.http.request({ method: 'PUT', path, headers: LANG, body: { ...cur, product } });
      if (patch.description !== undefined) {
        // the offer carries its own listingDescription; keep it in step. PUT replaces the offer, so send back what GET returned minus read-only fields.
        const full = (await this.http.request<Record<string, unknown>>({ method: 'GET', path: `${INV}/offer/${offer.offerId}` })).json ?? {};
        const { offerId: _id, status: _s, listing: _l, ...writable } = full;
        void _id; void _s; void _l;
        await this.http.request({ method: 'PUT', path: `${INV}/offer/${offer.offerId}`, headers: LANG, body: { ...writable, listingDescription: patch.description } });
      }
    }
    if (patch.priceCents !== undefined || patch.quantity !== undefined) await this.bulkPriceQuantity(offer, patch.priceCents, patch.quantity);
  }

  private async bulkPriceQuantity(offer: EbayOfferRef, priceCents?: number, quantity?: number): Promise<void> {
    const r = await this.http.request<{ responses?: { statusCode?: number; errors?: { message?: string }[] }[] }>({
      method: 'POST',
      path: `${INV}/bulk_update_price_quantity`,
      body: {
        requests: [
          {
            sku: offer.sku,
            ...(quantity !== undefined ? { shipToLocationAvailability: { quantity } } : {}),
            offers: [{ offerId: offer.offerId, ...(quantity !== undefined ? { availableQuantity: quantity } : {}), ...(priceCents !== undefined ? { price: { value: centsToDecimal(priceCents), currency: 'USD' } } : {}) }],
          },
        ],
      },
    });
    const bad = (r.json?.responses ?? []).find((x) => (x.statusCode ?? 200) >= 300);
    if (bad) throw new EbayApiError(bad.statusCode ?? 500, `eBay bulk_update_price_quantity rejected the update: ${bad.errors?.map((e) => e.message).join('; ') ?? 'no detail'}`);
  }

  async setQuantity(ebayItemId: string, quantity: number): Promise<void> {
    await this.bulkPriceQuantity(await this.offerFor(ebayItemId), undefined, quantity);
  }

  /** Withdraw = end the listing; the offer and inventory item stay (so it can be republished). */
  async endListing(ebayItemId: string): Promise<void> {
    const offer = await this.offerFor(ebayItemId);
    await this.http.request({ method: 'POST', path: `${INV}/offer/${offer.offerId}/withdraw` });
    this.offerCache.delete(ebayItemId);
  }

  /** Looks the order up for its lineItemIds first (the REST call needs them); a FULFILLED order is left alone so retries are safe. */
  async createShippingFulfillment(input: EbayFulfillmentInput): Promise<void> {
    const orderPath = `${FUL}/order/${encodeURIComponent(input.ebayOrderId)}`;
    const order = (await this.http.request<EbayOrder>({ method: 'GET', path: orderPath })).json ?? {};
    if (order.orderFulfillmentStatus === 'FULFILLED') {
      this.config.log?.('eBay order already fulfilled; skipping tracking push', { ebayOrderId: input.ebayOrderId });
      return;
    }
    const lineItems = (order.lineItems ?? []).flatMap((l) => (l.lineItemId ? [{ lineItemId: l.lineItemId, quantity: l.quantity ?? 1 }] : []));
    if (lineItems.length === 0) throw new EbayApiError(502, `eBay order ${input.ebayOrderId} has no line items`);
    await this.http.request({
      method: 'POST',
      path: `${orderPath}/shipping_fulfillment`,
      body: { lineItems, shippedDate: new Date(input.shippedAt).toISOString(), shippingCarrierCode: input.carrier, trackingNumber: input.trackingNumber },
    });
  }

  /**
   * NO-OP BY DESIGN. The only buyer-messaging APIs are the Trading API (XML, legacy token) and the Commerce Message
   * API, whose availability to this app and OAuth scope could not be verified. This logs the message and returns;
   * it never throws, so a failed notification never blocks the order pipeline. The seller must message in eBay.
   */
  async sendBuyerMessage(ebayOrderId: string, body: string): Promise<void> {
    this.config.log?.('RealEbay.sendBuyerMessage is a no-op: message NOT delivered to the buyer', { ebayOrderId, length: body.length });
  }

  /**
   * Heuristic from GET /sell/finances/v1/seller_funds_summary (apiz host): funds on hold means a hold applies
   * (30 days, same as the new-seller rule), otherwise 3 days. eBay does not publish a "payout delay" field.
   */
  async getPayoutSchedule(): Promise<PayoutSchedule> {
    const r = await this.http.request<{ fundsOnHold?: { value?: string } }>({ method: 'GET', host: 'apiz', path: '/sell/finances/v1/seller_funds_summary', headers: { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }, allow: [204] });
    const held = Number(r.json?.fundsOnHold?.value ?? '0') > 0;
    return { payoutDelayDays: held ? 30 : 3, newSellerHold: held };
  }

  /** Paid, not-yet-shipped orders created at or after `since`, mapped to the webhook shape. Unmappable orders are returned in `skipped`. */
  async listNewOrders(since: Date): Promise<NewOrdersResult> {
    const filter = `creationdate:[${since.toISOString()}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`;
    const all: EbayOrder[] = [];
    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const r = await this.http.request<EbayOrderPage>({ method: 'GET', path: `${FUL}/order`, query: { filter, limit: String(ORDER_PAGE), offset: String(page * ORDER_PAGE) } });
      const orders = r.json?.orders ?? [];
      all.push(...orders);
      if (orders.length < ORDER_PAGE || all.length >= (r.json?.total ?? 0)) break;
    }
    return mapEbayOrders(all);
  }
}
