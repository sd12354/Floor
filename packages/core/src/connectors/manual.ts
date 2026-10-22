import type {
  CatalogPage,
  CatalogQuery,
  PlaceOrderInput,
  PlaceOrderResult,
  ReturnRequest,
  ReturnResult,
  StockAndPrice,
  SupplierConnector,
  SupplierProduct,
  TrackingInfo,
} from './types.js';

export type ManualSupplierErrorCode = 'MANUAL_ORDER' | 'MANUAL_RETURN';

/** The seller orders from a manual supplier by hand, so Floor must never place or return an order itself. */
export class ManualSupplierError extends Error {
  constructor(public readonly code: ManualSupplierErrorCode, message?: string) {
    super(message ?? (code === 'MANUAL_ORDER' ? 'Manual supplier orders are placed by the seller, not by Floor' : 'Manual supplier returns are arranged by the seller'));
    this.name = 'ManualSupplierError';
  }
}

/** Where the connector reads the seller's typed-in catalog from (the api backs it with the Product table). */
export interface ManualProductLookup {
  find(supplierSku: string): Promise<SupplierProduct | null>;
  findMany(supplierSkus: readonly string[]): Promise<SupplierProduct[]>;
  list(query: CatalogQuery): Promise<CatalogPage>;
}

/**
 * Supplier connector for wholesalers with no usable API. It only reads the seller's own catalog;
 * there is no remote source of truth, so a sweep can never overwrite a manual product.
 */
export class ManualSupplierConnector implements SupplierConnector {
  readonly supplier = 'manual' as const;

  constructor(private readonly lookup: ManualProductLookup) {}

  getProduct(supplierSku: string): Promise<SupplierProduct | null> {
    return this.lookup.find(supplierSku);
  }

  async getStockAndPrice(skus: readonly string[]): Promise<StockAndPrice[]> {
    const products = await this.lookup.findMany(skus);
    return products.map((p) => ({ supplierSku: p.supplierSku, costCents: p.costCents, shippingCents: p.shippingCents, stock: p.stock }));
  }

  placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    return Promise.reject(new ManualSupplierError('MANUAL_ORDER'));
  }

  getTracking(_supplierOrderId: string, _now: Date): Promise<TrackingInfo | null> {
    return Promise.resolve(null);
  }

  requestReturn(_input: ReturnRequest): Promise<ReturnResult> {
    return Promise.reject(new ManualSupplierError('MANUAL_RETURN'));
  }

  listCatalog(query: CatalogQuery): Promise<CatalogPage> {
    return this.lookup.list(query);
  }
}
