import {
  ManualSupplierConnector,
  MockEbay,
  MockSupplier,
  RealCjDropshipping,
  RealEbay,
  RealSpocket,
  type EbayConnector,
  type FetchLike,
  type Supplier,
  type SupplierConnector,
} from '@floor/core';
import { nanoid } from 'nanoid';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { AppError } from './errors.js';
import { DbTokenStore } from './services/ebayTokenStore.js';
import { ProductTableLookup } from './services/manualCatalog.js';

export interface Connectors {
  mode: AppConfig['mode'];
  ebay: EbayConnector;
  /** All suppliers available in this mode, keyed by name. */
  suppliers: Partial<Record<Supplier, SupplierConnector>>;
  /** The seller's hand-entered catalog; available in both modes. Reads the Product table. */
  manualSupplier: ManualSupplierConnector;
  /** Give the manual supplier its database. buildServer calls this; safe to call more than once. */
  bindDb(db: Db): void;
  supplier(name: string): SupplierConnector;
  /** Route non-secret adapter diagnostics (e.g. the no-op buyer message) to the app logger. */
  bindLogger(log: (message: string, meta?: Record<string, unknown>) => void): void;
  /** Only present in mock mode; exposed for tests and the simulate endpoint. */
  mockSupplier?: MockSupplier;
  mockEbay?: MockEbay;
}

/** Choose mock vs real connectors by FLOOR_MODE. Real connectors throw NotConfiguredError until credentials exist. */
export function buildConnectors(config: AppConfig, db?: Db, opts: { fetch?: FetchLike } = {}): Connectors {
  const lookup = new ProductTableLookup();
  const tokenStore = new DbTokenStore(config.secretKey);
  let boundDb: Db | undefined;
  let logger: (message: string, meta?: Record<string, unknown>) => void = () => undefined;
  const bindDb = (d: Db): void => {
    boundDb = d;
    lookup.bind(d);
    tokenStore.bind(d);
  };
  if (db) bindDb(db);
  const manualSupplier = new ManualSupplierConnector(lookup);
  const bindLogger: Connectors['bindLogger'] = (log) => void (logger = log);
  if (config.mode === 'mock') {
    const mockSupplier = new MockSupplier({ seed: 42, trackingDelayMs: config.mockTrackingDelayMs });
    const mockEbay = new MockEbay({ idGen: () => `mock-${nanoid(10)}` });
    const suppliers: Connectors['suppliers'] = { mock: mockSupplier, manual: manualSupplier };
    return { mode: 'mock', ebay: mockEbay, suppliers, mockSupplier, mockEbay, manualSupplier, bindDb, bindLogger, supplier: (n) => pick(suppliers, n) };
  }
  const suppliers: Connectors['suppliers'] = {
    cjdropshipping: new RealCjDropshipping({ apiKey: config.cjApiKey }),
    spocket: new RealSpocket({ apiKey: config.spocketApiKey }),
    manual: manualSupplier,
  };
  return {
    mode: 'real',
    ebay: new RealEbay({
      ...config.ebay,
      tokenStore,
      // Floor stores only the eBay listing id; eBay's offer API is keyed by SKU, which is the product's supplierSku.
      resolveSku: async (ebayItemId) => {
        const l = await boundDb?.listing.findFirst({ where: { ebayItemId }, include: { product: true } });
        return l?.product.supplierSku ?? null;
      },
      log: (m, meta) => logger(m, meta),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
    suppliers,
    manualSupplier,
    bindDb,
    bindLogger,
    supplier: (n) => pick(suppliers, n),
  };
}

function pick(suppliers: Connectors['suppliers'], name: string): SupplierConnector {
  const c = (suppliers as Record<string, SupplierConnector | undefined>)[name];
  if (!c) throw new AppError(422, 'SUPPLIER_NOT_AVAILABLE', `Supplier "${name}" is not available in this mode`);
  return c;
}
