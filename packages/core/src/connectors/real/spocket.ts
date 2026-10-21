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

export interface SpocketConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Spocket API scaffold. No network calls yet. With a key present the methods would call
 * (Bearer {apiKey} on every request, base https://api.spocket.co/v1 unless overridden):
 *
 *  - listCatalog:       GET  /products?page=&per_page=&search=&ships_from=US   (US/EU suppliers, 2-5 day shipping)
 *  - getProduct:        GET  /products/{id}  (variants[].sku, variants[].cost, variants[].inventory_quantity, shipping)
 *  - getStockAndPrice:  GET  /products/{id}/variants  (cost + inventory per variant; shipping_rates per country)
 *  - placeOrder:        POST /orders { external_id (idempotencyKey), shipping_address, line_items:[{variant_id, quantity}] }
 *                       -> { id, status, total_cost, shipping_cost }; Spocket charges the connected card per order
 *  - getTracking:       GET  /orders/{id}  -> fulfillments[].tracking_number, tracking_company, shipped_at
 *  - requestReturn:     POST /orders/{id}/return_requests { reason }
 */
export class RealSpocket implements SupplierConnector {
  readonly supplier = 'spocket' as const;
  readonly baseUrl: string;

  constructor(private readonly config: SpocketConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.spocket.co/v1';
  }

  private assertConfigured(): void {
    if (!this.config.apiKey) throw new NotConfiguredError('RealSpocket', ['SPOCKET_API_KEY']);
  }

  async getProduct(_supplierSku: string): Promise<SupplierProduct | null> {
    this.assertConfigured();
    throw new Error('RealSpocket.getProduct: not implemented');
  }

  async getStockAndPrice(_skus: readonly string[]): Promise<StockAndPrice[]> {
    this.assertConfigured();
    throw new Error('RealSpocket.getStockAndPrice: not implemented');
  }

  async placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    this.assertConfigured();
    throw new Error('RealSpocket.placeOrder: not implemented');
  }

  async getTracking(_supplierOrderId: string, _now: Date): Promise<TrackingInfo | null> {
    this.assertConfigured();
    throw new Error('RealSpocket.getTracking: not implemented');
  }

  async requestReturn(_input: ReturnRequest): Promise<ReturnResult> {
    this.assertConfigured();
    throw new Error('RealSpocket.requestReturn: not implemented');
  }

  async listCatalog(_query: CatalogQuery): Promise<CatalogPage> {
    this.assertConfigured();
    throw new Error('RealSpocket.listCatalog: not implemented');
  }
}
