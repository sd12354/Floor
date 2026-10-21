import { roundHalfUp } from '../../money.js';
import type { Address } from '../../types.js';
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
} from '../types.js';
import { NO_IMAGE_SKUS, SEED_ROWS } from './catalog.js';
import { mulberry32, randInt } from './rng.js';

export interface MockSupplierOptions {
  /** Seed for the deterministic catalog and for drift when no rng is passed. */
  seed?: number;
  /** Delay between placeOrder and tracking becoming available. */
  trackingDelayMs?: number;
}

interface MockOrder {
  supplierOrderId: string;
  idempotencyKey: string;
  supplierSku: string;
  quantity: number;
  shipTo: Address;
  orderedAt: Date;
  costCents: number;
  shippingCents: number;
  trackingNumber: string;
  carrier: string;
}

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'YunExpress'] as const;

function buildProduct(row: (typeof SEED_ROWS)[number], index: number, rng: () => number): SupplierProduct {
  const [sku, title, category, costCents, brand] = row;
  const cn = index % 3 === 0; // every third product ships from China
  const shippingCents = cn ? randInt(rng, 150, 520) : randInt(rng, 0, 1) === 0 ? 0 : randInt(rng, 299, 899);
  const handlingDays = cn ? randInt(rng, 2, 3) : randInt(rng, 1, 2);
  const stock = randInt(rng, 0, 10) === 0 ? 0 : randInt(rng, 5, 480);
  const images = NO_IMAGE_SKUS.has(sku)
    ? []
    : [1, 2, 3].slice(0, randInt(rng, 1, 3)).map((n) => `https://img.mock-supplier.test/${sku.toLowerCase()}-${n}.jpg`);
  return {
    supplier: 'mock',
    supplierSku: sku,
    title: `${title} Free Shipping Hot Sale`,
    description:
      `${title}. Dropshipping wholesale item from our ${cn ? 'Shenzhen' : 'New Jersey'} warehouse. ` +
      `Ships in ${handlingDays} business day${handlingDays === 1 ? '' : 's'}. Factory Direct 2026 New Arrival.`,
    images,
    costCents,
    shippingCents,
    stock,
    warehouseCountry: cn ? 'CN' : 'US',
    handlingDays,
    ...(brand ? { brand } : {}),
    categoryHint: category,
  };
}

/**
 * In-memory supplier with a deterministic ~60 product catalog. Pure: time is passed in via `now`.
 */
export class MockSupplier implements SupplierConnector {
  readonly supplier = 'mock' as const;
  private readonly products = new Map<string, SupplierProduct>();
  private readonly orders = new Map<string, MockOrder>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly driftRng: () => number;
  private readonly trackingDelayMs: number;
  private orderSeq = 0;

  constructor(options: MockSupplierOptions = {}) {
    const seed = options.seed ?? 42;
    const rng = mulberry32(seed);
    SEED_ROWS.forEach((row, i) => this.products.set(row[0], buildProduct(row, i, rng)));
    this.driftRng = mulberry32(seed ^ 0x5eed);
    this.trackingDelayMs = options.trackingDelayMs ?? 30_000;
  }

  async getProduct(supplierSku: string): Promise<SupplierProduct | null> {
    const p = this.products.get(supplierSku);
    return p ? { ...p, images: [...p.images] } : null;
  }

  async getStockAndPrice(skus: readonly string[]): Promise<StockAndPrice[]> {
    const out: StockAndPrice[] = [];
    for (const sku of skus) {
      const p = this.products.get(sku);
      if (p) out.push({ supplierSku: sku, costCents: p.costCents, shippingCents: p.shippingCents, stock: p.stock });
    }
    return out;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const existingId = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.orders.get(existingId);
      if (existing) {
        return { supplierOrderId: existing.supplierOrderId, costCents: existing.costCents, shippingCents: existing.shippingCents };
      }
    }
    const p = this.products.get(input.supplierSku);
    if (!p) throw new Error(`MockSupplier: unknown SKU ${input.supplierSku}`);
    if (p.stock < input.quantity) throw new Error(`MockSupplier: insufficient stock for ${input.supplierSku}`);
    p.stock -= input.quantity;
    this.orderSeq += 1;
    const supplierOrderId = `MOCK-${String(this.orderSeq).padStart(6, '0')}`;
    const carrierIdx = this.orderSeq % CARRIERS.length;
    const order: MockOrder = {
      supplierOrderId,
      idempotencyKey: input.idempotencyKey,
      supplierSku: input.supplierSku,
      quantity: input.quantity,
      shipTo: input.shipTo,
      orderedAt: input.now,
      costCents: p.costCents * input.quantity,
      shippingCents: p.shippingCents,
      trackingNumber: `9400${String(1_000_000_000 + this.orderSeq * 7919).padStart(12, '0')}`,
      carrier: CARRIERS[carrierIdx] ?? 'USPS',
    };
    this.orders.set(supplierOrderId, order);
    this.byIdempotencyKey.set(input.idempotencyKey, supplierOrderId);
    return { supplierOrderId, costCents: order.costCents, shippingCents: order.shippingCents };
  }

  async getTracking(supplierOrderId: string, now: Date): Promise<TrackingInfo | null> {
    const order = this.orders.get(supplierOrderId);
    if (!order) return null;
    const shippedAtMs = order.orderedAt.getTime() + this.trackingDelayMs;
    if (now.getTime() < shippedAtMs) return null;
    return {
      supplierOrderId,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      shippedAt: new Date(shippedAtMs).toISOString(),
    };
  }

  async requestReturn(input: ReturnRequest): Promise<ReturnResult> {
    if (!this.orders.has(input.supplierOrderId)) throw new Error(`MockSupplier: unknown order ${input.supplierOrderId}`);
    return { rmaId: `RMA-${input.supplierOrderId}`, instructions: 'Return to origin warehouse; refund on receipt.' };
  }

  async listCatalog(query: CatalogQuery): Promise<CatalogPage> {
    const q = query.q?.trim().toLowerCase();
    const all = [...this.products.values()].filter((p) =>
      !q ? true : `${p.title} ${p.categoryHint ?? ''} ${p.brand ?? ''}`.toLowerCase().includes(q),
    );
    const page = Math.max(1, query.page);
    const size = Math.max(1, Math.min(200, query.pageSize));
    const start = (page - 1) * size;
    return { items: all.slice(start, start + size).map((p) => ({ ...p, images: [...p.images] })), total: all.length };
  }

  /** Move price +/-15% and stock on ~10% of SKUs. Deterministic for a given rng. */
  drift(rng: () => number = this.driftRng): { changed: string[] } {
    const changed: string[] = [];
    for (const p of this.products.values()) {
      if (rng() >= 0.1) continue;
      const factor = 0.85 + rng() * 0.3;
      p.costCents = Math.max(50, roundHalfUp(p.costCents * factor));
      const stockRoll = rng();
      if (stockRoll < 0.25) p.stock = 0;
      else if (stockRoll < 0.5) p.stock = randInt(rng, 1, 5);
      else p.stock = randInt(rng, 20, 500);
      changed.push(p.supplierSku);
    }
    return { changed };
  }

  /** Test helper: set cost/stock on a SKU directly. */
  setSku(supplierSku: string, patch: Partial<Pick<SupplierProduct, 'costCents' | 'shippingCents' | 'stock'>>): void {
    const p = this.products.get(supplierSku);
    if (!p) throw new Error(`MockSupplier: unknown SKU ${supplierSku}`);
    Object.assign(p, patch);
  }

  /** Test helper: number of orders actually placed. */
  get orderCount(): number {
    return this.orders.size;
  }
}
