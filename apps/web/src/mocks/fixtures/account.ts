import type { Account, FeeConfig, PricingRule, SupplierConnection } from '@/api/types';

export const defaultFees: FeeConfig = {
  finalValueFeePct: 0.136,
  perOrderFeeCents: 40,
  promotedPct: 0,
  storeDiscountPct: 0,
  topRatedDiscountPct: 0,
  belowStandardSurchargePct: 0,
};

export const defaultRule: PricingRule = { floorPct: 0.1, targetPct: 0.2, roundTo: '0.99' };

export const mockSupplier: SupplierConnection = {
  id: 'sup_mock_1',
  accountId: 'acc_demo',
  supplier: 'mock',
  status: 'connected',
  label: 'Mock supplier (demo catalog)',
  createdAt: '2026-10-01T09:12:00Z',
};

export const manualSupplier: SupplierConnection = {
  id: 'sup_manual_1',
  accountId: 'acc_demo',
  supplier: 'manual',
  status: 'connected',
  label: 'Manual supplier (Alibaba, CJ, any wholesaler)',
  createdAt: '2026-10-02T09:12:00Z',
};

/** Fully set-up demo account. Tests and the "fresh" scenario override ebayConnected/supplierConnections. */
export const demoAccount: Account = {
  id: 'acc_demo',
  name: 'Demo seller',
  mode: 'mock',
  ebayConnected: true,
  ebayUsername: 'demo_seller',
  pricingRule: defaultRule,
  fees: defaultFees,
  dailySpendCapCents: 50000,
  smallLossToleranceCents: 500,
  handlingTimeDays: 3,
  newSeller: false,
  promotedAdsEnabled: false,
  promotedAdRatePct: 0.02,
  promotedAdsPending: 0,
  createdAt: '2026-10-01T09:00:00Z',
  supplierConnections: [mockSupplier, manualSupplier],
};

export const freshAccount: Account = {
  ...demoAccount,
  ebayConnected: false,
  ebayUsername: undefined,
  supplierConnections: [],
};
