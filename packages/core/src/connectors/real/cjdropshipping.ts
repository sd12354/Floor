import {
  NotConfiguredError,
  type CatalogPage,
  type CatalogQuery,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type ReturnRequest,
  type ReturnResult,
  type StockAndPrice,
  type SupplierConnector,
  type SupplierProduct,
  type TrackingInfo,
} from '../types.js';

export interface CjConfig {
  apiKey?: string;
  /** Defaults to the CJ developer base URL. */
  baseUrl?: string;
}

/**
 * CJdropshipping Open API scaffold (https://developers.cjdropshipping.com). No network calls yet.
 * With a key present the methods would call (all under {baseUrl}/api2.0/v1):
 *
 *  - auth:              POST /authentication/getAccessToken { apiKey } -> accessToken (15 day TTL),
 *                       sent as header `CJ-Access-Token` on every call below
 *  - listCatalog:       GET  /product/list?pageNum=&pageSize=&productNameEn=   (categoryId, countryCode filters)
 *  - getProduct:        GET  /product/query?pid=  (variants carry variantSku / variantSellPrice / image)
 *  - getStockAndPrice:  GET  /product/stock/queryByVid?vid=  and  POST /logistic/freightCalculate
 *                       { startCountryCode, endCountryCode, products:[{quantity, vid}] } for shippingCents
 *  - placeOrder:        POST /shopping/order/createOrder { orderNumber (idempotencyKey), shippingZip, shippingCountryCode,
 *                       shippingProvince, shippingCity, shippingAddress, shippingCustomerName, logisticName,
 *                       fromCountryCode, products:[{vid, quantity}] } -> { orderId }
 *                       then POST /shopping/pay/payBalance { orderId }  (Floor pays per order from balance; no prepaid credits)
 *  - getTracking:       GET  /shopping/order/getOrderDetail?orderId=  -> trackNumber, logisticName, orderStatus
 *                       and GET /logistic/trackInfo?trackNumber=
 *  - requestReturn:     POST /shopping/dispute/create (afterSale) { orderId, disputeReasonId, ... }
 */
export class RealCjDropshipping implements SupplierConnector {
  readonly supplier = 'cjdropshipping' as const;
  readonly baseUrl: string;

  constructor(private readonly config: CjConfig) {
    this.baseUrl = config.baseUrl ?? 'https://developers.cjdropshipping.com/api2.0/v1';
  }

  private assertConfigured(): void {
    if (!this.config.apiKey) throw new NotConfiguredError('RealCjDropshipping', ['CJ_API_KEY']);
  }

  async getProduct(_supplierSku: string): Promise<SupplierProduct | null> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.getProduct: not implemented');
  }

  async getStockAndPrice(_skus: readonly string[]): Promise<StockAndPrice[]> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.getStockAndPrice: not implemented');
  }

  async placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.placeOrder: not implemented');
  }

  async getTracking(_supplierOrderId: string, _now: Date): Promise<TrackingInfo | null> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.getTracking: not implemented');
  }

  async requestReturn(_input: ReturnRequest): Promise<ReturnResult> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.requestReturn: not implemented');
  }

  async listCatalog(_query: CatalogQuery): Promise<CatalogPage> {
    this.assertConfigured();
    throw new Error('RealCjDropshipping.listCatalog: not implemented');
  }
}
