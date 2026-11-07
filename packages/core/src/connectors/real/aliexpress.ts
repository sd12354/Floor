import type { Address } from '../../types.js';
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
import { AliExpressHttp } from './aliexpressHttp.js';
import {
  amountToCents,
  cheapestFreightCents,
  firstOrderId,
  mapProduct,
  mapTracking,
  stockAndPrice,
  type AeFreightResult,
  type AeOrderDetailResult,
  type AePlaceOrderResult,
  type AeProductResult,
  type AeTrackingResult,
} from './aliexpressMap.js';
import { AliExpressApiError, type OrderRefStore, type RealAliExpressConfig } from './aliexpressTypes.js';

export {
  ALIEXPRESS_GATEWAY,
  ALIEXPRESS_API_VERSION,
  AliExpressApiError,
  AliExpressReauthRequiredError,
  type OrderRefStore,
  type RealAliExpressConfig,
} from './aliexpressTypes.js';
export { signTopRequest, topBaseString, ALIEXPRESS_SIGN_METHOD } from './aliexpressSign.js';

/** TOP method names. VERIFIED from the aliexpress-ruby-sdk / ae_sdk sources; see docs/CONTRACT.md for the full list. */
const M = {
  productGet: 'aliexpress.ds.product.get',
  freight: 'aliexpress.logistics.buyer.freight.calculate',
  placeOrder: 'aliexpress.trade.buy.placeorder',
  orderGet: 'aliexpress.trade.ds.order.get',
  tracking: 'aliexpress.logistics.ds.trackinginfo.query',
} as const;

const DEFAULT_HANDLING_DAYS = 5; // ASSUMED fallback until the product's logistics delivery_time is read.

/**
 * Real AliExpress dropshipping connector. Implements SupplierConnector so the Floor order pipeline can place AND pay
 * for an AliExpress order once the buyer has paid on eBay. Every network call goes through an injected `fetch`
 * (tests use a fake); nothing here touches the live network in tests.
 *
 * supplierSku encoding: a Floor supplierSku is either `"<productId>"` or `"<productId>:<skuAttr>"`. The productId
 * drives product/freight/order calls; skuAttr (AliExpress's `14:200000000` style attribute string) selects the
 * variant for pricing and ordering. getProduct returns one row per product (the chosen/first SKU).
 *
 * Idempotency: placeOrder is keyed on input.idempotencyKey (the eBay order id). Before creating an order it asks the
 * injected OrderRefStore whether this key already produced a supplier order and, if so, returns that order unchanged
 * (no second create call). This is how Floor guarantees one AliExpress order per eBay order, because AliExpress's
 * placeorder has no VERIFIED server-side out_order_id dedupe (we still pass out_order_id best-effort; see below).
 *
 * Auth: Floor expects a pre-obtained OAuth access token (ALIEXPRESS_ACCESS_TOKEN). This connector does NOT run the
 * consent/refresh flow (unlike RealEbay) — the AliExpress token flow (aliexpress.system.oauth.token) was not verified
 * and the seller must supply a token. A dead token surfaces as AliExpressReauthRequiredError (see aliexpressHttp.ts).
 */
export class RealAliExpress implements SupplierConnector {
  readonly supplier = 'aliexpress' as const;
  private readonly httpOrNull: AliExpressHttp | null;
  private readonly sendGoodsCountry: string;
  private readonly currency: string;
  private readonly language: string;

  constructor(private readonly config: RealAliExpressConfig) {
    this.sendGoodsCountry = config.sendGoodsCountry ?? 'CN';
    this.currency = config.currency ?? 'USD';
    this.language = config.language ?? 'en_US';
    this.httpOrNull =
      config.appKey && config.appSecret && config.accessToken
        ? new AliExpressHttp({ ...config, appKey: config.appKey, appSecret: config.appSecret, accessToken: config.accessToken })
        : null;
  }

  private assertConfigured(): AliExpressHttp {
    const missing: string[] = [];
    if (!this.config.appKey) missing.push('ALIEXPRESS_APP_KEY');
    if (!this.config.appSecret) missing.push('ALIEXPRESS_APP_SECRET');
    if (!this.config.accessToken) missing.push('ALIEXPRESS_ACCESS_TOKEN');
    if (missing.length > 0 || !this.httpOrNull) throw new NotConfiguredError('RealAliExpress', missing);
    return this.httpOrNull;
  }

