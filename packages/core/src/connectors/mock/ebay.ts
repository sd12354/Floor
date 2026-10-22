import type {
  EbayAdResult,
  EbayConnector,
  EbayFulfillmentInput,
  EbayListingInput,
  EbayListingRef,
  PayoutSchedule,
} from '../types.js';
import { normalizeAdRate } from '../../promoted.js';

export interface MockEbayOptions {
  /** Id generator; defaults to a counter-based id. Inject nanoid from the api if desired. */
  idGen?: () => string;
  newSellerHold?: boolean;
}

export interface MockEbayListing extends EbayListingInput {
  ebayItemId: string;
  ended: boolean;
}

/** In-memory eBay. Records every call so tests can assert on them. */
export class MockEbay implements EbayConnector {
  readonly listings = new Map<string, MockEbayListing>();
  /** Listings with a promoted ad: ebayItemId -> the ad and its rate. */
  readonly promoted = new Map<string, EbayAdResult>();
  readonly fulfillments: EbayFulfillmentInput[] = [];
  readonly messages: { ebayOrderId: string; body: string }[] = [];
  private readonly idGen: () => string;
  private readonly newSellerHold: boolean;
  private seq = 0;

  constructor(options: MockEbayOptions = {}) {
    this.idGen = options.idGen ?? (() => `mock-${String(++this.seq).padStart(8, '0')}`);
    this.newSellerHold = options.newSellerHold ?? false;
  }

  async createListing(input: EbayListingInput): Promise<EbayListingRef> {
    const ebayItemId = this.idGen();
    this.listings.set(ebayItemId, { ...input, images: [...input.images], ebayItemId, ended: false });
    return { ebayItemId };
  }

  async updateListing(ebayItemId: string, patch: Partial<EbayListingInput>): Promise<void> {
    const l = this.require(ebayItemId);
    Object.assign(l, patch);
  }

  async endListing(ebayItemId: string): Promise<void> {
    this.require(ebayItemId).ended = true;
    this.promoted.delete(ebayItemId);
  }

  async promoteListing(ebayItemId: string, ratePct: number): Promise<EbayAdResult> {
    const l = this.require(ebayItemId);
    if (l.ended) throw new Error(`MockEbay: cannot promote ended item ${ebayItemId}`);
    const rate = normalizeAdRate(ratePct);
    const ad: EbayAdResult = { campaignId: 'mock-campaign', adId: this.promoted.get(ebayItemId)?.adId ?? `ad-${ebayItemId}`, ratePct: rate };
    this.promoted.set(ebayItemId, ad);
    return ad;
  }

  async unpromoteListing(ebayItemId: string): Promise<void> {
    this.promoted.delete(ebayItemId);
  }

  async setQuantity(ebayItemId: string, quantity: number): Promise<void> {
    this.require(ebayItemId).quantity = quantity;
  }

  async createShippingFulfillment(input: EbayFulfillmentInput): Promise<void> {
    this.fulfillments.push({ ...input });
  }

  async sendBuyerMessage(ebayOrderId: string, body: string): Promise<void> {
    this.messages.push({ ebayOrderId, body });
  }

  async getPayoutSchedule(): Promise<PayoutSchedule> {
    return { payoutDelayDays: this.newSellerHold ? 30 : 3, newSellerHold: this.newSellerHold };
  }

  private require(ebayItemId: string): MockEbayListing {
    const l = this.listings.get(ebayItemId);
    if (!l) throw new Error(`MockEbay: unknown item ${ebayItemId}`);
    return l;
  }
}
