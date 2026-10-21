import {
  NotConfiguredError,
  type EbayConnector,
  type EbayFulfillmentInput,
  type EbayListingInput,
  type EbayListingRef,
  type PayoutSchedule,
} from '../types.js';

export interface RealEbayConfig {
  clientId?: string;
  clientSecret?: string;
  ruName?: string;
  env?: 'sandbox' | 'production';
  /** OAuth user token obtained via the authorization-code grant. */
  userToken?: string;
}

/**
 * eBay Sell API scaffold. No network calls are made yet; every method throws NotConfiguredError
 * until credentials are present, and then would call:
 *
 *  - OAuth: POST https://api.ebay.com/identity/v1/oauth2/token (client_credentials for app token,
 *    authorization_code / refresh_token for the user token; RuName identifies the redirect).
 *  - createListing:
 *      PUT  /sell/inventory/v1/inventory_item/{sku}            (title, description, imageUrls, availability.shipToLocationAvailability.quantity)
 *      POST /sell/inventory/v1/offer                           (sku, marketplaceId=EBAY_US, format=FIXED_PRICE, pricingSummary.price,
 *                                                               listingPolicies {fulfillmentPolicyId, paymentPolicyId, returnPolicyId},
 *                                                               categoryId, merchantLocationKey)
 *      POST /sell/inventory/v1/offer/{offerId}/publish         -> { listingId }  (this is the ebayItemId we store)
 *  - updateListing: PUT /sell/inventory/v1/inventory_item/{sku} and PUT /sell/inventory/v1/offer/{offerId}
 *  - setQuantity:   POST /sell/inventory/v1/bulk_update_price_quantity
 *  - endListing:    POST /sell/inventory/v1/offer/{offerId}/withdraw
 *  - createShippingFulfillment: POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
 *                               body { lineItems:[{lineItemId, quantity}], shippedDate, shippingCarrierCode, trackingNumber }
 *  - sendBuyerMessage: Trading API AddMemberMessageAAQToPartner (no REST equivalent at time of writing)
 *  - getPayoutSchedule: GET /sell/finances/v1/payout?filter=payoutDate:[...] and GET /sell/finances/v1/seller_funds_summary
 *  - Order notifications: Notification API (Commerce Notification) topic MARKETPLACE_ORDER... or polling
 *                         GET /sell/fulfillment/v1/order?filter=creationdate:[...] -> POST /webhooks/ebay in apps/api.
 */
export class RealEbay implements EbayConnector {
  readonly baseUrl: string;

  constructor(private readonly config: RealEbayConfig) {
    this.baseUrl = config.env === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
  }

  private assertConfigured(): void {
    const missing: string[] = [];
    if (!this.config.clientId) missing.push('EBAY_CLIENT_ID');
    if (!this.config.clientSecret) missing.push('EBAY_CLIENT_SECRET');
    if (!this.config.ruName) missing.push('EBAY_RU_NAME');
    if (!this.config.userToken) missing.push('EBAY_USER_TOKEN (complete OAuth consent first)');
    if (missing.length > 0) throw new NotConfiguredError('RealEbay', missing);
  }

  /** The consent URL the api returns from POST /account/ebay/connect in real mode. */
  authorizeUrl(scopes: readonly string[] = DEFAULT_SCOPES): string {
    if (!this.config.clientId || !this.config.ruName) {
      throw new NotConfiguredError('RealEbay', ['EBAY_CLIENT_ID', 'EBAY_RU_NAME']);
    }
    const host = this.config.env === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.ruName,
      response_type: 'code',
      scope: scopes.join(' '),
    });
    return `${host}/oauth2/authorize?${params.toString()}`;
  }

  async createListing(_input: EbayListingInput): Promise<EbayListingRef> {
    this.assertConfigured();
    throw new Error('RealEbay.createListing: not implemented');
  }

  async updateListing(_ebayItemId: string, _patch: Partial<EbayListingInput>): Promise<void> {
    this.assertConfigured();
    throw new Error('RealEbay.updateListing: not implemented');
  }

  async endListing(_ebayItemId: string): Promise<void> {
    this.assertConfigured();
    throw new Error('RealEbay.endListing: not implemented');
  }

  async setQuantity(_ebayItemId: string, _quantity: number): Promise<void> {
    this.assertConfigured();
    throw new Error('RealEbay.setQuantity: not implemented');
  }

  async createShippingFulfillment(_input: EbayFulfillmentInput): Promise<void> {
    this.assertConfigured();
    throw new Error('RealEbay.createShippingFulfillment: not implemented');
  }

  async sendBuyerMessage(_ebayOrderId: string, _body: string): Promise<void> {
    this.assertConfigured();
    throw new Error('RealEbay.sendBuyerMessage: not implemented');
  }

  async getPayoutSchedule(): Promise<PayoutSchedule> {
    this.assertConfigured();
    throw new Error('RealEbay.getPayoutSchedule: not implemented');
  }
}

export const DEFAULT_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.account',
];