  private get orderRefStore(): OrderRefStore {
    if (!this.config.orderRefStore) {
      // Without a store Floor cannot guarantee idempotency; refuse rather than risk a duplicate paid order.
      throw new NotConfiguredError('RealAliExpress', ['orderRefStore (an OrderRefStore for idempotency)']);
    }
    return this.config.orderRefStore;
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  /** `<productId>` or `<productId>:<skuAttr>` -> parts. */
  private splitSku(sku: string): { productId: string; skuAttr?: string } {
    const i = sku.indexOf(':');
    if (i < 0) return { productId: sku };
    return { productId: sku.slice(0, i), skuAttr: sku.slice(i + 1) };
  }

  private async fetchProduct(http: AliExpressHttp, productId: string): Promise<AeProductResult | undefined> {
    const r = await http.call<{ aliexpress_ds_product_get_response?: { result?: AeProductResult }; result?: AeProductResult }>(M.productGet, {
      product_id: productId,
      ship_to_country: 'US',
      target_currency: this.currency,
      target_language: this.language,
    });
    return r.aliexpress_ds_product_get_response?.result ?? r.result;
  }

  /** Freight to the US for one unit; cheapest option, 0 when none. A freight error is non-fatal (returns 0). */
  private async fetchShippingCents(http: AliExpressHttp, productId: string): Promise<number> {
    try {
      const r = await http.call<{ aliexpress_logistics_buyer_freight_calculate_response?: { result?: AeFreightResult }; result?: AeFreightResult }>(M.freight, {
        country_code: 'US',
        product_id: productId,
        product_num: '1',
        send_goods_country_code: this.sendGoodsCountry,
      });
      return cheapestFreightCents(r.aliexpress_logistics_buyer_freight_calculate_response?.result ?? r.result);
    } catch (err) {
      this.config.log?.('AliExpress freight lookup failed; shippingCents=0', { productId, error: String(err) });
      return 0;
    }
  }

  async getProduct(supplierSku: string): Promise<SupplierProduct | null> {
    const http = this.assertConfigured();
    const { productId } = this.splitSku(supplierSku);
    const result = await this.fetchProduct(http, productId);
    const shippingCents = await this.fetchShippingCents(http, productId);
    return mapProduct(result, supplierSku, { handlingDays: DEFAULT_HANDLING_DAYS, warehouseCountry: this.sendGoodsCountry, shippingCents });
  }

  async getStockAndPrice(skus: readonly string[]): Promise<StockAndPrice[]> {
    const http = this.assertConfigured();
    const out: StockAndPrice[] = [];
    for (const sku of skus) {
      const { productId } = this.splitSku(sku);
      const result = await this.fetchProduct(http, productId);
      const shippingCents = await this.fetchShippingCents(http, productId);
      out.push(stockAndPrice(result, sku, shippingCents));
    }
    return out;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const http = this.assertConfigured();
    const store = this.orderRefStore;
    // Idempotent replay: a key we have already placed returns the same order, with no second create call.
    const existing = await store.get(input.idempotencyKey);
    if (existing) return this.orderResult(http, existing);

    const { productId, skuAttr } = this.splitSku(input.supplierSku);
    const requestDto = {
      // ds_extend_request carries out_order_id best-effort: ASSUMED field, used as a buyer reference if the API honours it.
      ds_extend_request: { out_order_id: input.idempotencyKey },
      logistics_address: addressToLogistics(input.shipTo, input.buyerName),
      product_items: [
        {
          product_id: productId,
          ...(skuAttr ? { sku_attr: skuAttr } : {}),
          product_count: input.quantity,
          ...(this.config.defaultLogisticsService ? { logistics_service_name: this.config.defaultLogisticsService } : {}),
        },
      ],
      out_order_id: input.idempotencyKey, // ASSUMED top-level mirror; harmless if ignored.
    };
    const r = await http.call<{ aliexpress_trade_buy_placeorder_response?: { result?: AePlaceOrderResult }; result?: AePlaceOrderResult }>(M.placeOrder, {
      param_place_order_request4: JSON.stringify(requestDto),
    });
    const result = r.aliexpress_trade_buy_placeorder_response?.result ?? r.result;
    if (result?.is_success === false) {
      throw new AliExpressApiError(200, `AliExpress placeorder failed: ${result.error_msg ?? result.error_code ?? 'unknown'}`, result.error_code);
    }
    const orderId = firstOrderId(result);
    if (!orderId) throw new AliExpressApiError(200, 'AliExpress placeorder returned no order id');
    await store.set(input.idempotencyKey, orderId);

    // Funded-account model: a freshly placed order is paid from the seller's AliExpress balance. VERIFIED: the DS
    // flow deducts from the bound funding source; a distinct pay method could not be confirmed, so we do NOT call one
    // and instead confirm the paid cost from the order detail. (If a pay step is required, it is a documented TODO.)
    return this.orderResult(http, orderId);
  }

  /** Read an order's detail and derive the cost/shipping we were charged. */
  private async orderResult(http: AliExpressHttp, supplierOrderId: string): Promise<PlaceOrderResult> {
    const detail = await this.fetchOrderDetail(http, supplierOrderId);
    const costCents = sumProductCents(detail);
    return { supplierOrderId, costCents, shippingCents: 0 };
  }

  private async fetchOrderDetail(http: AliExpressHttp, orderId: string): Promise<AeOrderDetailResult | undefined> {
    const r = await http.call<{ aliexpress_trade_ds_order_get_response?: { result?: AeOrderDetailResult }; result?: AeOrderDetailResult }>(M.orderGet, {
      single_order_query: JSON.stringify({ order_id: orderId }),
    });
    return r.aliexpress_trade_ds_order_get_response?.result ?? r.result;
  }

  async getTracking(supplierOrderId: string, now: Date): Promise<TrackingInfo | null> {
    const http = this.assertConfigured();
    const detail = await this.fetchOrderDetail(http, supplierOrderId);
    let tracking: AeTrackingResult | undefined;
    try {
      const r = await http.call<{ aliexpress_logistics_ds_trackinginfo_query_response?: { result?: AeTrackingResult }; result?: AeTrackingResult }>(M.tracking, {
        ae_order_id: supplierOrderId,
      });
      tracking = r.aliexpress_logistics_ds_trackinginfo_query_response?.result ?? r.result;
    } catch (err) {
      // Tracking is often unavailable before the order ships; treat a tracking-query error as "not yet shipped".
      this.config.log?.('AliExpress tracking query failed (likely not shipped yet)', { supplierOrderId, error: String(err) });
    }
    return mapTracking(supplierOrderId, detail, tracking, now);
  }

  async requestReturn(_input: ReturnRequest): Promise<ReturnResult> {
    this.assertConfigured();
    // AliExpress disputes/returns are a buyer-side flow with no VERIFIED DS method; the seller opens it in AliExpress.
    throw new AliExpressApiError(501, 'RealAliExpress.requestReturn: AliExpress returns must be opened in AliExpress (no verified API)');
  }

  async listCatalog(_query: CatalogQuery): Promise<CatalogPage> {
    this.assertConfigured();
    // AliExpress has no DS "browse all my products" method; discovery is by product id (getProduct). None to list.
    return { items: [], total: 0 };
  }
}

/** AliExpress logistics_address shape from the DS placeorder request. */
function addressToLogistics(a: Address, buyerName: string): Record<string, string> {
  return {
    address: [a.line1, a.line2].filter(Boolean).join(', '),
    city: a.city,
    country: a.country,
    full_name: a.name ?? buyerName,
    province: a.state,
    zip: a.postalCode,
  };
}

/** Sum product_unit_price * product_count across the order's product_list, in cents. 0 when the detail lacks prices. */
function sumProductCents(detail: AeOrderDetailResult | undefined): number {
  // The DS order-detail product rows are ASSUMED to carry product_unit_price (decimal string) and product_count.
  const rows =
    (detail as unknown as { product_list?: { ae_order_item?: { product_unit_price?: string; product_count?: number; currency_code?: string }[] } })?.product_list
      ?.ae_order_item ?? [];
  let cents = 0;
  for (const row of rows) {
    if (!row.product_unit_price) continue;
    const unit = amountToCents(row.product_unit_price, row.currency_code, 'order product price');
    cents += unit * (row.product_count ?? 1);
  }
  return cents;
}
