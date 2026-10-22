import type { Address, Cents, Supplier } from '../types.js';

/** A supplier catalog item as returned by a connector (before caching into Product). */
export interface SupplierProduct {
  supplier: Supplier;
  supplierSku: string;
  title: string;
  description: string;
  images: string[];
  costCents: Cents;
  shippingCents: Cents;
  stock: number;
  warehouseCountry: string;
  /** Days the supplier takes to hand the parcel to a carrier. */
  handlingDays: number;
  brand?: string;
  categoryHint?: string;
}

export interface StockAndPrice {
  supplierSku: string;
  costCents: Cents;
  shippingCents: Cents;
  stock: number;
}

export interface PlaceOrderInput {
  /** Caller-chosen key (eBay order id). Replays must return the same supplier order. */
  idempotencyKey: string;
  supplierSku: string;
  quantity: number;
  shipTo: Address;
  buyerName: string;
  now: Date;
}

export interface PlaceOrderResult {
  supplierOrderId: string;
  costCents: Cents;
  shippingCents: Cents;
}

export interface TrackingInfo {
  supplierOrderId: string;
  trackingNumber: string;
  carrier: string;
  shippedAt: string;
}

export interface ReturnRequest {
  supplierOrderId: string;
  reason: string;
}

export interface ReturnResult {
  rmaId: string;
  instructions: string;
}

export interface CatalogQuery {
  page: number;
  pageSize: number;
  q?: string;
}

export interface CatalogPage {
  items: SupplierProduct[];
  total: number;
}

export interface SupplierConnector {
  readonly supplier: Supplier;
  getProduct(supplierSku: string): Promise<SupplierProduct | null>;
  getStockAndPrice(skus: readonly string[]): Promise<StockAndPrice[]>;
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  /** Returns null until the supplier has shipped. `now` lets mocks stay pure. */
  getTracking(supplierOrderId: string, now: Date): Promise<TrackingInfo | null>;
  requestReturn(input: ReturnRequest): Promise<ReturnResult>;
  listCatalog(query: CatalogQuery): Promise<CatalogPage>;
  /** Optional: perturb prices/stock so sync has work to do (mock only). */
  drift?(rng?: () => number): { changed: string[] };
}

export interface EbayListingInput {
  sku: string;
  title: string;
  description: string;
  images: string[];
  priceCents: Cents;
  buyerShippingCents: Cents;
  quantity: number;
  handlingTimeDays: number;
}

export interface EbayListingRef {
  ebayItemId: string;
}

export interface EbayFulfillmentInput {
  ebayOrderId: string;
  trackingNumber: string;
  carrier: string;
  shippedAt: string;
}

export interface PayoutSchedule {
  /** Days from delivery (or shipment) until funds are available. */
  payoutDelayDays: number;
  /** Whether the account is under the new-seller funds hold. */
  newSellerHold: boolean;
}

/** An eBay order mapped to the shape `POST /webhooks/ebay` and the order poller feed to the pipeline. */
export interface NormalisedEbayOrder {
  /** The REST (Fulfillment API) order id; what `createShippingFulfillment` needs. */
  ebayOrderId: string;
  /** Legacy item id of the (single) line item = the listingId returned by publish. */
  ebayItemId: string;
  buyerName: string;
  shipTo: Address;
  salePriceCents: Cents;
  buyerShippingCents: Cents;
  createdAt: string;
}

/** An order `listNewOrders` could not map safely (multi-line, quantity > 1, non-USD, no address...). Never fulfilled blindly. */
export interface SkippedEbayOrder {
  ebayOrderId: string;
  reason: string;
}

export interface NewOrdersResult {
  orders: NormalisedEbayOrder[];
  skipped: SkippedEbayOrder[];
}

/** An ad (Promoted Listings Standard, cost per sale) for one listing. */
export interface EbayAdResult {
  campaignId: string;
  adId: string;
  /** The ad rate now on the ad: eBay charges this share of the sale price on each sale that comes through the ad. */
  ratePct: number;
}

export interface EbayConnector {
  createListing(input: EbayListingInput): Promise<EbayListingRef>;
  updateListing(ebayItemId: string, patch: Partial<EbayListingInput>): Promise<void>;
  endListing(ebayItemId: string): Promise<void>;
  setQuantity(ebayItemId: string, quantity: number): Promise<void>;
  createShippingFulfillment(input: EbayFulfillmentInput): Promise<void>;
  sendBuyerMessage(ebayOrderId: string, body: string): Promise<void>;
  getPayoutSchedule(): Promise<PayoutSchedule>;
  /** Real eBay only: paid, unshipped orders created at or after `since`. Mock mode creates orders via simulate instead. */
  listNewOrders?(since: Date): Promise<NewOrdersResult>;
  /** Promoted ads: make sure the listing has an ad at exactly this rate (find-or-create campaign, create or re-rate the ad). Idempotent. */
  promoteListing?(ebayItemId: string, ratePct: number): Promise<EbayAdResult>;
  /** Promoted ads: remove the listing's ad, if any. Idempotent. */
  unpromoteListing?(ebayItemId: string): Promise<void>;
}

/** Thrown by real connectors when the credentials they need are not configured. */
export class NotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED';
  constructor(public readonly connector: string, public readonly missing: readonly string[]) {
    super(`${connector} is not configured: missing ${missing.join(', ')}`);
    this.name = 'NotConfiguredError';
  }
}
