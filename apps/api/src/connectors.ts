import {
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
import { AppError } from './errors.js';

export interface Connectors {
  mode: AppConfig['mode'];
  ebay: EbayConnector;
  /** All suppliers available in this mode, keyed by name. */
  suppliers: Partial<Record<Supplier, SupplierConnector>>;
  supplier(name: string): SupplierConnector;
  /** Only present in mock mode; exposed for tests and the simulate endpoint. */
  mockSupplier?: MockSupplier;
  mockEbay?: MockEbay;
}

/** Choose mock vs real connectors by FLOOR_MODE. Real connectors throw NotConfiguredError until credentials exist. */
export function buildConnectors(config: AppConfig): Connectors {
  if (config.mode === 'mock') {
    const mockSupplier = new MockSupplier({ seed: 42, trackingDelayMs: config.mockTrackingDelayMs });
    const mockEbay = new MockEbay({ idGen: () => `mock-${nanoid(10)}` });
    const suppliers: Connectors['suppliers'] = { mock: mockSupplier };
    return { mode: 'mock', ebay: mockEbay, suppliers, mockSupplier, mockEbay, supplier: (n) => pick(suppliers, n) };
  }
  const suppliers: Connectors['suppliers'] = {
    cjdropshipping: new RealCjDropshipping({ apiKey: config.cjApiKey }),
    spocket: new RealSpocket({ apiKey: config.spocketApiKey }),
  };
  return {
    mode: 'real',
    ebay: new RealEbay(config.ebay),
    suppliers,
    supplier: (n) => pick(suppliers, n),
  };
}

function pick(suppliers: Connectors['suppliers'], name: string): SupplierConnector {
  const c = (suppliers as Record<string, SupplierConnector | undefined>)[name];
  if (!c) throw new AppError(422, 'SUPPLIER_NOT_AVAILABLE', `Supplier "${name}" is not available in this mode`);
  return c;
}
