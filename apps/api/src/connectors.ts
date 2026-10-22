import {
  ManualSupplierConnector,
  MockEbay,
  MockSupplier,
  RealCjDropshipping,
  RealEbay,
  RealSpocket,
  type EbayConnector,
  type Supplier,
  type SupplierConnector,
} from '@floor/core';
import { nanoid } from 'nanoid';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { AppError } from './errors.js';
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
  /** Only present in mock mode; exposed for tests and the simulate endpoint. */
  mockSupplier?: MockSupplier;
  mockEbay?: MockEbay;
}

/** Choose mock vs real connectors by FLOOR_MODE. Real connectors throw NotConfiguredError until credentials exist. */
export function buildConnectors(config: AppConfig, db?: Db): Connectors {
  const lookup = new ProductTableLookup();
  if (db) lookup.bind(db);
  const manualSupplier = new ManualSupplierConnector(lookup);
  const bindDb = (d: Db): void => lookup.bind(d);
  if (config.mode === 'mock') {
    const mockSupplier = new MockSupplier({ seed: 42, trackingDelayMs: config.mockTrackingDelayMs });
    const mockEbay = new MockEbay({ idGen: () => `mock-${nanoid(10)}` });
    const suppliers: Connectors['suppliers'] = { mock: mockSupplier, manual: manualSupplier };
    return { mode: 'mock', ebay: mockEbay, suppliers, mockSupplier, mockEbay, manualSupplier, bindDb, supplier: (n) => pick(suppliers, n) };
  }
  const suppliers: Connectors['suppliers'] = {
    cjdropshipping: new RealCjDropshipping({ apiKey: config.cjApiKey }),
    spocket: new RealSpocket({ apiKey: config.spocketApiKey }),
    manual: manualSupplier,
  };
  return {
    mode: 'real',
    ebay: new RealEbay(config.ebay),
    suppliers,
    manualSupplier,
    bindDb,
    supplier: (n) => pick(suppliers, n),
  };
}

function pick(suppliers: Connectors['suppliers'], name: string): SupplierConnector {
  const c = (suppliers as Record<string, SupplierConnector | undefined>)[name];
  if (!c) throw new AppError(422, 'SUPPLIER_NOT_AVAILABLE', `Supplier "${name}" is not available in this mode`);
  return c;
}
